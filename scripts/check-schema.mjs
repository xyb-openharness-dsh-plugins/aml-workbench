#!/usr/bin/env node
/**
 * check-schema.mjs — schema 冻结断言（AML · G3）
 *
 * 三条：① 0001 能全量执行；② 无判读列（诊断/风险/复发/合格性/推荐 类）；
 *      ③ freeze-contract 记录的 sha256 与文件一致（冻结未破）。
 * 用法：node scripts/check-schema.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SQL = join(ROOT, 'schema/0001_initial.sql')
const CONTRACT = join(ROOT, 'schema/freeze-contract.md')
const fails = []

if (!existsSync(SQL)) { console.error('✗ 缺 schema/0001_initial.sql'); process.exit(1) }
const sql = readFileSync(SQL, 'utf8')

const db = new DatabaseSync(':memory:')
try { db.exec(sql) } catch (e) { fails.push(`0001 执行失败：${e.message}`) }

let tables = []
try { tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name) } catch { /* 执行失败已记 */ }
const JUDGE = /diagnosis|risk_level|relapse|eligible|control_status|normal_flag|verdict|recommend/i
const bad = []
for (const t of tables) {
  for (const c of db.prepare(`PRAGMA table_info(${t})`).all()) if (JUDGE.test(c.name)) bad.push(`${t}.${c.name}`)
}
if (bad.length) fails.push(`判读列命中：${bad.join(', ')}`)
db.close()

if (existsSync(CONTRACT)) {
  const sha = createHash('sha256').update(readFileSync(SQL)).digest('hex')
  const m = readFileSync(CONTRACT, 'utf8').match(/sha256[^0-9a-f]*([0-9a-f]{64})/i)
  if (!m) fails.push('freeze-contract 未记录 sha256')
  else if (m[1] !== sha) fails.push(`冻结被破坏：文件 sha256=${sha.slice(0, 12)}… ≠ 合同 ${m[1].slice(0, 12)}…（结构变更须新增 000N_*.sql）`)
} else fails.push('缺 schema/freeze-contract.md')

if (fails.length) { console.error('✗ schema 冻结断言失败：\n- ' + fails.join('\n- ')); process.exit(1) }
console.log(`✓ schema 冻结：${tables.length} 表 · 判读列 0 命中 · sha256 与合同一致`)
