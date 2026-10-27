/**
 * 解析编排（六部件之一：dsh/parse.js）：读原件 → 调 MinerU → 抽候选 → 事务落库。
 *
 * 链路：候选 → 待核对 → 确认入事实层；FAILED 如实。
 * - 解析成功：document.status='parsed'，候选进 workspace.dataset_state 的
 *   pendingCandidates（0001 已冻结、没有 candidate 表；候选不是记录，不进事实表）；
 * - 解析失败：document.status='parse_failed'，**不产候选**，原件留着可重试；
 * - 确认（accept）：按候选 kind 分流（0.6.0）——
 *   · 化验类（kind 缺省视为 metric）：写进 metric_point（事实层，revision=1、in_use=1）。
 *     血象四项（ANC/WBC/Hb/PLT）对码到已有 metric_def；其余（原始细胞/铁蛋白/CRP/LDH）
 *     按需补 metric_def，category 不是 'cbc' → **不进 neu 血象趋势**（K2/K5 的独立性）；
 *     原始细胞比例落 category='marrow'，只在骨穿/MRD 语境里出现。
 *   · diagnosis：写进 diagnosis_record（subtype_text=原文 quote，照抄报告；confirmed_on
 *     取候选出处日期，取不到用今天并如实可见）。
 *   · treatment：**必须带 D1 起始日期**（accept 请求体 {d1:'YYYY-MM-DD'}，routes 透传）→
 *     写 tx_phase（phase='INDUCTION'，plan_text=原文）并生成 42 行 tx_calendar_day
 *     （D1–7 用 plan.drugs，D8+ 写"谷值期（停化疗观察）"）。生成按天日历只是把方案
 *     铺到 D1–42，用药与调整以医嘱为准。
 * - 拒收（reject）：候选丢弃，零副作用。
 * - 重解析：document 新增一行，旧记录保留（含失败记录）。
 */
import { createHash } from 'node:crypto'
import { extractLabCandidates, extractDiagnosisCandidates, extractTreatmentCandidates, guessReportDate } from './amlparse.js'
import { MineruError } from './mineru.js'

const jp = (s, fallback) => {
  if (s === null || s === undefined) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

/** 白名单：.html 上游必拒（-10002）；.txt/.md/.csv 不该走云端。 */
const ALLOWED_EXT = /\.(pdf|jpg|jpeg|png|zip|docx|xlsx)$/i

export class ParseError extends MineruError {}

/** 读 workspace.dataset_state（meta + presentation + pendingCandidates）。 */
export function readState(db) {
  const r = db.prepare('SELECT dataset_state FROM workspace WHERE id = 1').get()
  const state = jp(r?.dataset_state, null)
  return state && typeof state === 'object' ? state : {}
}

function writeState(db, state) {
  /* 0.6.0：空 workspace（未播种演示数据的库）没有 workspace 行——UPDATE 会静默 0 行，
     候选就丢了。改成 upsert：有行更新、没行补建（schema_version 对齐 0001）。 */
  db.prepare(`INSERT INTO workspace (id, data_root, schema_version, dataset_state)
    VALUES (1, NULL, '0001', ?)
    ON CONFLICT(id) DO UPDATE SET dataset_state = excluded.dataset_state`)
    .run(JSON.stringify(state))
}

function nextOrd(db, table, profileId) {
  const r = db.prepare(`SELECT COALESCE(MAX(ord), -1) AS m FROM ${table} WHERE profile_id = ?`).get(profileId)
  return (r?.m ?? -1) + 1
}

/**
 * 解析一份原件并落库（document 一行 + 候选挂 pending）。抛错时也已如实记录 parse_failed。
 * @returns {{documentId:number, status:'parsed'|'parse_failed', candidates:Array, skipped:Array, pages:number|null}}
 */
/** 解析前置失败（无 Token 等）：仍落一条 parse_failed 的 document 行——审计链不能断，
    三步向导第 2 步要能如实显示「解析失败 · 原因」，而不是查无此件。 */
export function recordDocumentFailure(db, { bytes, filename = 'document.pdf', profileId }) {
  const docId = Number(db.prepare(`INSERT INTO document
    (profile_id, file_name, sha256, status, imported_at, ord) VALUES (?,?,?,?,?,?)`)
    .run(profileId, filename, createHash('sha256').update(bytes ?? Buffer.alloc(0)).digest('hex'),
      'parse_failed', new Date().toISOString().slice(0, 10), nextOrd(db, 'document', profileId)).lastInsertRowid)
  return { documentId: docId, status: 'parse_failed' }
}

export async function parseAndRecord(db, { bytes, filename = 'document.pdf', profileId, client }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ParseError('BAD_INPUT', '文件是空的')
  if (!ALLOWED_EXT.test(filename)) {
    throw new ParseError('BAD_INPUT', `不支持的文件类型：${filename}（.html 上游必拒；.txt/.md/.csv 不走云端解析）`)
  }
  if (!client) throw new ParseError('NO_TOKEN', '没有可用的 MinerU 客户端（缺 token？）')
  const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(profileId)
  if (!profile) throw new ParseError('BAD_INPUT', `没有这个档案：${profileId}`)

  let markdown = ''
  let pages = null
  let failure = null
  try {
    const parsed = await client.parse({ bytes, filename })
    markdown = parsed.markdown ?? ''
    pages = parsed.pages ?? null
  } catch (error) {
    failure = error
  }

  const date = guessReportDate(filename) ?? guessReportDate(markdown) ?? null
  const status = failure ? 'parse_failed' : 'parsed'
  const docId = Number(db.prepare(`INSERT INTO document
    (profile_id, file_name, sha256, status, imported_at, ord) VALUES (?,?,?,?,?,?)`)
    .run(profileId, filename, createHash('sha256').update(bytes).digest('hex'), status,
      new Date().toISOString().slice(0, 10), nextOrd(db, 'document', profileId)).lastInsertRowid)

  let candidates = []
  let skipped = []
  if (!failure) {
    const lab = extractLabCandidates(markdown)
    /* 0.6.0：化验候选之外再抽诊断/治疗原文候选（各最多一条，抽不到不产）。 */
    const dx = extractDiagnosisCandidates(markdown)
    const tx = extractTreatmentCandidates(markdown)
    candidates = [...lab.candidates, ...dx, ...tx]
    skipped = lab.skipped
  }

  db.exec('BEGIN')
  try {
    const state = readState(db)
    state.pendingCandidates = (state.pendingCandidates ?? []).concat(candidates.map((c, i) => {
      const base = {
        id: `c${docId}-${i + 1}`,
        documentId: docId,
        profileId,
        field: c.field,
        src: `${filename}${date ? ` ${date}` : ''}`,
        state: 'pending',
      }
      if (c.kind === 'diagnosis') return { ...base, kind: 'diagnosis', quote: c.quote }
      if (c.kind === 'treatment') return { ...base, kind: 'treatment', quote: c.quote, plan: c.plan }
      return { ...base, key: c.key, value: c.value, unit: c.unit }
    }))
    writeState(db, state)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
    throw error
  }

  if (failure) {
    /* FAILED 如实：抛回原始错误（document 行已留 parse_failed，可重试；不产候选）。 */
    throw failure
  }
  return { documentId: docId, status, candidates, skipped, pages }
}

/** 待核对候选清单（按 documentId 可过滤）。 */
export function listCandidates(db, { documentId = null } = {}) {
  const list = readState(db).pendingCandidates ?? []
  return documentId === null ? list : list.filter((c) => c.documentId === documentId)
}

/** 候选 key → metric_def 分类。只有 cbc 进血象趋势（K2/K5 的独立性）。 */
const CATEGORY = { ANC: 'cbc', WBC: 'cbc', HB: 'cbc', PLT: 'cbc', SF: 'inflammation', CRP: 'inflammation', LDH: 'chemistry', BLAST: 'marrow' }
const UNIT = { ANC: '×10⁹/L', WBC: '×10⁹/L', HB: 'g/L', PLT: '×10⁹/L', SF: 'μg/L', CRP: 'mg/L', LDH: 'U/L', BLAST: '%' }

/**
 * 候选 key → 库里实际的 metric_def.code。
 * 种子里 Hb 的 code 是 `Hb`（原型/一图秀用的就是这个写法），而抽取层给的是 `Hb`（大写化后 HB）。
 * 先按**不区分大小写**找已有的 metric_def，命中就沿用它——否则同一种化验会在库里
 * 变成 `Hb` 与 `HB` 两行，趋势里各画一条线（"怎么少了一半数据"就是这么来的）。
 */
function resolveCode(db, rawKey) {
  const s = String(rawKey ?? '').trim()
  if (!s) return 'OTHER'
  const hit = db.prepare('SELECT code FROM metric_def WHERE code = ? COLLATE NOCASE LIMIT 1').get(s)
  if (hit) return hit.code
  const upper = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const hit2 = db.prepare('SELECT code FROM metric_def WHERE UPPER(code) = ? LIMIT 1').get(upper)
  return hit2 ? hit2.code : (upper || 'OTHER')
}

/** 日期加 N 天（D1 起始日 → D1–42 的 plan_date）。 */
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)

/** 原文裁短（药物清单抽不到时的 drugs_text 兜底，只截不断章取义地改写）。 */
const clip = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= 120 ? t : t.slice(0, 120)
}

/**
 * 确认一条候选入事实层（按 kind 分流；kind 缺省视为化验类）。
 * - 化验类：metric_point（原有逻辑不动）。
 * - diagnosis：diagnosis_record（subtype_text=原文 quote；confirmed_on 取出处日期，取不到用今天）。
 * - treatment：必须带 D1 起始日期（opts.d1）→ tx_phase 1 行 + tx_calendar_day 42 行
 *   （D1–7 用 plan.drugs join(' / ')，D8+ 写"谷值期（停化疗观察）"）。
 *   生成按天日历只是把方案铺到 D1–42，用药与调整以医嘱为准。
 * 只改这一条，不动别的候选。
 */
export function acceptCandidate(db, id, { d1 = null } = {}) {
  const state = readState(db)
  const list = state.pendingCandidates ?? []
  const hit = list.find((c) => c.id === id && c.state === 'pending')
  if (!hit) throw new ParseError('NOT_FOUND', `没有这条待核对候选：${id}`)

  /* --- 治疗候选：D1 起始日期必填（用户输入问题 → 400 语义） --- */
  if (hit.kind === 'treatment') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d1 ?? ''))) {
      throw new ParseError('FIELD_REQUIRED', '确认治疗候选需要 D1 起始日期（YYYY-MM-DD）：按天日历从这一天铺开')
    }
  }

  /* --- 诊断候选：原文进 diagnosis_record --- */
  if (hit.kind === 'diagnosis') {
    const confirmedOn = guessReportDate(hit.src) ?? new Date().toISOString().slice(0, 10)
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO diagnosis_record (profile_id, confirmed_on, subtype_text, report_doc_id, ord)
        VALUES (?,?,?,?,?)`)
        .run(hit.profileId, confirmedOn, hit.quote ?? '', hit.documentId ?? null, nextOrd(db, 'diagnosis_record', hit.profileId))
      state.pendingCandidates = list.map((c) => (c.id === id ? { ...c, state: 'accepted' } : c))
      writeState(db, state)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
      throw error
    }
    return { accepted: id, kind: 'diagnosis', confirmedOn, table: 'diagnosis_record' }
  }

  /* --- 治疗候选：tx_phase + 42 天 tx_calendar_day --- */
  if (hit.kind === 'treatment') {
    const plan = hit.plan && typeof hit.plan === 'object' ? hit.plan : {}
    const drugs = Array.isArray(plan.drugs) ? plan.drugs.filter(Boolean) : []
    /* 药物清单抽不到时退回原文（抄写优先于结构化，不替方案添药名）。 */
    const drugsText = drugs.length ? drugs.join(' / ') : clip(hit.quote ?? '')
    db.exec('BEGIN')
    try {
      const phaseId = db.prepare(`INSERT INTO tx_phase (profile_id, cycle_label, phase, start_date, end_date, plan_text, ord)
        VALUES (?,?,?,?,?,?,?)`)
        .run(hit.profileId, '诱导 1', 'INDUCTION', d1, addDays(d1, 41), hit.quote ?? '', nextOrd(db, 'tx_phase', hit.profileId)).lastInsertRowid
      const ins = db.prepare(`INSERT INTO tx_calendar_day
        (profile_id, cycle_label, day_index, plan_date, drugs_text, done, ord) VALUES (?,?,?,?,?,0,?)`)
      for (let k = 1; k <= 42; k++) {
        ins.run(hit.profileId, '诱导 1', k, addDays(d1, k - 1), k <= 7 ? drugsText : '谷值期（停化疗观察）', k - 1)
      }
      state.pendingCandidates = list.map((c) => (c.id === id ? { ...c, state: 'accepted' } : c))
      writeState(db, state)
      db.exec('COMMIT')
      return { accepted: id, kind: 'treatment', table: 'tx_phase', txPhaseId: Number(phaseId), calendarDays: 42, d1 }
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
      throw error
    }
  }

  /* --- 化验候选（kind 缺省视为 metric）：原有逻辑不动 --- */
  const code = resolveCode(db, hit.key)
  const label = hit.field
  const category = CATEGORY[String(code).toUpperCase()] ?? 'other'
  /* 已有 metric_def 的不动（种子里的 ANC/WBC/Hb/PLT/SF 带颜色与排序）；其余按需补。
     新补的一律 ord=99、无颜色：不抢趋势里的固定分组。 */
  db.prepare(`INSERT INTO metric_def (code, label, unit, category, color, is_numeric, ord)
    SELECT ?, ?, ?, ?, NULL, 1, 99 WHERE NOT EXISTS (SELECT 1 FROM metric_def WHERE code = ?)`)
    .run(code, label, UNIT[String(code).toUpperCase()] ?? hit.unit ?? null, category, code)

  const isNum = typeof hit.value === 'number'
  /* 日期取候选出处里的报告日期；取不到就用今天（说明见 source_note，不假装是报告日期）。 */
  const date = guessReportDate(hit.src) ?? new Date().toISOString().slice(0, 10)
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO metric_point
      (profile_id, code, measured_at, value_num, value_text, unit, ref_range_text, source_note, author_role, in_use, revision)
      VALUES (?,?,?,?,?,?,?,?,?,1,1)`)
      .run(hit.profileId, code, date, isNum ? hit.value : null, isNum ? null : String(hit.value),
        hit.unit ?? UNIT[code] ?? null, null,
        JSON.stringify({ quote: `${label} ${hit.value}${hit.unit ? ' ' + hit.unit : ''}`, src: hit.src }), 'PATIENT')
    state.pendingCandidates = list.map((c) => (c.id === id ? { ...c, state: 'accepted' } : c))
    writeState(db, state)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 原始错误优先 */ }
    throw error
  }
  return { accepted: id, code, category }
}

/** 拒收一条候选：从待核对清单移除，不入事实层。 */
export function rejectCandidate(db, id) {
  const state = readState(db)
  const before = (state.pendingCandidates ?? []).length
  state.pendingCandidates = (state.pendingCandidates ?? []).filter((c) => c.id !== id)
  if (state.pendingCandidates.length === before) throw new ParseError('NOT_FOUND', `没有这条候选：${id}`)
  writeState(db, state)
  return { rejected: id }
}
