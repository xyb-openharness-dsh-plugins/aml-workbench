#!/usr/bin/env node
/**
 * fetch-aml-trials-2026.mjs — AML 2026 临床试验采集（ZERO-TO-DEV §1.3）
 *
 * 唯一入口：unified-trial-mcp（MCP stdio，绝不自己拼 URL）。
 * 不传 sourceIds → 所有来源给出各自终态；离线语料（仅胰腺癌覆盖）以
 * 「未配置/无覆盖」类终态如实进入 manifest，不冒充"已查过"。
 *
 * 记录字段形状（实测 2026-10-24，unified-trial-mcp v0.3.1）：
 *   records[]: { recordId, source:{id,label,sourceRecordId}, registryNumbers:[{registry,value,primary}],
 *                provenance, title, studyType, sponsorOrInstitution[], dates:{registered,...}, sourceUrl }
 *   statuses[]: { sourceId, state, reasonCode?, explanation?, coverage?, freshness? }
 *
 * 用法：
 *   node scripts/fetch-aml-trials-2026.mjs --dry-run
 *   node scripts/fetch-aml-trials-2026.mjs
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const UTS_CLI = process.env.UNIFIED_TRIAL_CLI ?? '/Users/qinxiaoqiang/Downloads/unified_search_trials/dist/src/cli/main.js';
const OUT_DIR = join(ROOT, 'research', 'aml-cancer');
const DRY = process.argv.includes('--dry-run');
const SNAPSHOT_DATE = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// 采集口径（与 docs/CLINICAL-DATA-2026.md §采集关键词口径 一致，改口径两处同改）
const QUERIES = [
  { keyword: '急性髓系白血病', note: '中文标准名' },
  { keyword: '急性粒细胞白血病', note: '中文别名' },
  { keyword: '急非淋', note: '中文俗称' },
  { keyword: 'acute myeloid leukemia', note: '英文标准名' },
  { keyword: 'AML', note: '英文缩写' },
  { keyword: 'acute myelogenous leukemia', note: '英文别名' },
];
const PER_SOURCE_LIMIT = 200;

class McpClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.child = spawn(process.execPath, [UTS_CLI, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (c) => this.#onChunk(c));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (c) => process.stderr.write(c.length > 500 ? c.slice(0, 500) + '…\n' : c));
  }
  #onChunk(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`${msg.error.code} ${msg.error.message}`));
          else resolve(msg.result);
        }
      } catch { /* banner 行忽略，不猜 */ }
    }
  }
  send(obj) { this.child.stdin.write(JSON.stringify(obj) + '\n'); }
  request(method, params, timeoutMs = 180000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  async init() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'aml-workbench-fetch', version: '0.1.0' },
    }, 30000);
    this.notify('notifications/initialized', {});
  }
  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args }).then((r) => JSON.parse((r.content ?? []).map((c) => c.text ?? '').join('\n') || '{}'));
  }
  close() { try { this.child.stdin.end(); } catch { /* already closed */ } this.child.kill('SIGTERM'); }
}

// 同一登记号才算同一条（NCT/ChiCTR/CDE/EUCTR…，registryNumbers 为主）
function registryKeys(rec) {
  const keys = [];
  for (const rn of rec.registryNumbers ?? []) {
    const v = rn?.value?.trim?.();
    if (v) keys.push(`${rn.registry}:${v}`.toUpperCase());
  }
  return keys.filter((v, i, a) => a.indexOf(v) === i);
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cli = new McpClient();
  await cli.init();

  const statusSnapshot = await cli.callTool('get_source_status', {});
  if (DRY) {
    console.log('[dry-run] 计划：', JSON.stringify({ UTS_CLI, QUERIES, PER_SOURCE_LIMIT, SNAPSHOT_DATE }));
    console.log('[dry-run] 来源状态：', JSON.stringify((statusSnapshot.sources ?? statusSnapshot), null, 2).slice(0, 4000));
    cli.close();
    return;
  }

  const allRecords = new Map();
  const perQuery = [];
  for (const q of QUERIES) {
    process.stdout.write(`检索 "${q.keyword}" … `);
    let res;
    try {
      res = await cli.callTool('search_trials', { keyword: q.keyword, limit: PER_SOURCE_LIMIT });
    } catch (e) {
      perQuery.push({ query: q.keyword, error: String(e.message).slice(0, 200), statuses: [] });
      console.log('失败：' + e.message);
      continue;
    }
    perQuery.push({
      query: q.keyword,
      statuses: (res.statuses ?? []).map((s) => ({ sourceId: s.sourceId ?? null, state: s.state ?? null, reasonCode: s.reasonCode ?? null })),
      coverage: res.coverage ?? null,
      completeness: res.completeness ?? null,
      totalRecords: res.totalRecords ?? null,
    });
    for (const r of res.records ?? []) {
      if (r.recordId && !allRecords.has(r.recordId)) allRecords.set(r.recordId, r);
    }
    console.log(`${(res.records ?? []).length} 条；终态 ${(res.statuses ?? []).map((s) => `${s.sourceId}:${s.state}`).join(' ')}`);
  }
  cli.close();

  // 身份合并：同登记号合并来源；无登记号的按 recordId 独立保留
  const byKey = new Map();
  const entries = [];
  for (const [rid, rec] of allRecords) {
    const keys = registryKeys(rec);
    const hit = keys.map((k) => byKey.get(k)).find(Boolean);
    if (hit) {
      hit.mergedSources.push(rid);
      for (const k of keys) byKey.set(k, hit);
    } else {
      const entry = { recordId: rid, mergedSources: [rid], rec };
      entries.push(entry);
      for (const k of keys) byKey.set(k, entry);
    }
  }
  const merged = [...new Map(entries.map((e) => [e.recordId, e])).values()];
  merged.sort((a, b) => String(a.recordId).localeCompare(String(b.recordId)));

  const lines = merged.map(({ recordId, mergedSources, rec }) => JSON.stringify({
    recordId,
    mergedSources,
    sourceId: rec.source?.id ?? recordId.split(':')[0] ?? null,
    title: rec.title ?? null,
    studyType: rec.studyType ?? null,
    sponsor: rec.sponsorOrInstitution ?? null,
    registryNumbers: rec.registryNumbers ?? null,
    dates: rec.dates ?? null,
    sourceUrl: rec.sourceUrl ?? null,
    retrievedAt: rec.provenance?.retrievedAt ?? null,
    statusNote: '登记状态，未核实',
    snapshotDate: SNAPSHOT_DATE,
  }));
  const jsonlPath = join(OUT_DIR, 'trials-2026.jsonl');
  writeFileSync(jsonlPath, lines.length ? lines.join('\n') + '\n' : '');

  const dbPath = join(OUT_DIR, 'aml_cancer_trials_2026.sqlite');
  if (existsSync(dbPath)) rmSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE trials (
    record_id TEXT PRIMARY KEY,
    merged_sources TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT,
    study_type TEXT,
    sponsors TEXT,
    registry_numbers TEXT,
    dates TEXT,
    source_url TEXT,
    retrieved_at TEXT,
    status_note TEXT NOT NULL DEFAULT '登记状态，未核实',
    snapshot_date TEXT NOT NULL
  );
  CREATE INDEX idx_trials_source ON trials(source_id);
  CREATE TABLE source_statuses (
    query TEXT NOT NULL,
    source_id TEXT,
    state TEXT,
    reason_code TEXT,
    coverage TEXT,
    completeness TEXT,
    total_records INTEGER
  );`);
  const insTrial = db.prepare('INSERT INTO trials (record_id, merged_sources, source_id, title, study_type, sponsors, registry_numbers, dates, source_url, retrieved_at, status_note, snapshot_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insStatus = db.prepare('INSERT INTO source_statuses (query, source_id, state, reason_code, coverage, completeness, total_records) VALUES (?,?,?,?,?,?,?)');
  for (const l of lines) {
    const r = JSON.parse(l);
    insTrial.run(r.recordId, JSON.stringify(r.mergedSources), r.sourceId, r.title, r.studyType, r.sponsors ? JSON.stringify(r.sponsors) : null, r.registryNumbers ? JSON.stringify(r.registryNumbers) : null, r.dates ? JSON.stringify(r.dates) : null, r.sourceUrl, r.retrievedAt, r.statusNote, r.snapshotDate);
  }
  for (const qs of perQuery) {
    for (const s of qs.statuses) insStatus.run(qs.query, s.sourceId, s.state, s.reasonCode, qs.coverage ? JSON.stringify(qs.coverage) : null, qs.completeness ? JSON.stringify(qs.completeness) : null, qs.totalRecords ?? null);
    if (qs.error) insStatus.run(qs.query, null, 'ERROR', null, null, null, null), void 0;
  }
  const dbCount = db.prepare('SELECT COUNT(*) AS n FROM trials').get().n;
  const statusCount = db.prepare('SELECT COUNT(*) AS n FROM source_statuses').get().n;
  db.close();

  const manifest = {
    topic: 'aml', year: '2026', snapshotDate: SNAPSHOT_DATE,
    tool: `unified-trial-mcp @ ${UTS_CLI}`,
    queries: QUERIES, perSourceLimit: PER_SOURCE_LIMIT,
    recordCount: lines.length, dbCount, sourceStatusRows: statusCount,
    honesty: {
      offlineCorpora: 'ChiCTR/CDE/CTV 离线语料仅胰腺癌覆盖；AML 只依赖在线通道终态，见 source_statuses 表',
      statusWording: '登记 ≠ 有效 ≠ 安全 ≠ 可入组；状态一律"登记状态，未核实"',
      mergeRule: '仅同一登记号（NCT/ChiCTR/CDE 等）合并，其余并排保留来源',
    },
    files: {},
  };
  manifest.files['trials-2026.jsonl'] = { sha256: sha256(jsonlPath) };
  manifest.files['aml_cancer_trials_2026.sqlite'] = { sha256: sha256(dbPath) };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (manifest.recordCount !== lines.length || dbCount !== lines.length) {
    console.error(`一致性断言失败：manifest=${manifest.recordCount} jsonl=${lines.length} sqlite=${dbCount}`);
    process.exit(1);
  }
  const bySource = {};
  for (const { sourceId } of merged.map((m) => ({ sourceId: m.rec.source?.id }))) bySource[sourceId] = (bySource[sourceId] ?? 0) + 1;
  console.log(`完成：${lines.length} 条（合并前 ${allRecords.size} 条）bySource=${JSON.stringify(bySource)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
