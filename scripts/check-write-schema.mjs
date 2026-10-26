#!/usr/bin/env node
/**
 * check-write-schema.mjs — 通用写路由 ↔ schema ↔ capabilities 三方核对（0.4.0 反馈 4）
 *
 * 为什么需要：POST /api/aml/records/:kind 的 kind 白名单是 AI 写入能力的契约面。
 * 三类漂移都会安静地坏掉：
 *   ① 写映射里的列名与 schema/0001（结构冻结）对不上 → 运行时才炸 SQL；
 *   ② routes 里声明了 kind 但 store 没有对应 addXxx/listXxx → 全部 501；
 *   ③ health/bootstrap 的 capabilities 与 kind 白名单不一致 → Agent 侧契约撒谎。
 *
 * 判据：
 *   W1 RECORD_KINDS 每个 kind 的列名必须存在于 schema/0001 对应表（PRAGMA table_info 逐列核对）
 *   W2 每个 kind 的 add/list 具名方法必须真实存在于 store.js 导出
 *   W3 routes.js 与 workbench.js/index.js 声明的 capabilities 必须覆盖全部 records.<kind>，
 *      且不出现白名单以外的 records.* 项
 *   W4 白名单里的表必须真的带 profile_id 列（写路由按档案隔离）
 *
 * 用法：node scripts/check-write-schema.mjs <项目根>
 * 退出码：0 通过 / 1 失败
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, migrate, close, tableColumns, RECORD_KINDS } from '../dsh/store.js'
import { CAPABILITIES } from '../dsh/routes.js'

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const oks = []

/* ---- W1/W4：对 schema/0001 建 :memory: 库，PRAGMA 逐列核对 ---- */
const db = openDatabase(':memory:')
try {
  migrate(db)
  const kindNames = Object.keys(RECORD_KINDS)
  if (!kindNames.length) problems.push('W1 RECORD_KINDS 为空——写路由没有任何可写的 kind')
  const expectKinds = ['transfusion', 'mucositis', 'marrow-procedure', 'feeling', 'question', 'intake', 'tx-day', 'document']
  for (const k of expectKinds) {
    if (!kindNames.includes(k)) problems.push(`W1 白名单缺 kind：${k}（反馈 4 要求 8 种全覆盖）`)
  }
  for (const [kind, spec] of Object.entries(RECORD_KINDS)) {
    let cols
    try {
      cols = tableColumns(db, spec.table)
    } catch (error) {
      problems.push(`W1 ${kind} 映射的表不存在：${spec.table}（${error.message}）`)
      continue
    }
    const colSet = new Set(cols)
    for (const name of Object.keys(spec.columns)) {
      const col = name === 'kind_in' ? 'kind' : name
      if (!colSet.has(col)) problems.push(`W1 ${kind} 的写列 ${col} 不在 ${spec.table} 里（schema/0001 结构冻结，改映射不改表）`)
    }
    if (!colSet.has('profile_id')) problems.push(`W4 ${spec.table} 没有 profile_id 列（写路由按档案隔离靠它）`)
    if (spec.hasVisibility && !colSet.has('visibility')) problems.push(`W4 ${spec.table} 声明 hasVisibility 但没有 visibility 列`)
    oks.push(`W1 ${kind} → ${spec.table}（${Object.keys(spec.columns).length} 列全部在表上）`)
  }

  /* ---- W2：add/list 具名方法必须真实导出 ---- */
  const storeSrc = readFileSync(join(root, 'dsh', 'store.js'), 'utf8')
  const exported = new Set([...storeSrc.matchAll(/export\s+(?:const|function|async\s+function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  for (const [kind, spec] of Object.entries(RECORD_KINDS)) {
    if (!exported.has(spec.add)) problems.push(`W2 ${kind} 声明的写方法 ${spec.add} 未在 store.js 导出`)
    if (!exported.has(spec.list)) problems.push(`W2 ${kind} 声明的读方法 ${spec.list} 未在 store.js 导出`)
  }
  oks.push(`W2 store.js 导出核对完成（${Object.keys(RECORD_KINDS).size} 个 kind × add/list）`)
} finally {
  close(db)
}

/* ---- W3：capabilities ↔ kind 白名单一致（health 与 bootstrap 两处声明都查） ---- */
const capSet = new Set(CAPABILITIES)
for (const kind of Object.keys(RECORD_KINDS)) {
  if (!capSet.has(`records.${kind}`)) problems.push(`W3 routes.js CAPABILITIES 缺 records.${kind}`)
}
const extraCaps = [...capSet].filter((c) => c.startsWith('records.') && !RECORD_KINDS[c.slice('records.'.length)] && c !== 'records.write' && c !== 'records.read')
if (extraCaps.length) problems.push(`W3 CAPABILITIES 里出现白名单以外的 records.* 项：${extraCaps.join(', ')}`)
if (!capSet.has('trials.read')) problems.push('W3 CAPABILITIES 缺 trials.read（35 号检索契约）')
if (!capSet.has('saved-trials.write')) problems.push('W3 CAPABILITIES 缺 saved-trials.write（35 号收藏契约）')

for (const f of ['dsh/workbench.js', 'dsh/index.js']) {
  let src
  try { src = readFileSync(join(root, f), 'utf8') } catch { continue }
  const declared = new Set([...src.matchAll(/'([a-z-]+(?:\.[a-z-]+)?)'/g)].map((m) => m[1]).filter((s) => s.startsWith('records.')))
  for (const kind of Object.keys(RECORD_KINDS)) {
    if (!declared.has(`records.${kind}`) && !src.includes('records.${k}')) {
      problems.push(`W3 ${f} 的 capabilities 声明缺 records.${kind}（bootstrap 与 health 不一致 = Agent 侧契约撒谎）`)
    }
  }
  if (!/listTrials/.test(src)) problems.push(`W3 ${f} 没接 listTrials（宿主链路会 501）`)
  if (!/addRecord/.test(src)) problems.push(`W3 ${f} 没接 addRecord（宿主链路会 501）`)
}
oks.push('W3 capabilities 与 kind 白名单一致（routes/workbench/index 三处）')

if (problems.length) {
  console.error(`✗ 写路由↔schema↔capabilities 核对失败：\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`✓ 写路由契约（${oks.length} 项：8 kind × 列级 PRAGMA + add/list 导出 + capabilities 三处一致）`)
