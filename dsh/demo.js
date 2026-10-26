/**
 * 演示数据播种（小橙宝 AML · M5）。
 *
 * 唯一数据源是 prototypes/v0.2/demo-data.js（经 demo/build-demo-data.mjs 求值成
 * demo/demo-data.json 与 demo/demo-data.sqlite）。本文件把同一份纯数据按 0001 冻结
 * schema 的 30 张表拆开写入，读模型（dsh/readmodels.js）再把它拼回原型形状——
 * 拆与拼不一致就是 demo-parity 测试（test/demo-parity.test.mjs）要抓的问题。
 *
 * 拆分口径（哪类数据落在哪张表；0001 已冻结，只能这样放）：
 * - ANC/WBC/Hb/PLT/体重/铁蛋白 → metric_def + metric_point。四类血象 category='cbc'
 *   （neu 血象趋势只取这一类）；体重 category='body'；铁蛋白 category='inflammation'。
 *   K2：**不写任何"是否急症/是否粒缺发热"的列或值**——判定由前端按定义原文分流。
 * - 体温 → temperature_reading（measured_at 到分钟，小时级轨道）；发热事件 → fever_event；
 *   发热期 → fever_episode（anc 的数值取自 metric_point，说明文字属叙述层）。
 * - 诱导/巩固日历 → tx_calendar_day（day_index 逐日，plan_date=当天日期）；
 *   疗程（cycle）→ tx_phase；日历的方案带/药物表/图例与每日附加标记（输注标记、备注、
 *   当日最高最低温）→ 叙述层（冻结 schema 没有对应列）。
 * - MRD → mrd_result（method FLOW/PCR 分列，value_text 存报告原文标签）；数值与出处
 *   文字属叙述层（无对应列；跨方法不可换算，故不另建合并列）。
 * - 移植 → transplant_eval（评估项以 JSON 存 items_text，逐项原样）+ donor_record + gvhd_log。
 * - 输注 → transfusion_event（成分映射 RBC/PLATELET/PLASMA；辐照/去白拆两列）；
 *   输注前血象原文属叙述层。
 * - 黏膜炎 → mucositis_log（grade_text=分级原文、symptom_text=进食能力）；措施原文属叙述层。
 * - 感染 → infection_record（site_text=感染名、organism_text=经过原文）。
 * - 骨穿 → marrow_procedure（result_text=原始细胞报告原文、purpose_text=这次取材的用途）；
 *   部位属叙述层。
 * - 感受/对死亡的准备/家庭负担 → feeling_note（kind FEEL / DEATH_PREP / BURDEN；
 *   shared→public，private→private；author_role=PATIENT/CAREGIVER）。
 * - 问题 → question；资料文件 → document；试验线索 → saved_trial（只登记 key，
 *   条目正文属叙述层：冻结 schema 没有试验条目表，且本期不实现匹配）。
 * - 其余"叙述层"（看板文案、确诊时间线、亚型/分层原文、基因解释、日历方案带、
 *   治疗路径折叠卡、等待清单、各页 note/口径）统一进 workspace.dataset_state 的
 *   presentation（按 profile id 分键——本台是双档案）。
 *
 * 幂等：库里已有 profile 就整批跳过。事务：整批一个事务，失败整体回滚。
 */

import { createHash } from 'node:crypto'

const j = (v) => (v === undefined ? null : JSON.stringify(v))
/** null 原样保留：原型里"没有这个属性"与"属性为 null"是两种意思，不在这里合并。 */
const flag = (v) => (v === null || v === undefined ? null : v ? 1 : 0)
/** 原型 author（patient/caregiver）→ schema author_role（PATIENT/CAREGIVER）。 */
const roleIn = (r) => (r === 'caregiver' || r === 'FAMILY' || r === 'CAREGIVER' ? 'CAREGIVER' : 'PATIENT')
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

const COMPONENT = { 红细胞: 'RBC', 血小板: 'PLATELET', 血浆: 'PLASMA' }
const FEVER_KIND = { call: 'CALL', culture: 'CULTURE', antibiotic: 'ANTIBIOTIC', escalate: 'ESCALATE', deescalate: 'DEESCALATE' }
const GENE_STATUS_IN = { 突变型: 'detected', 野生型: 'not_detected', 未测: 'not_tested' }
const FEELING_KIND = { feels: 'FEEL', death: 'DEATH_PREP', burden: 'BURDEN' }

/** metric_def 种子：四类血象（cbc，唯一进 neu 血象趋势）+ 体重 + 铁蛋白。 */
export const METRIC_DEFS = [
  { code: 'ANC', label: 'ANC（中性粒细胞绝对值）', unit: '×10⁹/L', category: 'cbc', color: '#1F6E6B', ord: 1 },
  { code: 'WBC', label: 'WBC（白细胞）', unit: '×10⁹/L', category: 'cbc', color: '#5B8FA3', ord: 2 },
  { code: 'Hb', label: 'Hb（血红蛋白）', unit: 'g/L', category: 'cbc', color: '#B3372E', ord: 3 },
  { code: 'PLT', label: 'PLT（血小板）', unit: '×10⁹/L', category: 'cbc', color: '#9A6B12', ord: 4 },
  { code: 'WEIGHT', label: '体重', unit: 'kg', category: 'body', color: '#C46A2B', ord: 5 },
  { code: 'SF', label: '血清铁蛋白', unit: 'μg/L', category: 'inflammation', color: '#6B4F9E', ord: 6 },
]

/** 疗程 kind → tx_phase.phase（只做枚举映射，不评疗效）。 */
function phaseOf(kind) {
  const t = String(kind ?? '')
  if (/诱导/.test(t)) return 'INDUCTION'
  if (/巩固/.test(t)) return 'CONSOLIDATION'
  if (/维持/.test(t)) return 'MAINTENANCE'
  if (/强化/.test(t)) return 'INTENSIFICATION'
  /* ven+aza 类：第 1 程视为初始治疗，其余按后续疗程记 */
  return /第\s*1\s*程/.test(t) ? 'INDUCTION' : 'CONSOLIDATION'
}

/**
 * 叙述层：原型里没有规范化列的字段，按 profile 收进一个 JSON 存 workspace.dataset_state。
 * 这里只搬运，不做任何改写——demo-parity 逐字段比对的就是"搬完再拼回来是否一字不差"。
 */
export function buildPresentation(p) {
  const cal = p.tx?.calendar ?? {}
  const dayExtras = {}
  for (const row of cal.daily ?? []) {
    const extra = {}
    if (row.transfusion) extra.transfusion = row.transfusion
    if (Array.isArray(row.notes) && row.notes.length) extra.notes = row.notes
    if (row.fever) extra.fever = row.fever
    if (Object.keys(extra).length) dayExtras[String(row.day)] = extra
  }

  return {
    age: p.age ?? null,
    diagnosis: p.diagnosis ?? null,
    diagnosisShort: p.diagnosisShort ?? null,
    stageLine: p.stageLine ?? null,
    caregiverLabel: p.caregiver ?? null,
    dash: p.dash ?? null,

    dx: {
      timeline: p.dx?.timeline ?? [],
      precisionNote: p.dx?.precisionNote ?? null,
      subtype: p.dx?.subtype ?? null,
      untestedNote: p.dx?.untestedNote ?? null,
      marrowClarify: p.dx?.marrowClarify ?? null,
    },

    tx: {
      calendar: {
        label: cal.label ?? null,
        anchor: cal.anchor ?? null,
        days: cal.days ?? null,
        drugs: cal.drugs ?? [],
        bands: cal.bands ?? [],
        legend: cal.legend ?? null,
      },
      calendarDayExtras: dayExtras,
      cycleStatus: (p.tx?.cycles ?? []).map((c) => c.status ?? null),
      planVsActual: p.tx?.planVsActual ?? [],
      planNote: p.tx?.planNote ?? null,
      pathway: p.tx?.pathway ?? [],
      cons: p.tx?.cons ?? null,
      pending: p.tx?.pending ?? [],
      pendingNote: p.tx?.pendingNote ?? null,
    },

    neu: {
      transfusionPre: (p.neu?.transfusions ?? []).map((t) => t.pre ?? null),
      transfusionsNote: p.neu?.transfusionNote ?? null,
      oralMeasure: (p.neu?.oral ?? []).map((o) => o.measure ?? null),
      oralNote: p.neu?.oralNote ?? null,
      prophylaxis: p.neu?.prophylaxis ?? null,
      vaccineNote: p.neu?.vaccineNote ?? null,
      /* 原型有 defText 这个键（demo1 显式 null / demo2 无此键）：记下"有没有这个键"，
         读模型据此决定透出 null 还是干脆不给键——显式 null 与缺省是两种意思。 */
      hasFeverDefText: Object.prototype.hasOwnProperty.call(p.neu?.fever ?? {}, 'defText'),
      feverDefText: p.neu?.fever?.defText ?? null,
      feverGuardNote: p.neu?.fever?.guardNote ?? null,
      /* 每个发热期的展示 id 与 ANC 日期/说明文字（ANC 数值本身取自 metric_point）。 */
      episodeIds: (p.neu?.fever?.episodes ?? []).map((e) => e.id ?? null),
      episodeAncDates: (p.neu?.fever?.episodes ?? []).map((e) => e.anc?.d ?? null),
      episodeAncNotes: (p.neu?.fever?.episodes ?? []).map((e) => e.anc?.note ?? null),
    },

    mrd: {
      warn1: p.mrd?.warn1 ?? null,
      warn2: p.mrd?.warn2 ?? null,
      untestedNote: p.mrd?.untestedNote ?? null,
      methodNote: p.mrd?.methodNote ?? null,
      rhythm: p.mrd?.rhythm ?? [],
      /** 双口径的数值与出处文字（无对应列；方法列在表里，跨方法不可换算）。 */
      extra: {
        FLOW: (p.mrd?.flow ?? []).map((x) => ({ v: x.v ?? null, neg: !!x.neg, src: x.src ?? null })),
        PCR: (p.mrd?.pcr ?? []).map((x) => ({ v: x.v ?? null, neg: !!x.neg, src: x.src ?? null })),
      },
    },

    tp: {
      statusNote: p.tp?.statusNote ?? null,
      statusFlow: p.tp?.statusFlow ?? [],
      doctorReply: p.tp?.doctorReply ?? null,
      dayAxis: p.tp?.dayAxis ?? null,
      zeroRec: p.tp?.zeroRec ?? null,
      donorOtherTypes: p.tp?.donor?.otherTypes ?? null,
    },

    care: p.care ?? null,

    mind: {
      note: p.mind?.note ?? null,
      /** 「对死亡的准备」分节自己的说明（原型里 death.note 与 mind.note 不是同一句）。 */
      deathNote: p.mind?.death?.note ?? null,
      caregiverRoleLabel: p.mind?.feels?.find((x) => x.author === 'caregiver')?.role
        ?? p.mind?.burden?.find((x) => x.author === 'caregiver')?.role
        ?? null,
      patientRoleLabel: p.mind?.feels?.find((x) => x.author === 'patient')?.role ?? '患者本人',
    },

    docs: {
      materials: p.docs?.materials ?? [],
      /** 材料类型（PDF/图片）在冻结 schema 里没有列，随叙述层按 ord 对齐。 */
      materialKinds: (p.docs?.materials ?? []).map((m) => m.kind ?? null),
      candidates: p.docs?.candidates ?? [],
      trials: p.docs?.trials ?? [],
      exportNote: p.docs?.exportNote ?? null,
    },

    /** 骨穿部位（mrd.marrows 按 ord 对齐）。 */
    marrowSites: (p.mrd?.marrows ?? []).map((x) => x.site ?? null),
  }
}

/** 把 buildDemoPayload() 的数据写进库。返回写入计数。data 形如 { meta, profiles: [profile] }。 */
export function seedDemo(db, input) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('seedDemo 需要一个已打开的数据库')
  const data = input
  if (!data || !Array.isArray(data.profiles) || !data.profiles.length) throw new TypeError('seedDemo 需要 { meta, profiles: [...] }')

  const already = db.prepare('SELECT COUNT(*) AS n FROM profile').get().n
  if (already > 0) return { skipped: true, profiles: 0, points: 0, events: 0, temperatures: 0 }

  const counts = { skipped: false, profiles: 0, points: 0, events: 0, temperatures: 0 }
  const today = data.meta?.today || '2026-10-26'
  const presentation = {}

  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO workspace (id, data_root, schema_version, dataset_state)
      VALUES (1, NULL, '0001', ?)`).run(j({ meta: data.meta ?? {}, presentation: {} }))

    const insProfile = db.prepare(`INSERT INTO profile
      (id, name, birth_date, gender, primary_role, cognitive_flag, created_at) VALUES (?,?,?,?,?,?,?)`)
    const insMetricDef = db.prepare(`INSERT INTO metric_def (code, label, unit, category, color, is_numeric, ord)
      VALUES (?,?,?,?,?,?,?)`)
    const insPoint = db.prepare(`INSERT INTO metric_point
      (profile_id, code, measured_at, value_num, value_text, unit, ref_range_text, source_note, author_role, in_use, revision)
      VALUES (?,?,?,?,?,?,?,?,?,1,1)`)
    const insDiagnosis = db.prepare(`INSERT INTO diagnosis_record
      (profile_id, confirmed_on, subtype_text, risk_text, marrow_text, report_doc_id, ord, revision)
      VALUES (?,?,?,?,?,?,?,1)`)
    const insMarker = db.prepare(`INSERT INTO molecular_marker
      (profile_id, marker, status, value_text, method, specimen_date, report_doc_id, note, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,?,1)`)
    const insConsult = db.prepare(`INSERT INTO consult_note
      (profile_id, consult_date, kind, content, institution, report_doc_id, ord, revision)
      VALUES (?,?,?,?,?,?,?,1)`)
    const insCalendarDay = db.prepare(`INSERT INTO tx_calendar_day
      (profile_id, cycle_label, day_index, plan_date, actual_date, drugs_text, done, delay_reason, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,?,1)`)
    const insPhase = db.prepare(`INSERT INTO tx_phase
      (profile_id, cycle_label, phase, start_date, end_date, plan_text, outcome_note, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,1)`)
    const insEpisode = db.prepare(`INSERT INTO fever_episode
      (profile_id, label, started_at, ended_at, outcome_note, ord, revision) VALUES (?,?,?,?,?,?,1)`)
    const insTemp = db.prepare(`INSERT INTO temperature_reading
      (profile_id, episode_id, measured_at, value_c, site, author_role, visibility, ord) VALUES (?,?,?,?,?,?,?,?)`)
    const insFeverEvent = db.prepare(`INSERT INTO fever_event
      (profile_id, episode_id, event_at, kind, text, note, author_role, ord) VALUES (?,?,?,?,?,?,?,?)`)
    const insTransfusion = db.prepare(`INSERT INTO transfusion_event
      (profile_id, event_date, component, units_text, irradiated, leukoreduced, reaction, author_role, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,?,1)`)
    const insMucositis = db.prepare(`INSERT INTO mucositis_log
      (profile_id, logged_at, grade_text, site, symptom_text, author_role, ord) VALUES (?,?,?,?,?,?,?)`)
    const insInfection = db.prepare(`INSERT INTO infection_record
      (profile_id, onset_date, site_text, organism_text, treatment_text, resolved_on, report_doc_id, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,1)`)
    const insMrd = db.prepare(`INSERT INTO mrd_result
      (profile_id, measured_at, method, value_text, sensitivity_text, specimen, report_doc_id, ord, revision)
      VALUES (?,?,?,?,?,?,?,?,1)`)
    const insMarrow = db.prepare(`INSERT INTO marrow_procedure
      (profile_id, done_on, purpose_text, result_text, report_doc_id, ord, revision) VALUES (?,?,?,?,?,?,1)`)
    const insEval = db.prepare(`INSERT INTO transplant_eval
      (profile_id, eval_date, status_text, items_text, doctor_reply, ord, revision) VALUES (?,?,?,?,?,?,1)`)
    const insDonor = db.prepare(`INSERT INTO donor_record
      (profile_id, donor_type, relation_text, hla_text, search_note, confirmed_on, ord, revision)
      VALUES (?,?,?,?,?,?,?,1)`)
    const insGvhd = db.prepare(`INSERT INTO gvhd_log
      (profile_id, logged_at, organ_text, grade_text, treatment_text, author_role, ord) VALUES (?,?,?,?,?,?,?)`)
    const insFeeling = db.prepare(`INSERT INTO feeling_note
      (profile_id, logged_at, kind, content, author_role, visibility, ord) VALUES (?,?,?,?,?,?,?)`)
    const insQuestion = db.prepare(`INSERT INTO question
      (profile_id, kind, content, created_at, asked_on, from_scenario, ord) VALUES (?,?,?,?,?,?,?)`)
    const insDoc = db.prepare(`INSERT INTO document
      (profile_id, file_name, sha256, status, imported_at, ord) VALUES (?,?,?,?,?,?)`)
    const insTrial = db.prepare(`INSERT INTO saved_trial (profile_id, trial_key, saved_at) VALUES (?,?,?)`)

    for (const m of METRIC_DEFS) insMetricDef.run(m.code, m.label, m.unit, m.category, m.color, 1, m.ord)

    for (const p of data.profiles) {
      presentation[p.id] = buildPresentation(p)
      insProfile.run(p.id, p.name, null, p.gender ?? null, 'PATIENT', 'stable', today)
      counts.profiles++

      /* ---- 指标：血象 + 体重 + 铁蛋白（K2：不写任何判定列/值） ---- */
      for (const [code, list] of Object.entries(p.metrics?.numeric ?? {})) {
        for (const pt of list ?? []) {
          insPoint.run(p.id, code, pt.d, typeof pt.v === 'number' ? pt.v : null,
            typeof pt.v === 'number' ? null : String(pt.v ?? ''), null, null, null, 'PATIENT')
          counts.points++
        }
      }
      for (const f of p.ferritin ?? []) {
        insPoint.run(p.id, 'SF', f.d, typeof f.v === 'number' ? f.v : null,
          typeof f.v === 'number' ? null : String(f.v ?? ''), 'μg/L', null,
          j({ note: f.note ?? null }), 'PATIENT')
        counts.points++
      }

      /* ---- 诊断与基因（分层只存医院结论原文，不计算） ---- */
      const timeline = p.dx?.timeline ?? []
      const confirmed = timeline.find((x) => /骨髓涂片形态学/.test(x.item))?.d
        ?? timeline.find((x) => x.precision === 'day')?.d ?? null
      insDiagnosis.run(p.id, confirmed, p.dx?.subtype?.who ?? null, p.dx?.subtype?.eln ?? null, null, null, 0)
      for (const [i, g] of (p.dx?.genes ?? []).entries()) {
        /* specimen_date 原样写：原型里"未测"项的 d 是空串（不是 null），含义是"这项没日期"，
           与"有日期但未知"不同；读模型照抄回来，不在这里归一。 */
        insMarker.run(p.id, g.name, GENE_STATUS_IN[g.status] ?? 'not_tested', g.vaf ?? null,
          g.method ?? null, g.d ?? null, null, g.explain ?? null, i)
      }
      for (const [i, c] of (p.dx?.consults ?? []).entries()) {
        insConsult.run(p.id, c.d, 'MDT', c.text ?? '', c.place ?? null, null, i)
      }

      /* ---- K1：诱导/巩固日历按天（day_index 逐日，无疗程聚合判定） ---- */
      const cal = p.tx?.calendar ?? {}
      for (const [i, row] of (cal.daily ?? []).entries()) {
        insCalendarDay.run(p.id, cal.label ?? '疗程', row.day, row.d, row.d,
          (row.marks ?? []).join(' / ') || null, 0, null, i)
      }
      /* 疗程（cycle）→ tx_phase；status 属叙述层（无列）。 */
      for (const [i, c] of (p.tx?.cycles ?? []).entries()) {
        insPhase.run(p.id, c.kind ?? `疗程 ${c.n}`, phaseOf(c.kind), c.start ?? null, c.end ?? null,
          null, c.result ?? null, i)
      }

      /* ---- K2：粒缺发热（小时级体温 + 事件原文；判定不入库） ---- */
      for (const [ei, ep] of (p.neu?.fever?.episodes ?? []).entries()) {
        const episodeId = Number(insEpisode.run(p.id, ep.label, ep.from, ep.to ?? null, ep.outcome ?? null, ei).lastInsertRowid)
        for (const [ti, t] of (ep.temps ?? []).entries()) {
          insTemp.run(p.id, episodeId, t.ts, t.v, null, roleIn(t.author), 'public', ti)
          counts.temperatures++
        }
        for (const [fi, ev] of (ep.events ?? []).entries()) {
          insFeverEvent.run(p.id, episodeId, ev.ts, FEVER_KIND[ev.kind] ?? 'CALL', ev.text ?? '',
            ev.note ?? null, null, fi)
          counts.events++
        }
      }

      /* ---- K5：输注独立轨道（成分分列；辐照/去白拆两列） ---- */
      for (const [i, t] of (p.neu?.transfusions ?? []).entries()) {
        const attr = String(t.attr ?? '')
        insTransfusion.run(p.id, t.d, COMPONENT[t.comp] ?? 'RBC', t.units ?? '', flag(/辐照/.test(attr) ? 1 : null),
          flag(/去白/.test(attr) ? 1 : null), t.reaction ?? null, 'PATIENT', i)
        counts.events++
      }

      /* ---- 黏膜炎 / 感染 ---- */
      for (const [i, o] of (p.neu?.oral ?? []).entries()) {
        insMucositis.run(p.id, o.d, o.grade ?? null, null, o.eat ?? null, 'PATIENT', i)
      }
      for (const [i, x] of (p.neu?.infections ?? []).entries()) {
        insInfection.run(p.id, x.d, x.name ?? null, x.detail ?? null, null, null, null, i)
        counts.events++
      }

      /* ---- K3：MRD 双口径（FLOW/PCR 分列，value_text 存报告原文标签） ---- */
      for (const [method, list] of [['FLOW', p.mrd?.flow ?? []], ['PCR', p.mrd?.pcr ?? []]]) {
        for (const [i, x] of list.entries()) {
          insMrd.run(p.id, x.d, method, x.label ?? null, null, /骨穿/.test(x.src ?? '') ? '骨髓' : null, null, i)
        }
      }
      for (const [i, m] of (p.mrd?.marrows ?? []).entries()) {
        insMarrow.run(p.id, m.d, m.result ?? null, m.blast ?? null, null, i)
      }

      /* ---- K4：移植评估（零推荐：只存原文与状态） ---- */
      const items = p.tp?.evalItems ?? []
      const evalDate = items.map((x) => x.d).filter(Boolean).sort().at(-1) ?? today
      insEval.run(p.id, evalDate, p.tp?.status ?? '', j(items), p.tp?.doctorReply ?? null, 0)
      const donor = p.tp?.donor
      if (donor) {
        insDonor.run(p.id, donor.type ?? '', donor.rel ?? null, donor.hla ?? null, donor.note ?? null, null, 0)
      }
      for (const [i, g] of (p.tp?.gvhd ?? []).entries()) {
        insGvhd.run(p.id, g.d ?? today, g.organ ?? null, g.grade ?? null, g.treatment ?? null, roleIn(g.author), i)
      }

      /* ---- K6：双主体感受（private → visibility='private'） ---- */
      let feelOrd = 0
      for (const [key, kind] of Object.entries(FEELING_KIND)) {
        const list = key === 'death' ? (p.mind?.death?.items ?? []) : (p.mind?.[key] ?? [])
        for (const x of list) {
          insFeeling.run(p.id, x.d, kind, x.text ?? '', roleIn(x.author),
            x.visibility === 'private' ? 'private' : 'public', feelOrd++)
          counts.events++
        }
      }

      /* ---- 就诊准备：问题 / 资料文件 / 试验线索（只登记） ---- */
      for (const [i, q] of (p.docs?.questions ?? []).entries()) {
        insQuestion.run(p.id, 'fact', q.text ?? '', today, q.asked ? (q.src ?? today) : null, q.src ?? null, i)
      }
      for (const [i, d] of (p.docs?.materials ?? []).entries()) {
        insDoc.run(p.id, d.name ?? '未命名', sha(`${p.id}:${d.name}`), /已核对/.test(d.status ?? '') ? 'parsed' : 'pending', today, i)
      }
      for (const t of (p.docs?.trials ?? [])) {
        insTrial.run(p.id, `${t.nct ?? 'NCT'}·${t.name ?? ''}`, today)
      }
    }

    db.prepare('UPDATE workspace SET dataset_state = ? WHERE id = 1')
      .run(j({ meta: data.meta ?? {}, presentation }))

    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 回滚失败也要把原始错误抛出去 */ }
    throw new Error(`播种演示数据失败（已回滚）：${error.message}`)
  }
  return counts
}

/** 库的演示档案是否已播种过。启动流程用它决定要不要 seedDemo。 */
export function hasDemoData(db) {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM profile').get().n > 0
  } catch {
    return false
  }
}
