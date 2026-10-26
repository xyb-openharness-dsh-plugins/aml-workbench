/* schema 冻结断言（K1–K6 的库里落点）
 *
 * 为什么要单独一套：`schema/0001_initial.sql` 已冻结（sha256 记在 freeze-contract.md），
 * 它是 K1–K6 六条红线的**唯一物理落点**。这条测试守三件事：
 * 1. 0001 的字节没变（冻结未破）——结构变更必须新增 0002_*.sql，不能改 0001；
 * 2. 全表全列扫描没有"判读列"（诊断/风险/复发/合格性/推荐/正常标记）；
 * 3. 六条红线各自的结构证据在场（K1 按天、K2 小时级、K3 双口径、K4 原文列、K5 独立轨道、K6 双主体）。
 *
 * scripts/check-schema.mjs 是同一套判据的独立脚本（CI 里跑）。这里再写一遍不算重复：
 * 脚本会在 npm run check 里跑，测试会在 npm test 里跑；两边任一被绕过，另一边还站着。
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const SQL_PATH = new URL('../schema/0001_initial.sql', import.meta.url)
const CONTRACT_PATH = new URL('../schema/freeze-contract.md', import.meta.url)
const SQL = readFileSync(SQL_PATH, 'utf8')
const CONTRACT = readFileSync(CONTRACT_PATH, 'utf8')

/** 建一份内存库（用冻结 SQL 原文，不经 dsh/store.js——这里要验的是"文件本身能不能跑"）。 */
function build() {
  const db = new DatabaseSync(':memory:')
  db.exec(SQL)
  return db
}

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)

test('① 冻结未破：0001 的 sha256 与 freeze-contract.md 记录的一致', () => {
  const sha = createHash('sha256').update(readFileSync(SQL_PATH)).digest('hex')
  const recorded = CONTRACT.match(/sha256[^0-9a-f]*([0-9a-f]{64})/i)?.[1]
  assert.ok(recorded, 'freeze-contract.md 必须记录 0001 的 sha256')
  assert.equal(sha, recorded, `0001 被改过（sha256=${sha.slice(0, 12)}…，合同 ${recorded.slice(0, 12)}…）。结构变更只能新增 000N_*.sql`)
})

test('② 语法与表数：0001 全量执行通过，建出 30 张业务表', () => {
  const db = build()
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  assert.equal(tables.length, 30, `应为 30 张（不含 schema_migrations，那是运行时台账）；实得 ${tables.length}`)
  db.close()
})

test('③ 判读列零命中：诊断/风险/复发/合格性/推荐/正常标记一律不存在', () => {
  const db = build()
  const JUDGE = /diagnosis|risk_level|relapse|eligible|control_status|normal_flag|verdict|recommend|suitability|prognosis/i
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  const bad = []
  for (const t of tables) {
    for (const c of columnsOf(db, t)) if (JUDGE.test(c)) bad.push(`${t}.${c}`)
  }
  assert.deepEqual(bad, [], `判读列命中：${bad.join(', ')}`)
  db.close()
})

test('④ K1 诱导日历按天：tx_calendar_day 有 day_index，且没有"疗程粒度"聚合判定列', () => {
  const db = build()
  const cols = columnsOf(db, 'tx_calendar_day')
  for (const need of ['cycle_label', 'day_index', 'plan_date', 'actual_date', 'drugs_text', 'done', 'delay_reason']) {
    assert.ok(cols.includes(need), `K1: tx_calendar_day 缺 ${need}`)
  }
  assert.deepEqual(cols.filter((c) => /cycle_outcome|efficacy|response|cr_rate|remission/i.test(c)), [],
    'K1: 日历不许出现疗程级疗效判定列')
  db.close()
})

test('⑤ K2 粒缺发热：体温到分钟、事件五类、判定不入库', () => {
  const db = build()
  const cols = columnsOf(db, 'temperature_reading')
  for (const need of ['measured_at', 'value_c', 'site', 'author_role', 'visibility', 'episode_id']) {
    assert.ok(cols.includes(need), `K2: temperature_reading 缺 ${need}`)
  }
  assert.deepEqual(cols.filter((c) => /is_fever|fever_flag|emergency|severity|level|classify/i.test(c)), [],
    'K2: 判定不许入库（38.3/38.0+1h 由前端按定义原文分流）')

  /* 事件种类枚举：五个都得在 CHECK 里（少的那个意味着"某类事件记不下来"）。 */
  const ddl = SQL.match(/CREATE TABLE fever_event[\s\S]*?\);/i)?.[0] ?? ''
  for (const kind of ['CALL', 'CULTURE', 'ANTIBIOTIC', 'ESCALATE', 'DEESCALATE']) {
    assert.ok(ddl.includes(kind), `K2: fever_event.kind 缺 ${kind}`)
  }
  db.close()
})

test('⑥ K3 MRD 双口径：method 只允许 FLOW/PCR，且无复发判定列', () => {
  const db = build()
  const cols = columnsOf(db, 'mrd_result')
  for (const need of ['measured_at', 'method', 'value_text', 'sensitivity_text', 'specimen']) {
    assert.ok(cols.includes(need), `K3: mrd_result 缺 ${need}`)
  }
  const ddl = SQL.match(/CREATE TABLE mrd_result[\s\S]*?\);/i)?.[0] ?? ''
  assert.match(ddl, /CHECK \(method IN \('FLOW','PCR'\)\)/, 'K3: 口径枚举必须是 FLOW/PCR 两种')
  assert.deepEqual(cols.filter((c) => /relapse|recurrence|conclusion|positive_flag/i.test(c)), [],
    'K3: 不许有复发/结论列')
  db.close()
})

test('⑦ K4 移植评估：全原文列，无推荐/合格性列', () => {
  const db = build()
  const evalCols = columnsOf(db, 'transplant_eval')
  for (const need of ['eval_date', 'status_text', 'items_text', 'doctor_reply']) {
    assert.ok(evalCols.includes(need), `K4: transplant_eval 缺 ${need}`)
  }
  const donorCols = columnsOf(db, 'donor_record')
  for (const need of ['donor_type', 'relation_text', 'hla_text', 'search_note']) {
    assert.ok(donorCols.includes(need), `K4: donor_record 缺 ${need}`)
  }
  assert.deepEqual([...evalCols, ...donorCols].filter((c) => /recommend|score|rank|best|suitab/i.test(c)), [],
    'K4: 零推荐——不许出现推荐/打分/排序列')
  db.close()
})

test('⑧ K5 输注独立轨道：成分三种、辐照与去白各一列、无"依赖"判定', () => {
  const db = build()
  const cols = columnsOf(db, 'transfusion_event')
  for (const need of ['event_date', 'component', 'units_text', 'irradiated', 'leukoreduced', 'reaction']) {
    assert.ok(cols.includes(need), `K5: transfusion_event 缺 ${need}`)
  }
  const ddl = SQL.match(/CREATE TABLE transfusion_event[\s\S]*?\);/i)?.[0] ?? ''
  for (const comp of ['RBC', 'PLATELET', 'PLASMA']) {
    assert.ok(ddl.includes(comp), `K5: 成分枚举缺 ${comp}`)
  }
  assert.deepEqual(cols.filter((c) => /dependen/i.test(c)), [], 'K5: 不判依赖')
  db.close()
})

test('⑨ K6 双主体 + 私密：author_role 枚举 + feeling_note 默认 private 且按 kind 分节', () => {
  const db = build()
  const feeling = columnsOf(db, 'feeling_note')
  for (const need of ['logged_at', 'kind', 'content', 'author_role', 'visibility']) {
    assert.ok(feeling.includes(need), `K6: feeling_note 缺 ${need}`)
  }
  const ddl = SQL.match(/CREATE TABLE feeling_note[\s\S]*?\);/i)?.[0] ?? ''
  for (const kind of ['FEEL', 'DEATH_PREP', 'BURDEN']) {
    assert.ok(ddl.includes(kind), `K6: feeling_note.kind 缺 ${kind}`)
  }
  assert.match(ddl, /visibility TEXT NOT NULL DEFAULT 'private'/, 'K6: 敏感分节默认私密')

  /* 双主体：可写表里的 author_role 一律只允许 PATIENT/CAREGIVER。 */
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  const roleTables = tables.filter((t) => columnsOf(db, t).includes('author_role'))
  assert.ok(roleTables.length >= 6, `K6: 带 author_role 的表应有 6 张以上，实得 ${roleTables.length}`)
  for (const t of roleTables) {
    const ddlT = SQL.match(new RegExp(`CREATE TABLE ${t}[\\s\\S]*?\\);`, 'i'))?.[0] ?? ''
    if (/author_role TEXT\b(?!.*CHECK)/.test(ddlT)) {
      assert.match(ddlT, /author_role[^,]*CHECK \(author_role IN \('PATIENT','CAREGIVER'\)\)/, `K6: ${t}.author_role 必须限定两主体`)
    }
  }
  db.close()
})

test('⑩ 种子里没有判读性默认值：workspace/status 字段都是"流程状态"而不是"结论"', () => {
  const db = build()
  /* document.status 只有三态（pending/parsed/parse_failed），不是"已核对/合格"。 */
  const ddl = SQL.match(/CREATE TABLE document[\s\S]*?\);/i)?.[0] ?? ''
  assert.match(ddl, /CHECK \(status IN \('pending','parsed','parse_failed'\)\)/)
  /* molecular_marker.status 只有三态：detected/not_detected/not_tested（未检测 ≠ 阴性）。 */
  const marker = SQL.match(/CREATE TABLE molecular_marker[\s\S]*?\);/i)?.[0] ?? ''
  assert.match(marker, /CHECK \(status IN \('detected','not_detected','not_tested'\)\)/)
  assert.ok(marker.includes('not_tested'), '未检测必须是独立取值，不能被折进 not_detected')
  db.close()
})
