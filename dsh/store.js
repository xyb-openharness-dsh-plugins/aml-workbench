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
import { readFileSync, readdirSync } from 'node:fs'
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
