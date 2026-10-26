/**
 * 导出：把档案整理成一份「就诊准备」markdown（给用户带去门诊，不是病历）。
 *
 * 三条硬约束（AML 红线）：
 * 1. **private 记录不进导出**：mind.death 里 visibility='private' 的条目一律剔除，
 *    并写明"有意排除"——否则用户以为数据丢了（三出口共用同一过滤口径）；
 * 2. **只抄不解释**：数值、单位、报告原句照抄；判读词一概不写
 *    （scripts/check-wording.mjs 拦"控制/建议调整/结果正常"这类话）；
 * 3. **两条 MRD 警示必须常驻**：转阴 ≠ 治愈、阳性 ≠ 一定复发——导出是会被带出门诊的东西，
 *    少了这两句，读者容易把一次阴/阳当成结论。
 *
 * K1：日历按天（导出只列疗程与关键节点，不做"疗效"汇总）；
 * K4：移植段只写状态、供者登记与医生答复原文，**零推荐**；
 * K5：输注按成分分列，只做红细胞单位累计，不判依赖。
 */

const LINE = '\n'

function table(headers, rowsData) {
  if (!rowsData.length) return ''
  const out = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const r of rowsData) {
    out.push(`| ${r.map((c) => (c === null || c === undefined || c === '' ? '—' : String(c))).join(' | ')} |`)
  }
  return out.join(LINE)
}

function section(title, body) {
  return body ? `${LINE}## ${title}${LINE}${LINE}${body}${LINE}` : ''
}

const fmtV = (pt) => `${pt.v}${pt.unit ? ` ${pt.unit}` : ''}`
const mmHg = (t) => `${t.v}℃`

/**
 * 渲染就诊准备 markdown。
 * @param {object} profile getProfile(includePrivate: true) 的完整档案
 * @param {object} opts { generatedAt, version, excludedPrivate }
 */
export function renderPrepMarkdown(profile, { generatedAt = null, version = null, excludedPrivate = false } = {}) {
  const p = profile
  const out = []

  out.push(`# 就诊准备 · ${p.name}`)
  out.push('')
  out.push(`> 由本人与家属整理的本机记录，不是医生结论；判读归血液科团队。${version ? `（小橙宝 OrangePal v${version}）` : ''}`)
  if (excludedPrivate) out.push('> 私密感受记录（private）已按设置有意排除，不出现在本摘要。')
  out.push('')

  if (p.diagnosis || p.stageLine) {
    out.push(section('诊断与阶段（原文照抄）', [
      p.diagnosis ? `- 诊断：${p.diagnosis}` : '',
      p.stageLine ? `- 阶段/分层：${p.stageLine}` : '',
      p.dx?.subtype?.who ? `- 亚型（报告原文）：${p.dx.subtype.who}` : '',
      p.dx?.subtype?.eln ? `- 分层结论（医院结论原文）：${p.dx.subtype.eln}` : '',
    ].filter(Boolean).join(LINE)))
  }

  /* 基因：逐项照抄状态与原文；未检测 ≠ 阴性必须在导出里也说清。 */
  const genes = p.dx?.genes ?? []
  if (genes.length) {
    out.push(section('基因与分子检测（只抄报告）', table(['项目', '状态', '原文', '方法', '日期'],
      genes.map((g) => [g.name, g.status, g.vaf, g.method, g.d ? g.d : '—']))))
    out.push(`> 未检测 ≠ 阴性：报告上没有的项，不代表"没有突变"。${p.dx?.untestedNote ? `（${p.dx.untestedNote}）` : ''}`)
  }

  /* K1：疗程按阶段列（不做疗程粒度的疗效判定，只有阶段、起止与医生结论原文）。 */
  const cycles = p.tx?.cycles ?? []
  if (cycles.length) {
    out.push(section('治疗阶段（按天记录，此处只列阶段）', table(['阶段', '起', '止', '说明原文'],
      cycles.map((c) => [c.kind, c.start, c.end, c.result]))))
  }

  /* 血象：每项取最近一次与谷值（只给数值与日期，不给分级）。 */
  const numeric = p.metrics?.numeric ?? {}
  const metricRows = Object.entries(numeric).map(([code, list]) => {
    const last = list.at(-1)
    const min = list.reduce((a, b) => (Number(b.v) < Number(a.v) ? b : a), list[0])
    return [code, `${last.v}（${last.d}）`, `${min.v}（${min.d}）`, String(list.length)]
  })
  if (metricRows.length) {
    out.push(section('血象与体重（数值照抄，分级与解读归医生）', table(['指标', '最近', '谷值', '记录条数'], metricRows)))
  }
  const ferritin = p.ferritin ?? []
  if (ferritin.length) {
    out.push(section('血清铁蛋白', table(['日期', '数值', '语境'], ferritin.map((f) => [f.d, `${f.v} μg/L`, f.note ?? '—']))))
  }

  /* K3：MRD 双口径分列，两条警示常驻。 */
  const flow = p.mrd?.flow ?? []
  const pcr = p.mrd?.pcr ?? []
  if (flow.length || pcr.length) {
    out.push(section('MRD（双口径分列，跨方法不连线不换算）', [
      flow.length ? `- 流式（LAIP）：${flow.map((x) => `${x.d} ${x.label}`).join(' → ')}` : '- 流式（LAIP）：无记录',
      pcr.length ? `- PCR：${pcr.map((x) => `${x.d} ${x.label}`).join(' → ')}` : '- PCR：无记录（或本档案不适用）',
      '',
      `> ${p.mrd?.warn1 ?? 'MRD 转阴 ≠ 治愈。'}`,
      `> ${p.mrd?.warn2 ?? 'MRD 阳性 ≠ 一定复发。'}`,
    ].join(LINE)))
  }

  /* K2：粒缺发热只列体温与事件原文；**导出里也不写"是否急症"的判定**。 */
  const episodes = p.neu?.fever?.episodes ?? []
  if (episodes.length) {
    const blocks = episodes.map((ep) => {
      const temps = ep.temps ?? []
      const peak = temps.reduce((a, b) => (Number(b.v) > Number(a.v) ? b : a), temps[0] ?? null)
      return [
        `- ${ep.label}：${ep.from} → ${ep.to ?? '（未记录结束）'}`,
        `  - 体温记录 ${temps.length} 条${peak ? `，最高 ${mmHg(peak)}（${peak.ts}）` : ''}`,
        `  - 抗生素/血培养等事件 ${(ep.events ?? []).length} 条（原文见粒缺发热轨道）`,
        ep.outcome ? `  - 转归原文：${ep.outcome}` : '',
      ].filter(Boolean).join(LINE)
    })
    out.push(section('粒缺发热（体温到小时，事件原文）', blocks.join(LINE)))
    if (p.meta?.feverDef) out.push(`> 定义原文：${p.meta.feverDef}`)
  }

  /* K5：输注成分分列；只累计红细胞单位，不判依赖。 */
  const transfusions = p.neu?.transfusions ?? []
  if (transfusions.length) {
    const rbc = transfusions.filter((t) => t.comp === '红细胞')
    const rbcUnits = rbc.reduce((s, t) => s + (parseInt(t.units, 10) || 0), 0)
    const plt = transfusions.filter((t) => t.comp === '血小板').length
    out.push(section('输注（成分分列）', [
      table(['日期', '成分', '量', '输注前', '反应'], transfusions.map((t) => [t.d, t.comp, t.units, t.pre ?? '—', t.reaction ?? '—'])),
      '',
      `> 累计红细胞 ${rbcUnits}u（${rbc.length} 次）；血小板 ${plt} 次。是否"依赖"由医生判断，本台只汇总不判依赖。`,
    ].join(LINE)))
  }

  /* K4：移植段零推荐——只写状态、供者登记与医生答复原文。 */
  if (p.tp) {
    out.push(section('移植评估（只记录过程，零推荐）', [
      `- 状态：${p.tp.status ?? '—'}`,
      p.tp.donor ? `- 供者登记：${p.tp.donor.type ?? '—'}${p.tp.donor.rel ? ` · ${p.tp.donor.rel}` : ''}${p.tp.donor.hla ? ` · ${p.tp.donor.hla}` : ''}` : '- 供者登记：尚无',
      p.tp.doctorReply ? `- 医生答复原文：${p.tp.doctorReply}` : '',
      '',
      `> ${p.tp.zeroRec ?? '本台零推荐：做不做移植、何时做、选哪类供者，由医生与你们家庭共同决定。'}`,
    ].filter(Boolean).join(LINE)))
  }

  /* 问题清单：带去看的，不是结论。 */
  const questions = p.docs?.questions ?? []
  out.push(section('问题清单', questions.length
    ? questions.map((q) => `- ${q.asked ? '（已问过）' : ''}${q.text}${q.src ? `　— ${q.src}` : ''}`).join(LINE)
    : '（还没有问题：在「就诊准备」里记下想问的，带来门诊逐条问。）'))

  /* 感受：只带 shared，并带否定语境抬头（K6）。 */
  const shared = [
    ...(p.mind?.feels ?? []),
    ...((p.mind?.death?.items ?? []).filter((x) => x.visibility !== 'private')),
    ...(p.mind?.burden ?? []),
  ]
  const privCount = (p.mind?.death?.items ?? []).filter((x) => x.visibility === 'private').length
  out.push(section('本人与家属的感受（本人记录，不是医生结论）', shared.length
    ? table(['日期', '记录人', '原话'],
      shared.map((v) => [v.d, v.author === 'caregiver' ? '家属代记' : '本人', v.text]))
    : '（无可分享的感受记录）'))
  if (privCount > 0) {
    out.push(`> 另有 ${privCount} 条私密记录（对死亡的准备）按设置不进本摘要；需要时由本人逐条授权。`)
  }

  out.push(`${LINE}---${LINE}本摘要由小橙宝 OrangePal 在本机生成${generatedAt ? `（${generatedAt}）` : ''}；只整理不判定。`)
  return out.filter((x) => x !== '').join(LINE).replace(/\n{3,}/g, LINE + LINE) + LINE
}

/** 导出文件名：就诊准备-姓名-日期.md */
export function exportFilename(profile) {
  const d = new Date().toISOString().slice(0, 10)
  const name = String(profile?.name ?? '未命名').replace(/[/\\:*?"<>|]/g, '')
  return `就诊准备-${name}-${d}.md`
}
