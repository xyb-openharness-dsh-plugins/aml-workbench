/**
 * 数据层入口（小橙宝 AML · M5 · slice 1）：开库、迁移、更正链、关库。
 * 零运行时依赖，只用内置 node:sqlite。
 *
 * 三条边界（家族一致）：
 * 1. 路径由调用方给：不猜资料目录在哪，也不替用户建目录；
 * 2. 迁移只增不改：按文件名顺序执行 schema/000N_*.sql，执行过就跳过（幂等台账）；
 *    schema/0001_initial.sql 已冻结（sha256 记在 schema/freeze-contract.md），
 *    结构变更只能新增 000N_*.sql——本文件从不改写已冻结的 SQL；
 * 3. 错误要能诊断：开库/迁移/关库/更正各自抛带 code 的异常，调用方翻译成人话。
 *
 * 更正链（AML 沿用家族做法，按表自适应）：
 * 0001 里**带 revision 列**的事实表（metric_point / diagnosis_record / molecular_marker /
 * consult_note / tx_calendar_day / tx_phase / fever_episode / transfusion_event /
 * infection_record / mrd_result / marrow_procedure / transplant_eval / donor_record）走
 * 「旧行 in_use=0（有该列时）+ 插入 revision+1 的新行」，不原地 UPDATE 数值——
 * 任何一次"改数字"都能从库里回放出来。
 * **没有 revision 列**的表（temperature_reading / fever_event / feeling_note / document …）
 * 是只追加的事件流：更正不是覆盖，而是新记一条；correctRecord 对这类表抛
 * NOT_VERSIONED 并说明该怎么做，不静默改成 UPDATE。
 *
 * 注意 K2：温度判定（38.3℃ 单次 / 38.0℃ 持续>1h）**不入库**，本文件不写任何判定列，
 * 也不提供"是否急症"的字段——判定在前端按定义原文分流（keeper: scripts/check-fever-rule.mjs）。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url))

const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+\.sql$/

/* ---------------- 异常族 ---------------- */

/** 数据层的可诊断异常：code 给调用方分支用，message 是可直接显示的人话。 */
export class StoreError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    if (options.cause) this.cause = options.cause
  }
}

export class OpenDatabaseError extends StoreError {}
export class MigrationError extends StoreError {}
export class CloseDatabaseError extends StoreError {}
export class CorrectionError extends StoreError {}
export class WriteError extends StoreError {}

/* ---------------- 迁移文件 ---------------- */

/** 按编号排序的迁移文件列表。文件名不符合 NNNN_name.sql 的不猜，直接报错。 */
export function migrationFiles(dir = SCHEMA_DIR) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    throw new MigrationError('SCHEMA_DIR_MISSING', `读不到迁移目录：${dir}`, { cause: error })
  }
  const files = entries.filter((f) => f.endsWith('.sql'))
  const unknown = files.filter((f) => !MIGRATION_RE.test(f))
  if (unknown.length) {
    throw new MigrationError('SCHEMA_NAME_INVALID', `schema/ 里有不符合 NNNN_name.sql 的文件：${unknown.join(', ')}`)
  }
  return files.sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)))
}

/* ---------------- 开 / 关 ---------------- */

/** 打开本机库。`:memory:` 用于测试；真实文件由调用方传入用户选定的资料目录下的路径。 */
export function openDatabase(path = ':memory:') {
  if (typeof path !== 'string' || !path.trim()) {
    throw new OpenDatabaseError('EMPTY_DB_PATH', '缺少数据库路径：资料目录必须来自你的选择，不在这里猜')
  }
  let db
  try {
    db = new DatabaseSync(path)
  } catch (error) {
    throw new OpenDatabaseError('OPEN_FAILED', `打不开数据库：${path}`, { cause: error })
  }
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 3000')
  } catch (error) {
    throw new OpenDatabaseError('PRAGMA_FAILED', '打开数据库后没能开启外键约束，库不会被使用', { cause: error })
  }
  return db
}

/** 关库。失败也要抛：静默吞掉等于让人以为数据已经落盘。 */
export function close(db) {
  if (!db) return
  try {
    db.close()
  } catch (error) {
    throw new CloseDatabaseError('CLOSE_FAILED', '关闭数据库时出错，请检查是否还有未完成的写入', { cause: error })
  }
}

/* ---------------- 迁移 ---------------- */

/**
 * 执行未应用的迁移。已在 schema_migrations 里的版本跳过（幂等）。
 * 每个文件在一个事务里跑完：跑一半失败会整体回滚，不会留下"半套表"。
 */
export function migrate(db, { dir = SCHEMA_DIR, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.exec !== 'function') {
    throw new MigrationError('NO_DATABASE', '迁移需要一个已打开的数据库')
  }

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT
    )`)
  } catch (error) {
    throw new MigrationError('LEDGER_FAILED', '建不了迁移台账 schema_migrations，后续迁移无法记录', { cause: error })
  }

  let applied
  try {
    applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version))
  } catch (error) {
    throw new MigrationError('LEDGER_READ_FAILED', '读不到已执行的迁移记录', { cause: error })
  }

  const executed = []
  for (const file of migrationFiles(dir)) {
    const version = file.slice(0, 4)
    if (applied.has(version)) continue

    let sql
    try {
      sql = readFileSync(join(dir, file), 'utf8')
    } catch (error) {
      throw new MigrationError('SCHEMA_READ_FAILED', `读不到迁移文件：schema/${file}`, { cause: error })
    }

    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now())
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch (rollbackError) {
        throw new MigrationError('ROLLBACK_FAILED', `schema/${file} 执行失败且回滚也失败：${error.message}`, { cause: rollbackError })
      }
      throw new MigrationError('MIGRATE_FAILED', `schema/${file} 执行失败：${error.message}`, { cause: error })
    }
    executed.push(file)
  }

  return {
    executed,
    applied: db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(),
  }
}

/* ---------------- 表结构自省（更正链按表自适应） ---------------- */

const tableInfoCache = new WeakMap()

/** 表的列名集合。带缓存（同一连接同一表只查一次 PRAGMA）。 */
export function tableColumns(db, table) {
  if (!db || typeof db.prepare !== 'function') throw new CorrectionError('NO_DATABASE', '需要已打开的数据库')
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(table))) throw new CorrectionError('BAD_TABLE', `表名不合法：${table}`)
  let cache = tableInfoCache.get(db)
  if (!cache) { cache = new Map(); tableInfoCache.set(db, cache) }
  if (cache.has(table)) return cache.get(table)
  let rows
  try {
    rows = db.prepare(`PRAGMA table_info(${table})`).all()
  } catch (error) {
    throw new CorrectionError('PRAGMA_FAILED', `读不到表结构：${table}`, { cause: error })
  }
  if (!rows.length) throw new CorrectionError('NO_SUCH_TABLE', `没有这张表：${table}`)
  const cols = rows.map((r) => r.name)
  cache.set(table, cols)
  return cols
}

/** 该表是否支持更正链（有 revision 列＝版本化记录；没有＝只追加事件流）。 */
export function isVersioned(db, table) {
  return tableColumns(db, table).includes('revision')
}

/* ---------------- 更正链 ---------------- */

/**
 * 更正一条版本化记录：旧行 in_use=0（有该列时），插入 revision+1 的新行。
 *
 * @param {object} db
 * @param {string} table 表名（必须是 0001 里带 revision 列的事实表）
 * @param {number} id 现行记录 id
 * @param {object} patch 只允许改 allowed 里列出的列
 * @param {{allow?: string[], now?: Function}} [opts]
 * @returns {{id:number, revision:number, supersededId:number}}
 */
export function correctRecord(db, table, id, patch = {}, { allow = null, now = null } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new CorrectionError('NO_DATABASE', '更正需要一个已打开的数据库')
  const cols = tableColumns(db, table)
  if (!cols.includes('revision')) {
    throw new CorrectionError(
      'NOT_VERSIONED',
      `${table} 没有 revision 列：它是只追加的事件流（更正＝新记一条，不是覆盖旧记录）`,
    )
  }

  const old = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (!old) throw new CorrectionError('NOT_FOUND', `没有这条记录：${table} id=${id}`)
  if (cols.includes('in_use') && !old.in_use) {
    throw new CorrectionError('SUPERSEDED', `id=${id} 已被更正过（revision ${old.revision} 已失效），只能更正现行记录`)
  }

  /* 默认白名单：除主键与版本列以外的全部列都可改；调用方可以收窄（如 metric_point 不允许改 code/measured_at）。 */
  const immutable = new Set(['id', 'revision', ...(cols.includes('in_use') ? ['in_use'] : [])])
  const allowed = allow ?? cols.filter((c) => !immutable.has(c))
  const dirty = Object.keys(patch).filter((k) => patch[k] !== undefined)
  const illegal = dirty.filter((k) => !allowed.includes(k))
  if (illegal.length) {
    throw new CorrectionError('IMMUTABLE_FIELD', `这些字段不能更正（要改就另记一条）：${illegal.join(', ')}`)
  }

  const next = { ...old, ...Object.fromEntries(dirty.map((k) => [k, patch[k]])) }
  const insertCols = cols.filter((c) => c !== 'id' && c !== 'revision' && c !== 'in_use')
  const placeholders = insertCols.map(() => '?')

  db.exec('BEGIN')
  try {
    if (cols.includes('in_use')) db.prepare(`UPDATE ${table} SET in_use = 0 WHERE id = ?`).run(id)
    const r = db.prepare(`INSERT INTO ${table} (${insertCols.join(', ')}, revision) VALUES (${placeholders.join(', ')}, ?)`)
      .run(...insertCols.map((c) => next[c] ?? null), old.revision + 1)
    db.exec('COMMIT')
    return { id: Number(r.lastInsertRowid), revision: old.revision + 1, supersededId: id, table, at: now ? now() : null }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
    throw new CorrectionError('CORRECT_FAILED', `更正失败（已回滚）：${error.message}`, { cause: error })
  }
}

/** metric_point 的更正白名单：数值类可改，code / measured_at 不是"更正"而是另一条记录。 */
const METRIC_EDITABLE = ['value_num', 'value_text', 'unit', 'ref_range_text', 'source_note', 'author_role']

/**
 * 更正一条 metric_point（家族同名的便捷封装）。
 * 不许改 profile_id/code/measured_at：那不是更正，是另一条记录。
 */
export function correctMetricPoint(db, id, patch = {}, opts = {}) {
  return correctRecord(db, 'metric_point', id, patch, { ...opts, allow: METRIC_EDITABLE })
}

/* ---------------- 事实写入（只写入，不判定） ---------------- */

/**
 * 追加一条体温读数。**不写任何"是否急症/是否粒缺发热"的判定**（K2：判定由前端按定义原文做）。
 * @returns {{id:number, measured_at:string, value_c:number}}
 */
export function appendTemperature(db, { profileId, measuredAt, valueC, site = null, authorRole = 'PATIENT', visibility = 'public', episodeId = null, ord = null }) {
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '写体温需要一个已打开的数据库')
  const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(profileId)
  if (!profile) throw new WriteError('PROFILE_NOT_FOUND', `没有这个档案：${profileId}`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(measuredAt ?? ''))) {
    throw new WriteError('BAD_TIME', '体温时间要精确到分钟，形如 2026-10-26T08:10')
  }
  const v = Number(valueC)
  if (!Number.isFinite(v) || v < 30 || v > 45) throw new WriteError('BAD_VALUE', `体温不在可记录的范围内：${valueC}`)
  if (authorRole !== 'PATIENT' && authorRole !== 'CAREGIVER') throw new WriteError('BAD_AUTHOR', `记录主体只能是 PATIENT/CAREGIVER：${authorRole}`)
  if (site !== null && !['AXILLARY', 'ORAL', 'EAR'].includes(site)) throw new WriteError('BAD_SITE', `部位只能是 AXILLARY/ORAL/EAR：${site}`)
  if (visibility !== 'public' && visibility !== 'private') throw new WriteError('BAD_VISIBILITY', `可见性只能是 public/private：${visibility}`)

  let episode = episodeId
  let nextOrd = ord
  if (episode === null) {
    const open = db.prepare(`SELECT id FROM fever_episode WHERE profile_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).get(profileId)
    episode = open?.id ?? null
  }
  if (nextOrd === null) {
    const r = db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM temperature_reading WHERE profile_id = ?').get(profileId)
    nextOrd = (r?.m ?? -1) + 1
  }

  try {
    const res = db.prepare(`INSERT INTO temperature_reading
      (profile_id, episode_id, measured_at, value_c, site, author_role, visibility, ord)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(profileId, episode, String(measuredAt), v, site, authorRole, visibility, nextOrd)
    return { id: Number(res.lastInsertRowid), measured_at: String(measuredAt), value_c: v, episode_id: episode }
  } catch (error) {
    throw new WriteError('TEMPERATURE_WRITE_FAILED', `体温没写进库：${error.message}`, { cause: error })
  }
}

/* ---------------- 通用写路由（0.4.0 · AI 写入能力的契约面） ----------------
   POST /api/aml/records/:kind 与手工表单走同一条写路径（34 号语义：AI 产出一律先落
   候选/待核对，确认后才写事实层；本层只做事实写入，不做任何判定）。
   列名与 schema/0001_initial.sql 逐列一致（结构冻结，检查器 keeper：
   scripts/check-write-schema.mjs 用 PRAGMA 逐列复核）。
   默认值按 K6：author_role 家属代记为主 → CAREGIVER；visibility 私密默认——
   kind=feeling 且 kind_in=DEATH_PREP 时 private（K6「对死亡的准备」），其余 public。 */

/** kind 白名单 → 表与列约束。hasAuthorRole/hasVisibility 由表结构决定，映射列名不许超出 0001。 */
export const RECORD_KINDS = Object.freeze({
  transfusion: {
    table: 'transfusion_event', add: 'addTransfusion', list: 'listTransfusions', hasVisibility: false,
    columns: {
      event_date: { required: true }, component: { required: true, enum: ['RBC', 'PLATELET', 'PLASMA'] },
      units_text: { required: true }, irradiated: { integer: true }, leukoreduced: { integer: true },
      reaction: {}, author_role: { enum: ['PATIENT', 'CAREGIVER'], default: 'CAREGIVER' }, ord: { integer: true },
    },
  },
  mucositis: {
    table: 'mucositis_log', add: 'addMucositis', list: 'listMucositis', hasVisibility: false,
    columns: {
      logged_at: { required: true }, grade_text: {}, site: {}, symptom_text: {},
      author_role: { enum: ['PATIENT', 'CAREGIVER'], default: 'CAREGIVER', required: true }, ord: { integer: true },
    },
  },
  'marrow-procedure': {
    table: 'marrow_procedure', add: 'addMarrowProcedure', list: 'listMarrowProcedures', hasVisibility: false,
    columns: { done_on: { required: true }, purpose_text: {}, result_text: {}, report_doc_id: { integer: true }, ord: { integer: true } },
  },
  feeling: {
    table: 'feeling_note', add: 'addFeeling', list: 'listFeelings', hasVisibility: true,
    columns: {
      logged_at: { required: true }, kind_in: { required: true, enum: ['FEEL', 'DEATH_PREP', 'BURDEN'] },
      content: { required: true }, author_role: { enum: ['PATIENT', 'CAREGIVER'], default: 'CAREGIVER', required: true },
      visibility: { enum: ['public', 'private'] }, ord: { integer: true },
    },
  },
  question: {
    table: 'question', add: 'addQuestion', list: 'listQuestions', hasVisibility: false,
    columns: {
      kind_in: { required: true, enum: ['fact', 'view'] }, content: { required: true }, created_at: { required: true },
      asked_on: {}, from_scenario: {}, ord: { integer: true },
    },
  },
  intake: {
    table: 'intake_log', add: 'addIntake', list: 'listIntake', hasVisibility: false,
    columns: {
      logged_at: { required: true }, intake_level: { enum: ['OK', 'REDUCED', 'MINIMAL'] }, weight_kg: { number: true },
      note: {}, author_role: { enum: ['PATIENT', 'CAREGIVER'], default: 'CAREGIVER' }, ord: { integer: true },
    },
  },
  'tx-day': {
    table: 'tx_calendar_day', add: 'addTxDay', list: 'listTxDays', hasVisibility: false,
    columns: {
      cycle_label: { required: true }, day_index: { required: true, integer: true }, plan_date: { required: true },
      actual_date: {}, drugs_text: {}, done: { integer: true }, delay_reason: {}, ord: { integer: true },
    },
  },
  document: {
    table: 'document', add: 'addDocument', list: 'listDocuments', hasVisibility: false,
    columns: {
      file_name: { required: true }, sha256: { required: true }, status: { enum: ['pending', 'parsed', 'parse_failed'], default: 'pending' },
      imported_at: { required: true }, ord: { integer: true },
    },
  },
})

/* kind=feeling 的入参列叫 kind_in，落库列是 feeling_note.kind（SQL 关键字，映射时改名）。 */
const KIND_COLUMN_ALIAS = { kind_in: 'kind' }

/**
 * 通用事实写入：校验必填列与枚举 → INSERT。非法 kind 抛 BAD_KIND（路由翻译成 400 JSON）。
 * @returns {{id:number, kind:string, table:string}}
 */
export function insertRecord(db, kind, input = {}) {
  const spec = RECORD_KINDS[kind]
  if (!spec) throw new WriteError('BAD_KIND', `不认识的记录类型：${kind}（白名单：${Object.keys(RECORD_KINDS).join(' / ')}）`)
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '写记录需要一个已打开的数据库')
  const profileId = input.profileId
  if (!profileId) throw new WriteError('PROFILE_REQUIRED', '缺少 profileId')
  const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(profileId)
  if (!profile) throw new WriteError('PROFILE_NOT_FOUND', `没有这个档案：${profileId}`)

  const values = {}
  for (const [name, rule] of Object.entries(spec.columns)) {
    const raw = input[name]
    const col = KIND_COLUMN_ALIAS[name] ?? name
    if (raw === undefined || raw === null || raw === '') {
      if (rule.default !== undefined) { values[col] = rule.default; continue }
      if (rule.required) throw new WriteError('FIELD_REQUIRED', `缺少必填字段：${name}`)
      continue
    }
    if (rule.enum && !rule.enum.includes(raw)) {
      throw new WriteError('BAD_VALUE', `${name} 只能是 ${rule.enum.join(' / ')}：${raw}`)
    }
    if (rule.integer) {
      const n = Number(raw)
      if (!Number.isInteger(n)) throw new WriteError('BAD_VALUE', `${name} 要是整数：${raw}`)
      values[col] = n
      continue
    }
    if (rule.number) {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new WriteError('BAD_VALUE', `${name} 要是数值：${raw}`)
      values[col] = n
      continue
    }
    values[col] = String(raw)
  }
  if (spec.hasVisibility) {
    /* K6：「对死亡的准备」默认私密；其余默认共享。显式传入仍然以传入为准。 */
    const vis = input.visibility ?? (values.kind === 'DEATH_PREP' ? 'private' : 'public')
    if (vis !== 'public' && vis !== 'private') throw new WriteError('BAD_VISIBILITY', `可见性只能是 public/private：${vis}`)
    values.visibility = vis
  }
  if ('author_role' in spec.columns && values.author_role === undefined) values.author_role = spec.columns.author_role.default ?? 'CAREGIVER'

  const cols = Object.keys(values)
  if (!cols.length) throw new WriteError('FIELD_REQUIRED', '没有可写的字段')
  try {
    const res = db.prepare(`INSERT INTO ${spec.table} (profile_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
      .run(profileId, ...cols.map((c) => values[c]))
    return { id: Number(res.lastInsertRowid), kind, table: spec.table, ...Object.fromEntries(cols.map((c) => [c, values[c]])) }
  } catch (error) {
    /* 列上的 CHECK 约束（如 component/kind 枚举）走 BAD_VALUE，其余按写失败。 */
    if (/CHECK constraint failed/i.test(String(error.message))) {
      throw new WriteError('BAD_VALUE', `字段值不满足表约束：${error.message}`, { cause: error })
    }
    throw new WriteError('RECORD_WRITE_FAILED', `${kind} 没写进库：${error.message}`, { cause: error })
  }
}

/** 通用列表读：ord/rowid 显式排序；带 visibility 的表默认过滤 private（三出口口径），?private=1 才给。 */
export function listRecords(db, kind, profileId, { includePrivate = false } = {}) {
  const spec = RECORD_KINDS[kind]
  if (!spec) throw new WriteError('BAD_KIND', `不认识的记录类型：${kind}（白名单：${Object.keys(RECORD_KINDS).join(' / ')}）`)
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '读记录需要一个已打开的数据库')
  const vis = spec.hasVisibility && !includePrivate ? " AND visibility <> 'private'" : ''
  return db.prepare(`SELECT * FROM ${spec.table} WHERE profile_id = ?${vis} ORDER BY ord, rowid`).all(profileId).map((r) => ({ ...r }))
}

/* 每个 kind 一个具名方法（任务口径：store.js 加对应 addXxx / listXxx；检查器按名单核对）。 */
export const addTransfusion = (db, input) => insertRecord(db, 'transfusion', input)
export const addMucositis = (db, input) => insertRecord(db, 'mucositis', input)
export const addMarrowProcedure = (db, input) => insertRecord(db, 'marrow-procedure', input)
export const addFeeling = (db, input) => insertRecord(db, 'feeling', input)
export const addQuestion = (db, input) => insertRecord(db, 'question', input)
export const addIntake = (db, input) => insertRecord(db, 'intake', input)
export const addTxDay = (db, input) => insertRecord(db, 'tx-day', input)
export const addDocument = (db, input) => insertRecord(db, 'document', input)
export const listTransfusions = (db, key, opts) => listRecords(db, 'transfusion', key, opts)
export const listMucositis = (db, key, opts) => listRecords(db, 'mucositis', key, opts)
export const listMarrowProcedures = (db, key, opts) => listRecords(db, 'marrow-procedure', key, opts)
export const listFeelings = (db, key, opts) => listRecords(db, 'feeling', key, opts)
export const listQuestions = (db, key, opts) => listRecords(db, 'question', key, opts)
export const listIntake = (db, key, opts) => listRecords(db, 'intake', key, opts)
export const listTxDays = (db, key, opts) => listRecords(db, 'tx-day', key, opts)
export const listDocuments = (db, key, opts) => listRecords(db, 'document', key, opts)

/* ---------------- 空档案创建（0.6.0：零治疗初始化三步闭环第 0 步） ----------------
   只允许在没有任何档案的 workspace 里建档；已有档案时幂等返回 existing，不新建。
   age/caregiver 不在冻结 schema 的 profile 表里（0001 只有 birth_date/gender）——
   它们属叙述层，进 workspace.dataset_state.presentation（与演示数据同一存放处）。 */

/**
 * 建立第一份档案。空 workspace 才插入；已有档案返回 { existing:true, profileId }（幂等）。
 * @returns {{id:string, existing:boolean, name:string}}
 */
export function createProfile(db, { name, age = null, gender = null, caregiver = null, newProfile = false } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '建档需要一个已打开的数据库')
  const nm = String(name ?? '').trim()
  if (!nm) throw new WriteError('FIELD_REQUIRED', '姓名必填：先写患者姓名再建档')
  if (nm.length > 40) throw new WriteError('BAD_VALUE', '姓名太长（≤40 字）')
  let ageNum = null
  if (age !== null && age !== undefined && age !== '') {
    ageNum = Number(age)
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) throw new WriteError('BAD_VALUE', `年龄要是 0–130 的整数：${age}`)
  }
  /* newProfile=true：显式"新建我的档案"——已有演示/旧档案时也允许再建一份空的，
     否则装过演示数据的用户永远回不到「0 治疗」三步初始化（0.5.0 真机反馈）。 */
  const existing = db.prepare('SELECT id, name FROM profile ORDER BY rowid LIMIT 1').get()
  if (existing && !newProfile) return { id: existing.id, existing: true, name: existing.name }

  const id = `p${Date.now().toString(36)}`
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO profile (id, name, gender, primary_role, created_at) VALUES (?,?,?,?,?)`)
      .run(id, nm, gender ? String(gender).slice(0, 20) : null, 'PATIENT', new Date().toISOString())
    if (ageNum !== null || (caregiver && String(caregiver).trim())) {
      const r = db.prepare('SELECT dataset_state FROM workspace WHERE id = 1').get()
      let state = {}
      try { state = JSON.parse(r?.dataset_state ?? '{}') ?? {} } catch { state = {} }
      state.meta = state.meta && typeof state.meta === 'object' ? state.meta : {}
      state.presentation = state.presentation && typeof state.presentation === 'object' ? state.presentation : {}
      state.presentation[id] = {
        ...(state.presentation[id] ?? {}),
        ...(ageNum !== null ? { age: ageNum } : {}),
        ...(caregiver && String(caregiver).trim() ? { caregiverLabel: String(caregiver).trim().slice(0, 40) } : {}),
      }
      /* 空 workspace 可能还没有 workspace 行：upsert（与 dsh/parse.js writeState 同一语义）。 */
      db.prepare(`INSERT INTO workspace (id, data_root, schema_version, dataset_state)
        VALUES (1, NULL, '0001', ?)
        ON CONFLICT(id) DO UPDATE SET dataset_state = excluded.dataset_state`)
        .run(JSON.stringify(state))
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
    throw new WriteError('PROFILE_WRITE_FAILED', `档案没写进库：${error.message}`, { cause: error })
  }
  return { id, existing: false, name: nm }
}

/* ---------------- 临床试验（35 号：检索快照 + 收藏） ---------------- */

/** research/ 下的登记快照（随仓不分发到装机包；缺文件返回 source:'missing' 不抛错）。 */
const TRIAL_SNAPSHOT_DIR = fileURLToPath(new URL('../research/aml-cancer/', import.meta.url))
const TRIAL_DB = join(TRIAL_SNAPSHOT_DIR, 'aml_cancer_trials_2026.sqlite')
const TRIAL_MANIFEST = join(TRIAL_SNAPSHOT_DIR, 'manifest.json')

/**
 * 读登记快照：keyword 过标题/登记号，status 过归一状态（快照无状态列 → 只有 other 会命中，
 * 其余状态如实返回空集，不编"招募中"），limit 截断。
 * 找不到 sqlite / manifest 时返回 { source:'missing', items:[], snapshotDate:null }，不抛错。
 * 同时带来源终态摘要（SUCCESS / NO_RESULTS / FAILED 逐来源——FAILED 不算"查过"）。
 */
export function readTrialSnapshot({ keyword = '', status = '', limit = 50 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 500)
  /* 快照没有核验过的招募状态：recruiting / not_yet / suspended 一律空集（"登记状态，未核实"只能归 other）。 */
  if (status && status !== 'other') {
    return { source: 'snapshot', snapshotDate: null, total: 0, items: [], sources: [] }
  }
  if (!existsSync(TRIAL_DB)) return { source: 'missing', snapshotDate: null, items: [], sources: [], total: 0 }
  let db = null
  try {
    db = new DatabaseSync(TRIAL_DB, { readOnly: true })
    const params = []
    let where = ''
    if (String(keyword).trim()) {
      where = 'WHERE (title LIKE ? OR registry_numbers LIKE ?)'
      params.push(`%${String(keyword).trim()}%`, `%${String(keyword).trim()}%`)
    }
    /* 排序：AML 相关词命中的排前（检索相关性排序，透明、不涉资格判定），其余按快照原序。 */
    const rows = db.prepare(`SELECT record_id, title, registry_numbers, sponsors, status_note, snapshot_date, source_url, retrieved_at
      FROM trials ${where}
      ORDER BY (title LIKE '%急性髓系白血病%' OR title LIKE '%急性粒细胞白血病%' OR title LIKE '%急非淋%'
                OR title LIKE '%AML%' OR title LIKE '%髓系%') DESC, rowid LIMIT ?`).all(...params, cap)
    const sources = db.prepare('SELECT query, source_id, state, reason_code, total_records FROM source_statuses ORDER BY rowid').all()
    let snapshotDate = null
    try { snapshotDate = JSON.parse(readFileSync(TRIAL_MANIFEST, 'utf8'))?.snapshotDate ?? rows[0]?.snapshot_date ?? null } catch { snapshotDate = rows[0]?.snapshot_date ?? null }
    return {
      source: 'snapshot',
      snapshotDate,
      total: rows.length,
      items: rows.map((r) => {
        let registry = ''
        let registries = []
        try {
          registries = JSON.parse(r.registry_numbers || '[]')
          registry = (registries.find((x) => x?.primary) ?? registries[0])?.value ?? ''
        } catch { registry = '' }
        return {
          key: r.record_id,
          title: r.title ?? '',
          registry,
          registries,
          sponsor: r.sponsors ?? '',
          status: 'other',
          statusNote: r.status_note ?? '登记状态，未核实',
          phase: null,
          url: r.source_url ?? '',
          retrievedAt: r.retrieved_at ?? null,
          snapshotDate: r.snapshot_date ?? null,
        }
      }),
      sources: sources.map((s) => ({ query: s.query, sourceId: s.source_id, state: s.state, reasonCode: s.reason_code, totalRecords: s.total_records })),
    }
  } catch {
    /* 打不开快照（损坏/被占用）：同样不抛错——检索页显示"快照缺失"，不编数据。 */
    return { source: 'missing', snapshotDate: null, items: [], sources: [], total: 0 }
  } finally {
    if (db) { try { db.close() } catch { /* 只读连接，关不掉不影响主库 */ } }
  }
}

/** 收藏一条试验（saved_trial：profile_id/trial_key/saved_at，35 号 §四：不新增打分列）。 */
export function appendSavedTrial(db, { profileId, trialKey, savedAt = null } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '收藏需要一个已打开的数据库')
  const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(profileId)
  if (!profile) throw new WriteError('PROFILE_NOT_FOUND', `没有这个档案：${profileId}`)
  const key = String(trialKey ?? '').trim()
  if (!key) throw new WriteError('FIELD_REQUIRED', '缺少 trialKey（登记条目的 key）')
  const at = savedAt ?? new Date().toISOString()
  const dup = db.prepare('SELECT id FROM saved_trial WHERE profile_id = ? AND trial_key = ?').get(profileId, key)
  if (dup) return { id: dup.id, profileId, trialKey: key, savedAt: at, duplicate: true }
  const res = db.prepare('INSERT INTO saved_trial (profile_id, trial_key, saved_at) VALUES (?,?,?)').run(profileId, key, at)
  return { id: Number(res.lastInsertRowid), profileId, trialKey: key, savedAt: at }
}

export function listSavedTrials(db, profileId) {
  if (!db || typeof db.prepare !== 'function') throw new WriteError('NO_DATABASE', '读收藏需要一个已打开的数据库')
  return db.prepare('SELECT trial_key, saved_at FROM saved_trial WHERE profile_id = ? ORDER BY saved_at, rowid').all(profileId)
    .map((r) => ({ trialKey: r.trial_key, savedAt: r.saved_at }))
}
