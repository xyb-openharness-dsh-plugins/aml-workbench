/**
 * 读模型（小橙宝 AML · M5）：把 0001 冻结 schema 的行还原成前端要的形状——
 * 即 prototypes/v0.2/demo-data.js 里 profiles[i] 的结构（demo-parity 测试逐字段比对）。
 *
 * 十条线各一个读法（与原型 10 个一级导航一一对应）：
 * - dash：看板文案属叙述层（presentation.dash）。**不在这里算"是否粒缺"**：
 *   粒缺与否由 ANC 事实 + 定义原文在前端分流，读模型不产判定字段。
 * - dx：确诊时间线/分层原文（presentation + diagnosis_record）、基因（molecular_marker）、
 *   会诊原文（consult_note）。未检测 ≠ 阴性：status='not_tested' 原样透出，不折算成阴性。
 * - tx（K1 按天）：tx_calendar_day 按 day_index 逐日返回，**不做疗程聚合判定**；
 *   方案带/药物表/图例与每日附加标记（输注标记、备注、当日最高最低温）来自叙述层；
 *   疗程列表来自 tx_phase（status 无对应列，属叙述层）。
 * - neu（K2）：fever_episode + temperature_reading（按 measured_at 排序，小时级）+ fever_event。
 *   这里**只返回事实与定义原文**：没有 isEmergency / level / neutropenicFever 这类字段。
 *   判定在前端由 classifyTemp 按 meta.feverDef 的定义原文做（keeper：scripts/check-fever-rule.mjs）。
 *   血象趋势只取 metric_def.category='cbc'（黏膜炎/感染/输注都是独立轨道，不进趋势）。
 * - mrd（K3）：mrd_result 按 method 分 FLOW / PCR 两列返回，不合并、不互算、无复发判定。
 * - tp（K4）：transplant_eval + donor_record + gvhd_log，全是原文列；零推荐（没有推荐字段）。
 * - chart：一图秀与 neu 血象趋势共用 readMetricSeries（单一来源，防两页对不上）。
 * - care：食量/出入量/食物安全全是叙述层记录（只记事实，不给食谱）。
 * - mind（K6）：feeling_note 按 kind 分节（FEEL / DEATH_PREP / BURDEN），
 *   private 默认过滤并给 privateCount（三出口共用同一过滤）。
 * - docs：materials（document 表）+ questions（question 表）+ trials（saved_trial 只登记，
 *   条目正文来自叙述层）。试验条目本体与匹配在临床研究线（GET /api/aml/trials + 35 号读模型）：
 *   这里只保留收藏登记，不提供任何打分或排序。
 *
 * 排序纪律：所有列表显式 ORDER BY（ord/rowid 或 measured_at），不依赖默认返回序。
 * 显式 null：原型里没有的字段读出来就缺省，不猜默认值。
 */

import { AGENT_PANE } from '../lib/layout.js'

const jp = (s, fallback = null) => {
  if (s === null || s === undefined) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}
/* node:sqlite 返回 null-prototype 行对象，deepStrictEqual 会因原型不同失败。统一摊平。 */
const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }))
const hasOwn = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

/** 与原型一致的 author 取值（patient / caregiver）。 */
const authorOf = (role) => (role === 'CAREGIVER' ? 'caregiver' : 'patient')
const statusOut = (s) => (s === 'parsed' ? '已核对' : s === 'parse_failed' ? '解析失败' : '待核对')
const GENE_STATUS_OUT = { detected: '突变型', not_detected: '野生型', not_tested: '未测' }
const COMPONENT_OUT = { RBC: '红细胞', PLATELET: '血小板', PLASMA: '血浆' }
const FEVER_KIND_OUT = { CALL: 'call', CULTURE: 'culture', ANTIBIOTIC: 'antibiotic', ESCALATE: 'escalate', DEESCALATE: 'deescalate' }
const FEELING_SECTIONS = [
  { kind: 'FEEL', key: 'feels' },
  { kind: 'DEATH_PREP', key: 'death' },
  { kind: 'BURDEN', key: 'burden' },
]

/** 本台可进趋势的指标分类（K2/K5：分类数据不混进血象趋势）。 */
export const TREND_CATEGORIES = Object.freeze(['cbc', 'body'])

/** 读 workspace.dataset_state：{ meta, presentation, pendingCandidates }。 */
export function readWorkspaceState(db) {
  const r = db.prepare('SELECT dataset_state FROM workspace WHERE id = 1').get()
  const state = jp(r?.dataset_state, null)
  if (!state || typeof state !== 'object') return { meta: {}, presentation: {}, pendingCandidates: [] }
  return {
    meta: obj(state.meta),
    presentation: obj(state.presentation),
    pendingCandidates: Array.isArray(state.pendingCandidates) ? state.pendingCandidates : [],
  }
}

/* ---------------- 指标（血象 / 体重；K2 与 K5 都不并入这里） ---------------- */

/**
 * 血象与体重序列：只取 metric_def.category ∈ TREND_CATEGORIES。
 * 分类数据（感染、黏膜炎、铁蛋白）不进趋势——它们在各自轨道里以原文呈现。
 */
export function readMetricSeries(db, key) {
  const defs = rows(db, `SELECT code, ord FROM metric_def
    WHERE category IN (${TREND_CATEGORIES.map(() => '?').join(',')}) ORDER BY ord, rowid`, ...TREND_CATEGORIES)
  const out = {}
  for (const d of defs) {
    const list = rows(db, `SELECT measured_at, value_num, value_text FROM metric_point
      WHERE profile_id = ? AND code = ? AND in_use = 1 ORDER BY measured_at, rowid`, key, d.code)
      .map((p) => ({ d: p.measured_at, v: p.value_num === null ? p.value_text : p.value_num }))
    if (list.length) out[d.code] = list
  }
  return out
}

/** 铁蛋白（category='inflammation'，code='SF'）：带报告语境的 note，不进血象趋势。 */
export function readFerritin(db, key) {
  return rows(db, `SELECT measured_at, value_num, value_text, source_note FROM metric_point
    WHERE profile_id = ? AND code = 'SF' AND in_use = 1 ORDER BY measured_at, rowid`, key)
    .map((p) => {
      const sn = jp(p.source_note, {}) || {}
      return {
        d: p.measured_at,
        v: p.value_num === null ? p.value_text : p.value_num,
        ...(sn.note === undefined || sn.note === null ? {} : { note: sn.note }),
      }
    })
}

/* ---------------- 诊断与基因 ---------------- */

function readDx(db, key, pres) {
  const rec = db.prepare('SELECT * FROM diagnosis_record WHERE profile_id = ? ORDER BY ord, rowid LIMIT 1').get(key) ?? null
  const sp = obj(pres.dx).subtype
  /* 0.6.0：三步闭环确认的 diagnosis_record（本机新档案没有叙述层 pres.dx.subtype）也要出
     subtype——who 仍优先取 rec.subtype_text（原文），表达式与演示档案一致，只是
     「有 rec 也能成卡」。 */
  const subtype = (sp || rec)
    ? {
        who: rec?.subtype_text ?? sp?.who ?? null,
        eln: rec?.risk_text ?? sp?.eln ?? null,
        ...(hasOwn(sp, 'riskBasis') ? { riskBasis: sp.riskBasis } : {}),
        ...(hasOwn(sp, 'note') ? { note: sp.note } : {}),
      }
    : null

  const genes = rows(db, `SELECT * FROM molecular_marker WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((g) => ({
      name: g.marker,
      status: GENE_STATUS_OUT[g.status] ?? g.status,
      vaf: g.value_text,
      method: g.method,
      d: g.specimen_date,
      explain: g.note,
    }))

  const consults = rows(db, `SELECT * FROM consult_note WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((c) => ({ d: c.consult_date, place: c.institution, text: c.content }))

  return {
    timeline: obj(pres.dx).timeline ?? [],
    precisionNote: obj(pres.dx).precisionNote ?? null,
    subtype,
    genes,
    untestedNote: obj(pres.dx).untestedNote ?? null,
    marrowClarify: obj(pres.dx).marrowClarify ?? null,
    consults,
  }
}

/* ---------------- K1：诱导/巩固日历（按天） ---------------- */

function readTx(db, key, pres) {
  const txPres = obj(pres.tx)
  const cal = obj(txPres.calendar)
  const extras = obj(txPres.calendarDayExtras)
  const statuses = Array.isArray(txPres.cycleStatus) ? txPres.cycleStatus : []

  /* 逐日行：ORDER BY day_index（日期字符串与 day_index 一致时也一样，但 day_index 是权威）。
     K1：没有"疗程"聚合判定列，读模型也不造：只有逐日的日期、药名原文与当日附加标记。 */
  const daily = rows(db, `SELECT * FROM tx_calendar_day WHERE profile_id = ? ORDER BY day_index, rowid`, key)
    .map((r) => {
      const extra = obj(extras[String(r.day_index)])
      const marks = r.drugs_text ? String(r.drugs_text).split(/\s*\/\s*/).filter(Boolean) : []
      return {
        d: r.actual_date ?? r.plan_date,
        day: r.day_index,
        marks,
        transfusion: extra.transfusion ?? 0,
        notes: extra.notes ?? [],
        ...(hasOwn(extra, 'fever') ? { fever: extra.fever } : {}),
      }
    })

  const cycles = rows(db, `SELECT * FROM tx_phase WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((c, i) => ({
      n: i + 1,
      kind: c.cycle_label,
      start: c.start_date,
      end: c.end_date,
      status: statuses[i] ?? null,
      result: c.outcome_note,
    }))

  return {
    cycles,
    calendar: {
      label: cal.label ?? null,
      anchor: cal.anchor ?? null,
      days: cal.days ?? null,
      drugs: cal.drugs ?? [],
      bands: cal.bands ?? [],
      daily,
      legend: cal.legend ?? null,
    },
    planVsActual: txPres.planVsActual ?? [],
    planNote: txPres.planNote ?? null,
    pathway: txPres.pathway ?? [],
    cons: txPres.cons ?? null,
    pending: txPres.pending ?? [],
    pendingNote: txPres.pendingNote ?? null,
  }
}

/* ---------------- K2：粒缺发热轨道（只给事实，不给判定） ---------------- */

/**
 * 发热轨道：episodes（含小时级体温与事件原文）+ 输注 + 黏膜炎 + 感染 + 预防用药原文。
 *
 * **这里没有任何"是否急症/是否粒缺发热"的字段**（K2）。前端拿到 temps 后按
 * meta.feverDef 的原文定义自己分流（classifyTemp），check-fever-rule 守住这条。
 * 输注成分分列、只做红细胞单位累计（K5：不判依赖）。
 */
export function readFeverTrack(db, key, pres, { includePrivate = false } = {}) {
  const np = obj(pres.neu)
  const ancByDate = new Map(rows(db, `SELECT measured_at, value_num FROM metric_point
    WHERE profile_id = ? AND code = 'ANC' AND in_use = 1 ORDER BY measured_at, rowid`, key)
    .map((p) => [p.measured_at, p.value_num]))

  const ids = Array.isArray(np.episodeIds) ? np.episodeIds : []
  const ancDates = Array.isArray(np.episodeAncDates) ? np.episodeAncDates : []
  const ancNotes = Array.isArray(np.episodeAncNotes) ? np.episodeAncNotes : []

  const episodes = rows(db, `SELECT * FROM fever_episode WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((ep, i) => {
      const temps = rows(db, `SELECT * FROM temperature_reading WHERE profile_id = ? AND episode_id = ?
        ORDER BY measured_at, rowid`, key, ep.id)
        .filter((t) => includePrivate || t.visibility !== 'private')
        .map((t) => ({ ts: t.measured_at, v: t.value_c, author: authorOf(t.author_role) }))
      const events = rows(db, `SELECT * FROM fever_event WHERE profile_id = ? AND episode_id = ?
        ORDER BY event_at, rowid`, key, ep.id)
        .map((ev) => ({
          ts: ev.event_at,
          kind: FEVER_KIND_OUT[ev.kind] ?? String(ev.kind).toLowerCase(),
          text: ev.text,
          ...(ev.note === null ? {} : { note: ev.note }),
        }))
      const ancDate = ancDates[i] ?? null
      const ancNote = ancNotes[i] ?? null
      return {
        id: ids[i] ?? `ep${ep.id}`,
        label: ep.label,
        from: ep.started_at,
        to: ep.ended_at,
        ...(ancDate === null
          ? {}
          : { anc: { v: ancByDate.get(ancDate) ?? null, d: ancDate, ...(ancNote === null ? {} : { note: ancNote }) } }),
        temps,
        events,
        outcome: ep.outcome_note,
      }
    })

  const preList = Array.isArray(np.transfusionPre) ? np.transfusionPre : []
  const transfusions = rows(db, `SELECT * FROM transfusion_event WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((t, i) => {
      const attr = [t.irradiated ? '辐照' : '', t.leukoreduced ? '去白' : ''].filter(Boolean).join('')
      return {
        d: t.event_date,
        comp: COMPONENT_OUT[t.component] ?? t.component,
        units: t.units_text,
        pre: preList[i] ?? null,
        reaction: t.reaction,
        attr: attr || null,
      }
    })

  const measureList = Array.isArray(np.oralMeasure) ? np.oralMeasure : []
  const oral = rows(db, `SELECT * FROM mucositis_log WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((o, i) => ({
      d: o.logged_at,
      grade: o.grade_text,
      eat: o.symptom_text,
      measure: measureList[i] ?? null,
    }))

  const infections = rows(db, `SELECT * FROM infection_record WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((x) => ({ d: x.onset_date, name: x.site_text, detail: x.organism_text }))

  /* 未归属到任何发热期的体温：用户在"没有进行中的发热期"时连录的读数。
     不能丢（丢了就是"我明明量了却看不到"），也不能硬塞进旧发热期（那是编造时间线），
     所以单列一组，标签如实说明它还没被归到某次发热里——是否归入由医护/本人决定。
     演示数据里没有这类记录，因此这一组为空时**不加键**（parity 与原型逐字段一致）。 */
  const loose = rows(db, `SELECT * FROM temperature_reading
    WHERE profile_id = ? AND episode_id IS NULL ORDER BY measured_at, rowid`, key)
    .filter((t) => includePrivate || t.visibility !== 'private')
  if (loose.length) {
    episodes.push({
      id: 'unassigned',
      label: '未归属发热期的体温记录',
      from: loose[0].measured_at,
      to: loose.at(-1).measured_at,
      temps: loose.map((t) => ({ ts: t.measured_at, v: t.value_c, author: authorOf(t.author_role) })),
      events: [],
      outcome: null,
    })
  }

  const fever = {
    /* 原型 demo1 显式给了 defText:null；没有这个键的档案不补键（显式 null ≠ 缺省）。 */
    ...(np.hasFeverDefText === true ? { defText: np.feverDefText ?? null } : {}),
    episodes,
    guardNote: np.feverGuardNote ?? null,
  }

  return {
    fever,
    transfusions,
    transfusionNote: np.transfusionsNote ?? null,
    oral,
    oralNote: np.oralNote ?? null,
    infections,
    prophylaxis: np.prophylaxis ?? null,
    vaccineNote: np.vaccineNote ?? null,
  }
}

/* ---------------- K3：MRD 双口径 ---------------- */

function readMrd(db, key, pres) {
  const mp = obj(pres.mrd)
  const all = rows(db, `SELECT * FROM mrd_result WHERE profile_id = ? ORDER BY method, measured_at, rowid`, key)
  const extra = obj(mp.extra)
  const build = (method) => {
    const meta = Array.isArray(extra[method]) ? extra[method] : []
    return all.filter((r) => r.method === method).map((r, i) => ({
      d: r.measured_at,
      v: meta[i]?.v ?? null,
      neg: Boolean(meta[i]?.neg),
      label: r.value_text,
      src: meta[i]?.src ?? null,
    }))
  }
  const sites = Array.isArray(pres.marrowSites) ? pres.marrowSites : []
  const marrows = rows(db, `SELECT * FROM marrow_procedure WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((m, i) => ({
      d: m.done_on,
      site: sites[i] ?? null,
      blast: m.result_text,
      result: m.purpose_text,
    }))
  /* K3：两列并列，不合并、不换算；没有复发判定字段。 */
  return {
    flow: build('FLOW'),
    pcr: build('PCR'),
    warn1: mp.warn1 ?? null,
    warn2: mp.warn2 ?? null,
    untestedNote: mp.untestedNote ?? null,
    methodNote: mp.methodNote ?? null,
    marrows,
    rhythm: mp.rhythm ?? [],
  }
}

/* ---------------- K4：移植评估（零推荐） ---------------- */

function readTp(db, key, pres) {
  const tp = obj(pres.tp)
  const ev = db.prepare('SELECT * FROM transplant_eval WHERE profile_id = ? ORDER BY ord, rowid LIMIT 1').get(key) ?? null
  const donor = db.prepare('SELECT * FROM donor_record WHERE profile_id = ? ORDER BY ord, rowid LIMIT 1').get(key) ?? null
  const gvhd = rows(db, `SELECT * FROM gvhd_log WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((g) => ({
      d: g.logged_at,
      organ: g.organ_text,
      grade: g.grade_text,
      treatment: g.treatment_text,
      author: authorOf(g.author_role),
    }))
  return {
    status: ev?.status_text ?? null,
    statusFlow: tp.statusFlow ?? [],
    statusNote: tp.statusNote ?? null,
    evalItems: jp(ev?.items_text, []) ?? [],
    /* 0.6.0：还没有供者记录的档案（三步初始化后的新档案）给空形状而非 null——
       页面按"暂无记录"渲染（type/rel/hla 为 null → 显示 —），不造任何供者事实。 */
    donor: donor
      ? {
          type: donor.donor_type,
          rel: donor.relation_text,
          hla: donor.hla_text,
          note: donor.search_note,
          ...(tp.donorOtherTypes === undefined || tp.donorOtherTypes === null ? {} : { otherTypes: tp.donorOtherTypes }),
        }
      /* 0.6.0：还没有供者记录的档案（三步初始化后的新档案）给空形状而非 null——
         页面按"暂无记录"渲染（type/rel/hla 为 null → 显示 —），不造任何供者事实。 */
      : { type: null, rel: null, hla: null, note: null },
    doctorReply: ev?.doctor_reply ?? null,
    dayAxis: tp.dayAxis ?? { mode: 'pending', day0: null, milestones: [], note: null },
    gvhd,
    zeroRec: tp.zeroRec ?? null,
  }
}

/* ---------------- K6：心理与家庭（按 kind 分节 + private 过滤） ---------------- */

export function readMind(db, key, pres, { includePrivate = false } = {}) {
  const mp = obj(pres.mind)
  const all = rows(db, `SELECT * FROM feeling_note WHERE profile_id = ? ORDER BY ord, rowid`, key)
  const roleLabel = (author) => (author === 'caregiver'
    ? (mp.caregiverRoleLabel ?? '照护者')
    : (mp.patientRoleLabel ?? '患者本人'))
  const shape = (r) => {
    const author = authorOf(r.author_role)
    return {
      d: r.logged_at,
      author,
      role: roleLabel(author),
      text: r.content,
      visibility: r.visibility === 'private' ? 'private' : 'shared',
    }
  }
  const visible = all.filter((r) => includePrivate || r.visibility !== 'private')

  const out = {}
  for (const section of FEELING_SECTIONS) {
    const list = visible.filter((r) => r.kind === section.kind).map(shape)
    if (section.key === 'death') out.death = { items: list, note: mp.deathNote ?? null }
    else out[section.key] = list
  }
  out.note = mp.note ?? null
  return { mind: out, privateCount: all.filter((r) => r.visibility === 'private').length }
}

/* ---------------- 资料与复诊（试验只登记，不做匹配） ---------------- */

function readDocs(db, key, pres, pendingCandidates) {
  const dp = obj(pres.docs)
  const kinds = Array.isArray(dp.materialKinds) ? dp.materialKinds : []
  const materials = rows(db, `SELECT * FROM document WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((d, i) => ({ name: d.file_name, kind: kinds[i] ?? null, status: statusOut(d.status) }))

  const questions = rows(db, `SELECT * FROM question WHERE profile_id = ? ORDER BY ord, rowid`, key)
    .map((q) => ({ text: q.content, asked: q.asked_on !== null, src: q.from_scenario }))

  /* 试验线索：saved_trial 只登记 key（表里没有条目正文）；条目正文来自临床研究线
     （GET /api/aml/trials，35 号 v2）。这里不做匹配，也不做打分或排序。 */
  const saved = new Set(rows(db, 'SELECT trial_key FROM saved_trial WHERE profile_id = ?', key).map((r) => r.trial_key))
  const trials = (dp.trials ?? []).filter((t) => saved.has(`${t.nct ?? 'NCT'}·${t.name ?? ''}`))

  /* 导入产生的候选（不是事实）：与演示候选并列，进入「整理草稿与核对」。
     0.6.0 起候选有三类（化验 / 诊断 / 治疗），诊断与治疗带原文 quote，逐字段如实带出。 */
  const imported = pendingCandidates
    .filter((c) => c.profileId === key)
    .map((c) => {
      if (c.kind === 'diagnosis') {
        return {
          id: c.id,
          kind: 'diagnosis',
          title: `解析候选 · ${c.field}（待核对）`,
          fields: [['字段', c.field], ['原文', c.quote ?? ''], ['出处', c.src]],
          quote: c.quote ?? '',
          src: c.src,
        }
      }
      if (c.kind === 'treatment') {
        const plan = c.plan && typeof c.plan === 'object' ? c.plan : {}
        return {
          id: c.id,
          kind: 'treatment',
          title: `解析候选 · ${c.field}（待核对）`,
          fields: [
            ['字段', c.field],
            ['原文', c.quote ?? ''],
            ['方案名', plan.name ?? ''],
            ['药物清单', Array.isArray(plan.drugs) ? plan.drugs.join(' / ') : ''],
            ['开始日期', plan.start_date ?? '（原文未见，确认时补录 D1）'],
            ['出处', c.src],
          ],
          quote: c.quote ?? '',
          plan,
          src: c.src,
        }
      }
      return {
        id: c.id,
        kind: 'metric',
        title: `解析候选 · ${c.field}（待核对）`,
        fields: [['字段', c.field], ['值', `${c.value}${c.unit ? ` ${c.unit}` : ''}`], ['出处', c.src]],
        src: c.src,
      }
    })

  return {
    materials,
    candidates: [...(dp.candidates ?? []), ...imported],
    questions,
    trials,
    exportNote: dp.exportNote ?? null,
  }
}

/* ---------------- 档案整体 ---------------- */

/**
 * 读一个档案。默认 private 过滤（三出口同一口径），并附 privateCount
 * 让界面显示"还有 N 条本人确认后可见"。
 */
export function getProfile(db, key, { includePrivate = false } = {}) {
  const found = db.prepare('SELECT * FROM profile WHERE id = ?').get(key)
  if (!found) return null

  const state = readWorkspaceState(db)
  const pres = obj(state.presentation[key])
  const mind = readMind(db, key, pres, { includePrivate })

  return {
    id: found.id,
    name: found.name,
    age: pres.age ?? null,
    gender: found.gender ?? null,
    diagnosis: pres.diagnosis ?? null,
    diagnosisShort: pres.diagnosisShort ?? null,
    stageLine: pres.stageLine ?? null,
    caregiver: pres.caregiverLabel ?? null,
    dash: pres.dash ?? null,
    dx: readDx(db, key, pres),
    tx: readTx(db, key, pres),
    neu: readFeverTrack(db, key, pres, { includePrivate }),
    mrd: readMrd(db, key, pres),
    tp: readTp(db, key, pres),
    /* 0.6.0：三步初始化后的新档案还没有叙述层（pres.care 不存在）——给空集合形状，
       页面按"暂无记录"渲染；不造任何食量/食物安全事实。 */
    care: pres.care ?? { meals: [], safe: [], inout: [], weightNote: null },
    mind: mind.mind,
    docs: readDocs(db, key, pres, state.pendingCandidates),
    metrics: { numeric: readMetricSeries(db, key) },
    ferritin: readFerritin(db, key),
    /** 服务端附加：private 条数（原型没有这个键，只多不少）。 */
    privateCount: mind.privateCount,
  }
}

export function listProfiles(db) {
  return rows(db, 'SELECT id, name FROM profile ORDER BY rowid')
}

/** `/api/aml/bootstrap` 的 payload：与原型 DEMO_DATA 同形（meta + profiles 数组），外加版本与布局。
 *  0.6.0：profiles 为空时带 needsOnboarding:true——前端据此显示「三步开始」向导而不是空态横幅。 */
export function bootstrap(db, { version, build } = {}) {
  const { meta } = readWorkspaceState(db)
  const profiles = listProfiles(db).map((s) => getProfile(db, s.id))
  return {
    version: version ?? null,
    build: build ?? null,
    meta,
    profiles,
    needsOnboarding: profiles.length === 0,
    agent: { available: true, mode: 'dev-mount' },
    layout: { agentPane: AGENT_PANE },
  }
}
