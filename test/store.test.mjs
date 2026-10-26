/* 数据层：迁移幂等 / 播种幂等 / 更正链（版本化 vs 只追加）/ 异常族 / 体温写入 / 文件库持久化。
 *
 * 这一层的错误会以三种方式伤到用户，所以每条都有对应用例：
 * - 迁移不幂等 → 每次启动重建表，用户资料归零；
 * - 更正链写成 UPDATE → "谁把 0.08% 改成了 0.1%" 永远查不回来；
 * - 体温写入顺手写个"是否急症" → K2 失守（判定只能在前端按定义原文做）。
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  openDatabase, migrate, close, migrationFiles, correctRecord, correctMetricPoint,
  tableColumns, isVersioned, appendTemperature, StoreError, CorrectionError, WriteError,
} from '../dsh/store.js'
import { seedDemo, hasDemoData } from '../dsh/demo.js'
import { readDemoJson } from '../demo/build-demo-data.mjs'

const tmp = mkdtempSync(join(homedir(), '.amlpal-store-test-'))
after(() => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ } })

function openSeeded() {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDemo(db, readDemoJson())
  return db
}

test('① migrate 幂等：第二次执行不重跑 0001，台账只有一条', () => {
  const db = openDatabase(':memory:')
  const first = migrate(db)
  const second = migrate(db)
  assert.deepEqual(first.executed, ['0001_initial.sql'])
  assert.deepEqual(second.executed, [], '第二次不应重跑')
  assert.equal(second.applied.length, 1)
  assert.equal(second.applied[0].version, '0001')
  close(db)
})

test('② 迁移文件命名纪律：schema/ 里只许 NNNN_name.sql，且 0001 排第一', () => {
  const files = migrationFiles()
  assert.deepEqual(files.map((f) => f.slice(0, 4)), ['0001'], '冻结期只应有 0001；新增迁移按 0002 起')
})

test('③ 异常族：开库/迁移/关库各自带 code，调用方能分支', () => {
  assert.throws(() => openDatabase(''), (e) => e instanceof StoreError && e.code === 'EMPTY_DB_PATH')
  assert.throws(() => migrate(null), (e) => e instanceof StoreError && e.code === 'NO_DATABASE')
  const db = openDatabase(':memory:')
  assert.throws(() => tableColumns(db, 'no_such_table'), (e) => e instanceof CorrectionError && e.code === 'NO_SUCH_TABLE')
  assert.throws(() => tableColumns(db, 'bad name; drop table'), (e) => e.code === 'BAD_TABLE')
  close(db)
})

test('④ seedDemo 幂等：调两次只写一份档案，体温条数与事件数可交代', () => {
  const db = openDatabase(':memory:')
  migrate(db)
  const a = seedDemo(db, readDemoJson())
  const b = seedDemo(db, readDemoJson())
  assert.equal(a.skipped, false)
  assert.equal(a.profiles, 2, '本台是两个档案（强诱导 / 不适合强诱导）')
  assert.ok(a.temperatures > 0, 'K2 要求小时级体温真的落库')
  assert.equal(b.skipped, true, '第二次应整批跳过')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profile').get().n, 2)
  close(db)
})

test('⑤ 30 表齐备：0001 冻结 schema 建全（K1–K6 落点逐条在场）', () => {
  const db = openDatabase(':memory:')
  migrate(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
  for (const t of ['workspace', 'profile', 'metric_def', 'metric_point', 'lab_result', 'symptom_log',
    'question', 'task', 'document', 'saved_trial', 'visit_summary', 'feeling_note',
    'diagnosis_record', 'molecular_marker', 'molecular_marker_title', 'consult_note',
    'tx_calendar_day', 'tx_phase', 'fever_episode', 'temperature_reading', 'fever_event',
    'transfusion_event', 'mucositis_log', 'infection_record', 'mrd_result', 'marrow_procedure',
    'transplant_eval', 'donor_record', 'gvhd_log', 'intake_log']) {
    assert.ok(tables.includes(t), `缺表 ${t}`)
  }
  assert.equal(tables.length, 31, '30 张业务表 + schema_migrations')
  close(db)
})

test('⑥ 更正链（版本化表）：旧行 in_use=0、新行 revision+1，数值可回放', () => {
  const db = openSeeded()
  const target = db.prepare("SELECT id, value_num, revision FROM metric_point WHERE code = 'ANC' AND in_use = 1 ORDER BY rowid").all()[0]
  const { id: newId, revision } = correctMetricPoint(db, target.id, { value_num: 9.9 })
  assert.equal(revision, target.revision + 1)
  assert.equal(db.prepare('SELECT in_use FROM metric_point WHERE id = ?').get(target.id).in_use, 0, '旧行必须置 in_use=0')
  assert.equal(db.prepare('SELECT value_num FROM metric_point WHERE id = ?').get(newId).value_num, 9.9)
  /* 已失效的行不许再更正（要更正的是现行记录）。 */
  assert.throws(() => correctMetricPoint(db, target.id, { value_num: 1 }), (e) => e.code === 'SUPERSEDED')
  close(db)
})

test('⑦ 更正链守卫：不可变字段 / 不存在的 id / 只追加表 都要给出可诊断的拒绝', () => {
  const db = openSeeded()
  const any = db.prepare('SELECT id FROM metric_point WHERE in_use = 1').get()
  assert.throws(() => correctMetricPoint(db, any.id, { code: 'WBC' }), (e) => e.code === 'IMMUTABLE_FIELD')
  assert.throws(() => correctMetricPoint(db, any.id, { measured_at: '2026-01-01' }), (e) => e.code === 'IMMUTABLE_FIELD')
  assert.throws(() => correctMetricPoint(db, 999999, {}), (e) => e.code === 'NOT_FOUND')

  /* 只追加表（没有 revision 列）：correctRecord 必须说清"更正＝新记一条"，而不是偷偷 UPDATE。 */
  assert.equal(isVersioned(db, 'temperature_reading'), false, '体温是事件流，不做原地覆盖')
  assert.equal(isVersioned(db, 'metric_point'), true)
  assert.throws(() => correctRecord(db, 'temperature_reading', 1, { value_c: 37 }), (e) => e.code === 'NOT_VERSIONED')
  close(db)
})

test('⑧ 体温写入只写事实：不写任何判定列，值/时间/主体都受校验', () => {
  const db = openSeeded()
  const saved = appendTemperature(db, { profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 38.4, site: 'ORAL', authorRole: 'CAREGIVER' })
  assert.ok(saved.id > 0)
  const row = db.prepare('SELECT * FROM temperature_reading WHERE id = ?').get(saved.id)
  assert.equal(row.value_c, 38.4)
  assert.equal(row.author_role, 'CAREGIVER')
  const cols = tableColumns(db, 'temperature_reading')
  const judgement = cols.filter((c) => /level|emergency|urgent|severity|flag|verdict|classify/i.test(c))
  assert.deepEqual(judgement, [], 'K2：体温表不许出现"是否急症"这类判定列')

  assert.throws(() => appendTemperature(db, { profileId: 'demo1', measuredAt: '2026-10-26 08:10', valueC: 38 }), (e) => e instanceof WriteError && e.code === 'BAD_TIME')
  assert.throws(() => appendTemperature(db, { profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 99 }), (e) => e.code === 'BAD_VALUE')
  assert.throws(() => appendTemperature(db, { profileId: 'nope', measuredAt: '2026-10-26T08:10', valueC: 38 }), (e) => e.code === 'PROFILE_NOT_FOUND')
  assert.throws(() => appendTemperature(db, { profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 38, authorRole: 'NURSE' }), (e) => e.code === 'BAD_AUTHOR')
  close(db)
})

test('⑨ 文件库：真实落盘 + 重开后资料仍在（播种只发生一次）', () => {
  mkdirSync(join(tmp, 'nested'), { recursive: true })
  const file = join(tmp, 'nested', 'amlpal.sqlite')
  const db1 = openDatabase(file)
  migrate(db1)
  seedDemo(db1, readDemoJson())
  close(db1)
  const db2 = openDatabase(file)
  migrate(db2)
  assert.equal(hasDemoData(db2), true, '重开后档案还在')
  assert.equal(seedDemo(db2, readDemoJson()).skipped, true, '重开后不应再播种一遍')
  close(db2)
})
