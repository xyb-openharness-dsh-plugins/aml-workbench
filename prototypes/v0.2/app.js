'use strict';
/* 小橙宝 OrangePal v0.2.0 — 急性髓系白血病（AML）工作台交互原型。
   所有数据来自 demo-data.js（demo/build-demo-data.mjs 唯一源，合成演示数据）；不读写真实文件、不调用模型或宿主 API。
   页面树唯一权威：research-notes/family-landscape.md §6.2/§6.3（10 一级 / 27 二级）。
   红线（DEV-REQUIREMENTS K1–K6）：
   K1 诱导日历按天（D1–D42 日格网格），无"疗程粒度"聚合；day_index 读模型派生；允许"仅知月份"灰格；
   K2 粒缺发热独立轨道：体温 HH:mm 小时级 + 抗生素时点 + 血培养双套；定义原文（≥38.3℃+ANC<0.5）常驻；
      急症提示不可忽略关闭；不指导用药（不出现"吃点退烧药/观察看看"）；
   K3 MRD 双口径并列（流式 % / PCR），跨方法不连线不换算，不判复发；两条警示常驻不可关闭；未检测≠阴性；
   K4 移植零推荐：状态机 + 供者四类记录 + 医生答复原文；Day+N 相对天数轴（Day 0 回输锚点，未定灰格）；
   K5 输注独立轨道：成分分列，只做红细胞累计单位汇总，不判依赖；
   K6 双主体 author_role（家属代记为主）+ 私密（对死亡的准备）三出口（看板摘要/导出/AI 上下文共用 sharedOnly）。
   AI 协助：34 号一键发送契约（aml:agent-draft + send:true，嵌入式直接发送；回复是候选，核对才采纳）。
   三种时间粒度互不混轴（16 号合同补充断言）：月粒度=一图秀 / 天粒度=dayGrid / 小时粒度=hourLane。 */

const APP_INFO = {
  version: '0.2.0',
  build: '2026-10-25',
  channel: 'prototype',
  channelLabel: '交互原型 · 未接入 DSH / AI',
  brand: '小橙宝 OrangePal',
  en: 'aml'
};
APP_INFO.displayVersion = `v${APP_INFO.version}`;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uidSeq = 0;
const uid = (p) => p + (++uidSeq);
const DAY = 86400000;
const longDate = (d) => String(d).replace(/-/g, '.');
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const fmtNum = (v, dec) => (dec === 0 ? String(Math.round(v)) : Number(v).toFixed(dec ?? 1));
const hm = (ts) => String(ts).slice(11, 16);
const dOf = (ts) => String(ts).slice(0, 10);
const ROLE_LABEL = { patient: '患者本人', caregiver: '照护者' };

/* ---------------- icons & nav（family-landscape §6.2：10 一级） ---------------- */
const icons = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  dx: 'M12 4a5 5 0 0 1 5 5c0 2.5-1.7 3.4-1.7 5.5H8.7C8.7 12.4 7 11.5 7 9a5 5 0 0 1 5-5ZM9.5 20h5M12 8v4',
  tx: 'M4 20l6-6M10 14 20 4l-1 5-6 6-3-1ZM4 20h5',
  neu: 'M12 20.3c-4.6-2.9-7.4-5.6-7.4-9A4.1 4.1 0 0 1 12 8.4a4.1 4.1 0 0 1 7.4 2.9c0 3.4-2.8 6.1-7.4 9Z',
  mrd: 'M12 12h.01M12 3c4 3 6 6 6 9s-2 6-6 9c-4-3-6-6-6-9s2-6 6-9ZM5 8c5 0 9 2 12 4M19 8c-5 0-9 2-12 4M5 16c5 0 9-2 12-4M19 16c-5 0-9-2-12-4',
  tp: 'M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 3h2m4 0h2',
  chart: 'M4 20V5m0 15h16M8 16l3-5 3 3 4-7',
  care: 'M5 3h10l4 4v14H5ZM9 12h6M12 9v6',
  mind: 'M9 21v-3H7a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3 5 5 0 0 1 10 0 3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-2v3M9 13h.01M15 13h.01',
  docs: 'M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16M9 15l2 2 4-4'
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[k]}"/></svg>`;

/* 页面树（§6.2/§6.3：10 一级 / 27 二级） */
const PAGES = [
  ['dash', '看板', 'home'], ['dx', '诊断与基因', 'dx'], ['tx', '诱导与疗程', 'tx'],
  ['neu', '粒缺血象与支持', 'neu'], ['mrd', 'MRD 与随访', 'mrd'], ['tp', '移植', 'tp'],
  ['chart', '病情一图秀', 'chart'], ['care', '营养与生活', 'care'], ['mind', '心理与家庭', 'mind'],
  ['docs', '资料与复诊', 'docs']
];
const SUBPAGES = {
  dx: [['dx-wk', '确诊经过与四大检查'], ['dx-gene', '亚型、分层与基因解释卡'], ['dx-mdt', '会诊与二次意见']],
  tx: [['tx-cal', '诱导日历（按天）'], ['tx-path', '治疗路径（折叠卡）'], ['tx-cons', '巩固与维持'], ['tx-pend', '检查结果等待清单']],
  neu: [['neu-fever', '粒缺发热轨道'], ['neu-cbc', '血象趋势'], ['neu-tx', '输注记录与反应'], ['neu-oral', '黏膜炎与症状'], ['neu-inf', '感染档案与预防']],
  mrd: [['mrd-trend', 'MRD 双口径趋势'], ['mrd-bm', '骨穿与标本记录'], ['mrd-rhythm', '复查节奏与影像并列']],
  tp: [['tp-eval', '移植评估档案'], ['tp-donor', '供者与配型记录'], ['tp-day', 'Day+N 时间轴与 GVHD']],
  care: [['care-intake', '食量与体重'], ['care-safe', '食物安全与出入量']],
  mind: [['mind-feel', '当下感受（双主体）'], ['mind-death', '对死亡的准备（私密）'], ['mind-burden', '家庭负担与照护者']],
  docs: [['docs-lib', '资料库与导入'], ['docs-cand', '整理草稿与核对'], ['docs-prep', '就诊准备与导出'], ['docs-trial', '试验线索']]
};
const SUBTITLES = {
  dash: '把"现在到第几天、今天注意什么"放在最前面；粒缺期模式卡随 ANC 自动出现。',
  dx: '确诊经过允许"仅知月份"；基因逐项解释是解释不是判断；未检测 ≠ 阴性。',
  tx: '诱导日历按天（D1–D42）；治疗路径按疗程折叠；只记录不推荐、不评疗效。',
  neu: '粒缺发热是急症不是记录项：体温到小时、抗生素时点、血培养双套；输注成分分列不判依赖。',
  mrd: '流式 % 与 PCR 双口径分列，跨方法不连线；转阴≠治愈、阳性≠复发，两条警示常驻。',
  tp: '移植是状态机不是事件：评估、供者、Day+N；本台零推荐，供者怎么选由医生与家庭决定。',
  chart: '血象/体重/同方法 MRD 放回同一段时间；疗程、粒缺发作、输注是分类节点，只画节点不连线。',
  care: '食量、体重与出入量只记事实；食物安全是事实提醒非命令式，不给食谱。',
  mind: '双主体各自记录、并列不平均；"对死亡的准备"默认私密三出口；不承诺、不判读。',
  docs: '资料库、候选核对、两区导出（private 默认过滤）与试验线索（线索不是推荐）分开放。'
};

/* 13 场景直达（INTERACTION-DESIGN v1：S01–S13；HVT X1/X2 走查锚点） */
const SCENES = [
  ['S01', '开始 7+3', 'tx', 'tx-cal', [['to-dx-wk', 'dx', 'dx-wk'], ['to-tx-pend', 'tx', 'tx-pend'], ['to-neu-fever', 'neu', 'neu-fever']], '诱导日历（按天）'],
  ['S02', '粒缺发烧', 'neu', 'neu-fever', [['to-neu-inf', 'neu', 'neu-inf'], ['to-neu-cbc', 'neu', 'neu-cbc']], '急症轨道'],
  ['S03', 'MRD 转阴', 'mrd', 'mrd-trend', [['to-mrd-bm', 'mrd', 'mrd-bm'], ['to-chart', 'chart', '']], '双口径趋势'],
  ['S04', '移植供者', 'tp', 'tp-eval', [['to-tp-donor', 'tp', 'tp-donor'], ['to-tp-day', 'tp', 'tp-day']], '评估档案'],
  ['S05', '又输血', 'neu', 'neu-tx', [['to-neu-cbc', 'neu', 'neu-cbc'], ['to-neu-inf', 'neu', 'neu-inf']], '输注记录'],
  ['S06', '复诊准备', 'docs', 'docs-prep', [['to-docs-lib', 'docs', 'docs-lib']], '两区导出'],
  ['S07', '口腔溃疡', 'neu', 'neu-oral', [['to-care-safe', 'care', 'care-safe']], '黏膜炎记录'],
  ['S08', '家属代记', 'neu', 'neu-fever', [['to-mind-burden', 'mind', 'mind-burden']], '双源代记'],
  ['S09', '影像并列', 'mrd', 'mrd-rhythm', [['to-chart', 'chart', '']], '复查节奏'],
  ['S10', '营养体重', 'care', 'care-intake', [['to-care-safe', 'care', 'care-safe']], '食量与体重'],
  ['S11', '私密心理', 'mind', 'mind-death', [['to-mind-feel', 'mind', 'mind-feel'], ['to-docs-prep', 'docs', 'docs-prep']], '三出口'],
  ['S12', '试验线索', 'docs', 'docs-trial', [['to-docs-cand', 'docs', 'docs-cand']], '线索非推荐'],
  ['S13', '文档导入', 'docs', 'docs-lib', [['to-docs-cand', 'docs', 'docs-cand']], '候选核对']
];

/* ---------------- 指标目录（与一图秀同一来源；23 号：分组单一来源） ---------------- */
const CATALOG = {
  ANC: { name: 'ANC（中性粒细胞绝对值）', unit: '×10⁹/L', cat: '血象', color: '#1F6E6B', dec: 1, note: 'ANC<0.5 → 粒缺期模式（发热按急症处理）；谷值常在停化疗后 7–14 天。' },
  WBC: { name: 'WBC（白细胞）', unit: '×10⁹/L', cat: '血象', color: '#5B8FA3', dec: 1 },
  Hb: { name: 'Hb（血红蛋白）', unit: 'g/L', cat: '血象', color: '#B3372E', dec: 0, note: '输红细胞的直接语境指标；输注指征由医生决定。' },
  PLT: { name: 'PLT（血小板）', unit: '×10⁹/L', cat: '血象', color: '#9A6B12', dec: 0, note: '血小板输注语境指标；输注频次只汇总不判依赖。' },
  WEIGHT: { name: '体重', unit: 'kg', cat: '体格与 MRD', color: '#C46A2B', dec: 1 },
  MRDFC: { name: 'MRD 流式（LAIP %）', unit: '%', cat: '体格与 MRD', color: '#6B4F9E', dec: 2, mrd: true, note: '阴性点画在检出限 0.01%（空心）；同方法才连线；转阴≠治愈、阳性≠复发。' }
};
const CAT_ORDER = ['血象', '体格与 MRD'];

/* ---------------- AI 协助示例（34 号一键发送：预写提示词 + 已确认上下文 → 直接发送；候选核对闭环） ---------------- */
const AI_DEMOS = {
  dash: { prompt: '帮我把当前疗程天数、最近血象和下次复诊排成一段话，复诊时照着说。', cand: { title: '复诊开场摘要（演示候选）', fields: [['当前', '巩固 2 结束后第 43 天（张强 · 演示）'], ['最近 ANC', '2.8×10⁹/L（2026-10-16）'], ['下次复诊', '2026-11-06（以预约为准）']], src: '看板摘要（演示）' } },
  dx: { prompt: '帮我把 NPM1、FLT3-ITD、未检测这三项各解释成一句大白话，只解释名词不做判断。', cand: { title: '基因解释候选（演示）', fields: [['NPM1', '常见突变；单独出现时国际通常归入"预后较好"组（解释不是判断）'], ['FLT3-ITD', '本档案野生型：这项检测没查到突变'], ['未检测项', '未检测 ≠ 阴性：没查不等于没有突变']], src: '基因解释卡（演示）' } },
  tx: { prompt: '帮我把"7+3 为什么第 8 天反而最危险"整理成一张给家属看的说明卡。', cand: { title: '谷值期说明候选（演示）', fields: [['输注期', 'D1–7 化疗打勾（诱导日历按天）'], ['谷值期', '停化疗后 7–14 天，白细胞/粒细胞最低'], ['口径', '只解释结构，不评疗效、不荐方案']], src: '诱导日历（演示）' } },
  neu: { prompt: '今天早上量了体温，帮我把体温和当时在用的药记进发热轨道。', cand: { title: '体温记录候选（演示）', fields: [['时间', '待核对（HH:mm）'], ['体温', '照抄数值；≥38.3℃ 或 ≥38.0℃ 持续>1h → 按急症提示按铃'], ['口径', '只记录不指导用药']], src: '粒缺发热轨道（演示）' } },
  mrd: { prompt: '流式 MRD 从 0.08% 到阴性，帮我把两次结果和检测方法排在一起，不要下结论。', cand: { title: 'MRD 抄单候选（演示）', fields: [['流式（LAIP）', '0.08% → 阴性（<0.01%）'], ['口径', '同方法才连线；不同方法/阈值不可换算'], ['警示', '转阴≠治愈；阳性≠复发（常驻）']], src: 'MRD 双口径（演示）' } },
  tp: { prompt: '帮我把移植评估的医生答复原文整理成一页，只留原文不添建议。', cand: { title: '移植答复整理候选（演示）', fields: [['状态', '评估中（状态机）'], ['供者', '同胞全合候选 · HLA 送检中'], ['口径', '本台零推荐；原文抄录']], src: '移植评估档案（演示）' } },
  chart: { prompt: '把 ANC 和体重这半年的变化讲一段给我听，按时间顺序。', cand: { title: '时段摘要候选（演示候选）', fields: [['时段', '2026-05 → 2026-10'], ['ANC', '谷值 0.1（05-24）→ 2.8（10-16）'], ['口径', '每条线按自身范围缩放，不可比']], src: '病情一图秀（演示）' } },
  care: { prompt: '今天吃了半碗粥和蒸蛋，帮我记进食量日记。', cand: { title: '食量候选（演示）', fields: [['日期', '2026-10-25'], ['内容', '照抄记录，不评营养'], ['口径', '事实提醒非命令式，不给食谱']], src: '食量与体重（演示）' } },
  mind: { prompt: '帮我记一条我自己的感受（默认私密，不进导出）。', cand: { title: '感受候选（演示 · 默认私密）', fields: [['内容', '照抄记录'], ['记录人', '本人/照护者（双主体并列不平均）'], ['可见性', 'private（默认不进导出/AI）']], src: '当下感受（演示）' } },
  docs: { prompt: '帮我把复诊要问的几条整理成疑问清单，标好哪些已经问过。', cand: { title: '疑问清单候选（演示）', fields: [['问题 1', '巩固 2 之后还要做几程？'], ['问题 2', '妹妹的配型结果什么时候出？'], ['来源', '就诊准备生成']], src: '就诊准备（演示）' } }
};

/* ---------------- state ---------------- */
const state = {
  page: 'dash', sub: {}, profileId: 'demo1',
  range: 'all', sel: { demo1: ['ANC', 'PLT', 'WEIGHT', 'MRDFC'], demo2: ['ANC', 'PLT', 'WEIGHT'] },
  toggles: { treatment: true, keypoints: true },
  pin: null,
  agent: { open: false, draft: null, cand: null, prompt: '' },
  mem: {
    demo1: { temps: [], txf: [], oral: [], meals: [], io: [], feels: [], deaths: [], burdens: [], questions: null, docs: [], additions: {} },
    demo2: { temps: [], txf: [], oral: [], meals: [], io: [], feels: [], deaths: [], burdens: [], questions: null, docs: [], additions: {} }
  }
};
const DATA = typeof DEMO_DATA !== 'undefined' ? DEMO_DATA : { meta: {}, profiles: [] };
const TODAY = DATA.meta?.today || '2026-10-25';
const profile = () => DATA.profiles.find((p) => p.id === state.profileId) || DATA.profiles[0];
const mem = () => state.mem[state.profileId];
const added = (k) => { const m = mem(); if (!m.additions[k]) m.additions[k] = []; return m.additions[k]; };
const questions = () => { const m = mem(); if (!m.questions) m.questions = (profile().docs.questions || []).map((q) => ({ ...q })); return m.questions; };
const feelsAll = () => [...(profile().mind.feels || []), ...mem().feels];
const deathsAll = () => { const m = mem(); if (!m.deaths.length) return [...profile().mind.death.items]; return [...profile().mind.death.items, ...m.deaths]; };
/* private 三出口过滤（看板摘要 / 导出 / AI 上下文 默认）共用此函数——全台唯一一份（K6） */
const sharedOnly = (list) => (list || []).filter((v) => v.visibility !== 'private');
const privateCount = (list) => (list || []).filter((v) => v.visibility === 'private').length;
const allViewpoints = () => [...feelsAll(), ...deathsAll(), ...(profile().mind.burden || []), ...mem().burdens];
const aiCtx = () => {
  const p = profile();
  const shared = sharedOnly(allViewpoints());
  return `${p.name}·${p.diagnosisShort}·${p.stageLine}·最近 ANC ${p.dash.lastANC.v}（${p.dash.lastANC.d}）·私密记录 ${privateCount(allViewpoints())} 条默认不带（共享记录 ${shared.length} 条）`;
};
const aiPromptWithCtx = (key) => `${AI_DEMOS[key]?.prompt || '帮我整理这一页的信息。'}\n（已确认的病情上下文：${aiCtx()}）`;

/* ---------------- 通用 UI ---------------- */
const btn = (text, action, cls = '', attr = '') => `<button class="${cls}" data-action="${action}" ${attr}>${text}</button>`;
const go = (text, page, sub = '', cls = '', attr = '') => btn(text, 'go', cls, `data-page="${page}" data-sub="${esc(sub)}"${attr ? ' ' + attr : ''}`);
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;
const aiBtn = (key, label = 'AI 协助') => `<a class="chip ai-link" href="aml:agent-draft?prompt=${encodeURIComponent(aiPromptWithCtx(key))}" data-ai="${key}" title="把预写提示词与当前病情上下文发送给 AI，开启互动（回复是候选，核对后采纳）">${esc(label)} ↗</a>`;
function toast(t, opts = {}) {
  clearTimeout(state.toastTimer);
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  state.toastTimer = setTimeout(() => { el.classList.remove('show'); if (opts.back) history.back(); }, opts.long ? 6000 : 2600);
}
function openModal(title, body, foot = '', eyebrowLabel = '小橙宝 · 交互演示') {
  $('#dialog-title').textContent = title; $('#dialog-eyebrow').textContent = eyebrowLabel;
  $('#dialog-body').innerHTML = body; $('#dialog-foot').innerHTML = foot || '<button data-action="close">关闭</button>';
  const dlg = $('#dialog'); if (!dlg.open) dlg.showModal();
}
function closeModal() { const dlg = $('#dialog'); if (dlg.open) dlg.close(); }
const head = (title, desc, action = '', productId = '') => `<div class="head" ${productId ? `data-product="${esc(productId)}"` : ''}><h1>${esc(title)}</h1><p>${desc}</p>${action ? `<div class="actions" style="margin-top:9px">${action}</div>` : ''}</div>`;
const section = (title, sub = '', extra = '') => `<div class="section-title"><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</div>`;
const pageId = () => (SUBPAGES[state.page] ? `${state.page}/${state.sub[state.page] || SUBPAGES[state.page][0][0]}` : state.page);
const roleTag = (a) => `<span class="author-tag ${a === 'patient' ? 'patient' : 'caregiver'}">${ROLE_LABEL[a] || esc(a)}</span>`;

/* ---------------- 读模型：day_index / Day+N 派生（K1/K4） ---------------- */
const dayIndexOf = (cal, d) => daysBetween(cal.anchor, d) + 1;           // day_index = floor((d−start)/DAY)+1
const dayNOf = (day0, d) => day0 ? daysBetween(day0, d) : null;          // Day+N（回输锚点），未定返回 null
const monthOnly = (d) => /^\d{4}-\d{2}$/.test(String(d));

/* ---------------- 一图秀（16 号合同；月粒度） ---------------- */
const CW = 980, CH = 432, CX0 = 56, CX1 = 950, CY0 = 148, CY1 = 372;
const LANES = { cycle: 36, feverb: 56, tx: 66 };
function seriesAll(code) {
  const p = profile(); const m = CATALOG[code]; if (!m) return [];
  let arr = (p.metrics.numeric || {})[code] || [];
  if (m.mrd) arr = (p.mrd?.flow || []).map((x) => ({ d: x.d, v: x.v, neg: !!x.neg, label: x.label, src: x.src }));
  return arr;
}
function profileStart(p) {
  const dates = [Date.parse(DATA.meta.dataStart || '2026-04-01')];
  Object.values(p.metrics.numeric || {}).forEach((a) => a.forEach((x) => dates.push(Date.parse(x.d))));
  return Math.min(...dates);
}
function profileEnd(p) {
  const dates = [Date.parse(TODAY)];
  Object.values(p.metrics.numeric || {}).forEach((a) => a.forEach((x) => dates.push(Date.parse(x.d))));
  return Math.max(...dates);
}
/* AML 治疗与发作条：疗程=菱形节点；粒缺发作=期带；输注=小节点（成分聚合到日）。移植节点未发生不画。 */
function treatmentBands(p) {
  const out = [];
  (p.tx.cycles || []).forEach((c) => out.push({ kind: 'cycle', label: `疗程${c.n}`, date: c.start, color: '#C46A2B' }));
  (p.neu.fever.episodes || []).forEach((e) => out.push({ kind: 'feverb', label: '粒缺发热', from: dOf(e.from), to: dOf(e.to), color: '#B3372E' }));
  const byDate = new Map();
  (p.neu.transfusions || []).forEach((t) => { const k = t.d + '|' + t.comp; const x = byDate.get(k) || { d: t.d, comp: t.comp, n: 0 }; x.n += 1; byDate.set(k, x); });
  byDate.forEach((x) => out.push({ kind: 'tx', label: `${x.comp}×${x.n}`, date: x.d, color: x.comp === '红细胞' ? '#B3372E' : '#9A6B12' }));
  return out;
}
function domain() {
  const p = profile(); const end = profileEnd(p);
  const months = { '3m': 3, '6m': 6 }[state.range];
  const start = months ? new Date(new Date(end).setMonth(new Date(end).getMonth() - months)) : new Date(profileStart(p));
  return [start.getTime(), end];
}
const inDomain = (d, t0, t1) => { const t = Date.parse(d); return t >= t0 && t <= t1; };
const xOf = (t, t0, t1) => CX0 + (t - t0) / Math.max(1, t1 - t0) * (CX1 - CX0);
function smoothPath(coords) { /* 单调三次 Hermite（Fritsch–Carlson）：过点、防过冲、采样间隔不均匀安全（家族契约：从 thyroid v0.2 复制） */
  if (!coords.length) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  const n = coords.length, dx = [], sl = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = coords[i + 1].x - coords[i].x;
    sl[i] = dx[i] === 0 ? 0 : (coords[i + 1].y - coords[i].y) / dx[i];
  }
  m[0] = sl[0]; m[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (sl[i - 1] * sl[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
    m[i] = (w1 + w2) / (w1 / sl[i - 1] + w2 / sl[i]);
  }
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sl[i], b = m[i + 1] / sl[i], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * sl[i]; m[i + 1] = t * b * sl[i]; }
  }
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${(coords[i].x + h).toFixed(1)} ${(coords[i].y + m[i] * h).toFixed(1)}, ${(coords[i + 1].x - h).toFixed(1)} ${(coords[i + 1].y - m[i + 1] * h).toFixed(1)}, ${coords[i + 1].x.toFixed(1)} ${coords[i + 1].y.toFixed(1)}`;
  }
  return d;
}
function seriesFor(code, t0, t1) {
  const m = CATALOG[code]; const all = seriesAll(code);
  if (!all.length) return { code, m, lo: 0, hi: 1, span: 1, pts: [], all };
  const vals = all.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.08, 1);
  return { code, m, lo, hi, span, pts: all.filter((p) => inDomain(p.d, t0, t1)), all };
}
function monthTicks(t0, t1) {
  const out = []; const d = new Date(t0); let cur = new Date(d.getFullYear(), d.getMonth(), 1);
  if (cur.getTime() < t0) cur.setMonth(cur.getMonth() + 1);
  while (cur.getTime() <= t1) {
    const x = xOf(cur.getTime(), t0, t1);
    if (x > CX0 + 6 && x < CX1 - 6) out.push({ x, label: `${String(cur.getFullYear()).slice(2)}-${String(cur.getMonth() + 1).padStart(2, '0')}` });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  const step = out.length > 18 ? 4 : out.length > 8 ? 2 : 1;
  return step === 1 ? out : out.filter((_, i) => i % step === 0);
}
function chartSVG(t0, t1) {
  const sel = state.sel[state.profileId];
  const series = sel.map((c) => seriesFor(c, t0, t1)).filter((s) => s.pts.length);
  if (!series.length) return `<div class="empty"><h3>这个时间窗里没有所选指标</h3><p>扩大时间范围，或在左侧加选一个指标。</p></div>`;
  const p = profile();
  const bands = state.toggles.treatment ? treatmentBands(p).filter((b) => {
    const s = b.date ? Date.parse(b.date) : Date.parse(b.from);
    const e = b.date ? s : Date.parse(b.to);
    return e >= t0 && s <= t1;
  }) : [];
  const yOf = (s, v) => CY1 - (v - s.lo) / s.span * (CY1 - CY0);
  const grid = [0, 1, 2, 3, 4].map((i) => { const y = CY0 + i * (CY1 - CY0) / 4; return `<line class="grid" x1="${CX0}" x2="${CX1}" y1="${y}" y2="${y}"/>`; }).join('');
  const strip = [];
  bands.forEach((b) => {
    if (b.kind === 'cycle') {
      const x = xOf(Date.parse(b.date), t0, t1).toFixed(1);
      strip.push(`<g><path d="M ${x} ${LANES.cycle + 4.5} l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z" fill="${b.color}"/><text x="${(+x + 7).toFixed(1)}" y="${LANES.cycle + 13}" font-size="8.5" fill="${b.color}" font-weight="500">${esc(b.label)}</text></g>`);
    } else if (b.kind === 'feverb') {
      const x1 = Math.max(xOf(Date.parse(b.from), t0, t1), CX0), x2 = Math.min(xOf(Date.parse(b.to), t0, t1), CX1);
      strip.push(`<g><rect x="${x1.toFixed(1)}" y="${LANES.feverb}" width="${Math.max(x2 - x1, 7).toFixed(1)}" height="8" rx="4" fill="${b.color}" opacity=".24"/><text x="${(x1 + 1).toFixed(1)}" y="${(LANES.feverb - 4).toFixed(1)}" font-size="8.5" fill="${b.color}" font-weight="500">${esc(b.label)}</text></g>`);
    } else if (b.kind === 'tx') {
      const x = xOf(Date.parse(b.date), t0, t1).toFixed(1);
      strip.push(`<g><circle cx="${x}" cy="${LANES.tx + 4.5}" r="3.2" fill="${b.color}"/><text x="${(+x + 6).toFixed(1)}" y="${LANES.tx + 13}" font-size="8" fill="${b.color}">${esc(b.label)}</text></g>`);
    }
  });
  const rowLabels = `<text x="6" y="${LANES.cycle + 7}" font-size="8.5" fill="#9a8f7e">疗程</text><text x="6" y="${LANES.feverb + 7}" font-size="8.5" fill="#9a8f7e">发作/输注</text>`;
  /* 末点标签三向避让 */
  const lastPos = series.map((s) => {
    const c = s.pts.map((p) => ({ x: xOf(Date.parse(p.d), t0, t1), y: yOf(s, p.v) }));
    const last = c[c.length - 1];
    return { s, x: last.x, y: last.y, v: s.pts[s.pts.length - 1].v };
  }).sort((a, b) => a.y - b.y);
  let cursor = -Infinity;
  for (const it of lastPos) { it.ly = Math.max(it.y, cursor + 13); cursor = it.ly; }
  const overflow = lastPos.length ? Math.max(0, lastPos[lastPos.length - 1].ly - (CY1 + 2)) : 0;
  if (overflow) for (const it of lastPos) it.ly -= overflow;
  const lines = series.map((s, si) => {
    const coords = s.pts.map((p) => ({ x: xOf(Date.parse(p.d), t0, t1), y: yOf(s, p.v) }));
    const canLine = s.pts.length > 1;
    const path = canLine ? `<path class="line" d="${smoothPath(coords)}" stroke="${s.m.color}" pathLength="1"/>` : '';
    const dots = coords.map((c, i) => {
      const pt = s.pts[i];
      const isLast = i === s.pts.length - 1;
      const r = isLast ? 5.2 : 4;
      const active = state.pin && state.pin.code === s.code && state.pin.date === pt.d;
      const fill = pt.neg ? '#fff' : s.m.color;
      const tip = pt.neg ? `${s.m.name}：${pt.label} · ${pt.d} · ${pt.src}` : `${s.m.name} ${fmtNum(pt.v, s.m.dec)} ${s.m.unit} · ${pt.d}`;
      return `<circle class="pt${active ? ' active' : ''}${pt.neg ? ' neg' : ''}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${r}" ${pt.neg ? `stroke="${s.m.color}"` : `fill="${s.m.color}"`} data-action="pin" data-code="${s.code}" data-date="${pt.d}"><title>${esc(tip)}</title></circle>`;
    }).join('');
    const lp = lastPos.find((x) => x.s === s);
    const nearRight = lp.x > CX1 - 46;
    const lx = nearRight ? lp.x - 8 : lp.x + 8;
    const lastPt = s.pts[s.pts.length - 1];
    const ltxt = lastPt.neg ? (lastPt.label || '阴性') : fmtNum(lp.v, s.m.dec);
    const label = state.toggles.keypoints ? `<text class="delta-tag" x="${lx.toFixed(1)}" y="${(lp.ly + 4 + (si % 2 ? -11 : 0)).toFixed(1)}" text-anchor="${nearRight ? 'end' : 'start'}" fill="${s.m.color}">${esc(ltxt)}</text>` : '';
    return `<g>${path}${dots}${label}</g>`;
  }).join('');
  const ticks = monthTicks(t0, t1).map((t) => `<line class="axis" x1="${t.x.toFixed(1)}" x2="${t.x.toFixed(1)}" y1="${CY1}" y2="${CY1 + 5}"/><text class="tick" x="${t.x.toFixed(1)}" y="${CY1 + 18}" text-anchor="middle">${t.label}</text>`).join('');
  const singleNotes = series.filter((s) => s.pts.length === 1).map((s) => `${esc(s.m.name)} 只有 1 点，不连线`).join('；');
  return `<svg class="chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="一图秀：所选指标时间轴（月粒度）">
    ${grid}${strip.join('')}${rowLabels}${lines}${ticks}
    <text x="${CX1}" y="${CH - 8}" text-anchor="end" font-size="9.5" fill="#9a8f7e">每条线按该指标全部记录范围缩放，不代表不同指标数值可比。</text>
    ${singleNotes ? `<text x="${CX0}" y="${CH - 8}" font-size="9.5" fill="#9a8f7e">${singleNotes}</text>` : ''}
    <text x="${CX0}" y="${CH - 22}" font-size="9.5" fill="#9a8f7e">小时级体温只以"粒缺发作"期带出现在此，曲线留在粒缺发热轨道（月粒度轴不装小时，不跨尺度共轴）。</text>
  </svg>`;
}

/* ---------------- 三新组件 1：dayGrid 诱导日历按天（K1） ---------------- */
function dayGridSVGless(cal) {
  const lead = (new Date(cal.anchor).getDay() + 6) % 7; // 周一锚定 D1
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="dg-cell grey" aria-hidden="true"></div>');
  let greyCount = 0;
  (cal.daily || []).forEach((row) => {
    const hasContent = (row.marks?.length || row.transfusion || row.fever || row.notes?.length);
    if (!hasContent) greyCount += 1;
    const marks = (row.marks || []).map((mk) => `<span class="dg-mark${mk === 'VEN' ? ' ven' : ''}">${esc(mk)}</span>`).join('');
    const fever = row.fever ? `<span class="dg-fever">烧 ${row.fever.hi.toFixed(1)}℃</span>` : '';
    const tx = row.transfusion ? `<span class="dg-tx">· 输注×${row.transfusion}</span>` : '';
    const note = (row.notes || []).length ? `<span class="dg-note">${esc(row.notes[0])}</span>` : '';
    const todayCls = row.d === TODAY ? ' today' : '';
    const band = (cal.bands || []).find((b) => row.day >= b.from && row.day <= b.to);
    const bandCls = band ? ` band-${band.kind}` : '';
    const greyCls = hasContent ? '' : ' grey';
    cells.push(`<div class="dg-cell${bandCls}${greyCls}${todayCls}" title="${esc(row.d)} · D${row.day}">
      <span class="dg-day">${esc(String(row.d).slice(5))}</span><span class="dg-dn">D${row.day}</span>
      <div class="dg-marks">${marks}</div>${fever}${tx}${note}</div>`);
  });
  return `<div class="dg-grid" role="grid" aria-label="${esc(cal.label)}">${cells.join('')}</div><p class="small-note" style="margin-top:8px">无记录的日子显示灰格（含"仅知月份"精度：只记得月份时由读模型灰格占位，不造数）。</p>`;
}
function pageTxCal() {
  const p = profile(); const cal = p.tx.calendar;
  const lead = (new Date(cal.anchor).getDay() + 6) % 7;
  return `${head('诱导日历（按天）', '7+3 到底怎么打的、为什么第 8 天反而最危险——D1–D42 每天一格：化疗打勾、谷值期带、骨穿窗口、当日体温/输注摘要。按天是本页粒度，不做"疗程"聚合（K1）。', aiBtn('tx'), '诱导日历（按天）')}
  <div class="card">
    <div class="dg-head"><div><span class="eyebrow">读模型 · anchor=${esc(cal.anchor)} · day_index 由 floor((d−anchor)/DAY)+1 派生</span><h2 style="font-size:16px">${esc(cal.label)}</h2></div>${pill('按天粒度', 'org')}</div>
    ${dayGridSVGless(cal)}
    <div class="dg-legend">
      <span><i style="background:var(--act-soft)"></i>化疗药打勾</span><span><i style="background:var(--amber-soft)"></i>骨髓抑制谷值窗口（停化疗后 7–14 天）</span>
      <span><i style="background:var(--act-soft);border:1px solid var(--act)"></i>骨穿复核窗口</span><span><i style="background:var(--red-soft)"></i>当日有发热</span><span><i style="background:var(--grey-soft)"></i>灰格=无记录/仅知月份</span>
    </div>
    <p class="small-note" style="margin-top:6px">${esc(cal.legend || '')}</p>
  </div>
  <div class="grid grid-2" style="margin-top:12px">
    <div class="card"><h3 style="font-size:15px">本页回答</h3><p style="font-size:13.5px;margin-top:6px">"7+3 到底是怎么打的？为什么第 8 天反而最危险？"——输注期 D1–7、谷值期 D8–14、骨穿窗口在格上看，不用纸笔推算。</p></div>
    <div class="card"><h3 style="font-size:15px">口径</h3><p style="font-size:13.5px;margin-top:6px">计划 vs 实际与延迟原因留痕在「治疗路径」页；本台不评疗效、不评依从。第二疗程并排属一期规划，本页先落第一疗程（K1 验收页）。</p></div>
  </div>
  <div class="actions" style="margin-top:12px">${go('看治疗路径（32 折叠卡）→', 'tx', 'tx-path', 'soft', 'data-step="to-tx-path"')}${go('看粒缺发热轨道 →', 'neu', 'neu-fever', 'soft', 'data-step="to-neu-fever2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 三新组件 2：hourLane 粒缺发热轨道（K2，小时级） ---------------- */
const HLW = 920, HLH = 320, HLX0 = 46, HLX1 = 900, HLY0 = 26, HLY1 = 244;
function hourLaneSVG(ep) {
  const t0 = Date.parse(ep.from) - 2 * 3600000, t1 = Date.parse(ep.to) + 3 * 3600000;
  const xOfT = (t) => HLX0 + (t - t0) / Math.max(1, t1 - t0) * (HLX1 - HLX0);
  const yOfV = (v) => HLY1 - (v - 36.4) / (39.6 - 36.4) * (HLY1 - HLY0);
  const grid = [37, 38, 39].map((v) => `<line class="grid" x1="${HLX0}" x2="${HLX1}" y1="${yOfV(v)}" y2="${yOfV(v)}"/><text class="tick" x="${HLX0 - 6}" y="${yOfV(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`).join('');
  const refs = [
    { v: 38.3, c: '#B3372E', lab: '≥38.3℃ 单次（定义口径）' },
    { v: 38.0, c: '#9A6B12', lab: '≥38.0℃ 持续>1h（定义口径）' }
  ].map((r) => `<line class="refline" x1="${HLX0}" x2="${HLX1}" y1="${yOfV(r.v)}" y2="${yOfV(r.v)}" stroke="${r.c}"/><text class="reflab" x="${HLX1 - 4}" y="${yOfV(r.v) - 5}" text-anchor="end" fill="${r.c}">${r.lab}</text>`).join('');
  /* 小时刻度：每天 00:00 主刻度 + 06/12/18 次刻度 */
  const ticks = [];
  for (let t = t0; t <= t1; t += 3600000) {
    const dt = new Date(t); const hh = dt.getHours();
    if (![0, 6, 12, 18].includes(hh)) continue;
    const x = xOfT(t).toFixed(1);
    if (+x < HLX0 + 4 || +x > HLX1 - 4) continue;
    const major = hh === 0;
    ticks.push(`<line class="axis" x1="${x}" x2="${x}" y1="${HLY1}" y2="${HLY1 + (major ? 6 : 3)}"/><text class="tick" x="${x}" y="${HLY1 + 17}" text-anchor="middle" ${major ? 'font-weight="600"' : ''}>${major ? `${String(dt.getFullYear()).slice(2)}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}` : `${String(hh).padStart(2, '0')}时`}</text>`);
  }
  const coords = ep.temps.map((x) => ({ x: xOfT(Date.parse(x.ts)), y: yOfV(x.v) }));
  const line = coords.length > 1 ? `<path d="${smoothPath(coords)}" fill="none" stroke="#1F6E6B" stroke-width="2.2" stroke-linecap="round"/>` : '';
  const dots = ep.temps.map((x, i) => {
    const c = coords[i];
    const hot = x.v >= 38.3, warm = x.v >= 38.0 && !hot;
    const fill = hot ? '#B3372E' : warm ? '#9A6B12' : '#1F6E6B';
    return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${hot ? 5 : 3.6}" fill="${fill}"><title>${esc(`${x.ts.replace('T', ' ')} · ${x.v.toFixed(1)}℃ · ${ROLE_LABEL[x.author] || x.author}`)}</title></circle>`;
  }).join('');
  /* 事件节点：分类只画节点（抗生素=十字 / 血培养=菱形 / 按铃=旗 / 升降阶梯=三角） */
  const evY = HLY1 + 34;
  const shapes = {
    call: (x) => `<path d="M ${x} ${evY - 7} v14 M ${x} ${evY - 7} h8 l-3 3 3 3 h-8" fill="none" stroke="#7A6F60" stroke-width="1.6"/>`,
    culture: (x) => `<path d="M ${x} ${evY - 6} l5 6 -5 6 -5 -6 Z" fill="#1F6E6B"/>`,
    antibiotic: (x) => `<path d="M ${x - 6} ${evY} h12 M ${x} ${evY - 6} v12" stroke="#C46A2B" stroke-width="3" stroke-linecap="round"/>`,
    escalate: (x) => `<path d="M ${x} ${evY - 7} l6 12 h-12 Z" fill="#B3372E"/>`,
    deescalate: (x) => `<path d="M ${x} ${evY + 5} l6 -12 h-12 Z" fill="#3E7A44"/>`
  };
  const laneLine = `<line x1="${HLX0}" x2="${HLX1}" y1="${evY}" y2="${evY}" stroke="var(--line)" stroke-width="1.5"/>`;
  const laneLab = `<text class="tick" x="${HLX0 - 6}" y="${evY + 4}" text-anchor="end">事件</text>`;
  const evs = ep.events.map((ev) => {
    const x = xOfT(Date.parse(ev.ts)).toFixed(1);
    const labWanted = ['antibiotic', 'culture'].includes(ev.kind);
    return `<g>${shapes[ev.kind](+x)}${labWanted ? `<text class="evlab" x="${x}" y="${evY + 24}" text-anchor="middle" fill="#3A3229" font-weight="600">${esc(hm(ev.ts))}</text>` : ''}<title>${esc(`${ev.ts.replace('T', ' ')} · ${ev.text}${ev.note ? '（' + ev.note + '）' : ''}`)}</title></g>`;
  }).join('');
  const authors = ep.temps.reduce((m, x) => { m[x.author] = (m[x.author] || 0) + 1; return m; }, {});
  const dual = Object.keys(authors).length > 1;
  return `<div class="hl-svg-wrap">
  <svg class="hourlane" viewBox="0 0 ${HLW} ${HLH + 40}" role="img" aria-label="粒缺发热轨道：小时级体温曲线与抗生素时点（${esc(ep.label)}）">
    ${grid}${refs}${ticks.join('')}${line}${dots}${laneLine}${laneLab}${evs}
  </svg></div>
  <div class="hl-anc"><b>${esc(ep.anc.note || 'ANC 联动')}：</b><span class="pill ${ep.anc.v < 0.5 ? 'red' : 'green'}">ANC ${ep.anc.v}×10⁹/L（${esc(ep.anc.d)}）</span>
  <span class="pill ${dual ? 'blue' : 'grey'}">双源体温：${Object.entries(authors).map(([k, n]) => `${ROLE_LABEL[k]}×${n}`).join(' · ')}</span></div>`;
}
function pageNeuFever() {
  const p = profile();
  const eps = (p.neu.fever.episodes || []).map((ep) => {
    const evt = (ep.events || []).map((ev) => `<div class="hl-ev"><span class="t">${esc(ev.ts.replace('T', ' '))}</span><span class="k ${esc(ev.kind)}">${esc({ call: '按铃', culture: '血培养', antibiotic: '抗生素', escalate: '升阶梯', deescalate: '降阶梯' }[ev.kind] || ev.kind)}</span><span>${esc(ev.text)}${ev.note ? ` <span class="small-note">${esc(ev.note)}</span>` : ''}</span></div>`).join('');
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3 style="font-size:15.5px">${esc(ep.label)}</h3><p>${esc(ep.from.replace('T', ' '))} → ${esc(ep.to.replace('T', ' '))}</p></div>${pill('小时级粒度', 'red')}</div>
      ${hourLaneSVG(ep)}
      <div class="hl-events" style="margin-top:10px">${evt}</div>
      <p class="small-note" style="margin-top:8px">${esc(ep.outcome || '')}</p>
    </div>`;
  }).join('');
  return `${head('粒缺发热轨道', '半夜烧到 38.5 该怎么办——这条轨道给出的是记录与流程事实：体温到小时、抗生素时点、血培养双套。它是急症不是记录项（K2）。', aiBtn('neu'), '粒缺发热轨道')}
  <div class="hl-def"><b>粒缺发热定义（指南原文口径，常驻）：</b>${esc(DATA.meta.feverDef)}</div>
  <div class="notice warn" style="margin-bottom:14px"><b>急症提示（不可忽略关闭）：</b>${esc(DATA.meta.feverAlert)} <b>粒缺发热请按急症就医处理。</b></div>
  ${eps}
  <div class="notice plain" style="margin-bottom:12px">${esc(p.neu.fever.guardNote || '本轨道只记录与呈现，不指导用药。')}</div>
  <div class="actions">${btn('＋ 连录一次体温（双源：本人/照护者）', 'temp-add', 'primary', 'data-step="temp-add"')}<span class="small-note">照护者代记为主；每条体温自动标注记录人（author_role，K6）。</span></div>
  <div class="actions" style="margin-top:12px">${go('看感染档案 →', 'neu', 'neu-inf', 'soft', 'data-step="to-neu-inf"')}${go('看血象趋势 →', 'neu', 'neu-cbc', 'soft', 'data-step="to-neu-cbc"')}${go('照护者记录位 →', 'mind', 'mind-burden', 'soft', 'data-step="to-mind-burden2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 三新组件 3：Day+N 相对天数轴（K4） ---------------- */
function dayAxisSVG(ax) {
  const stops = [-7, 0, 14, 100];
  const xs = [90, 300, 510, 800];
  const xOfN = (n) => {
    for (let i = 0; i < stops.length - 1; i++) {
      if (n >= stops[i] && n <= stops[i + 1]) {
        const f = (n - stops[i]) / (stops[i + 1] - stops[i]);
        return xs[i] + f * (xs[i + 1] - xs[i]);
      }
    }
    return n < stops[0] ? xs[0] : xs[xs.length - 1];
  };
  const y = 74;
  const axis = `<line class="axis" x1="${xs[0] - 30}" x2="${xs[xs.length - 1] + 30}" y1="${y}" y2="${y}"/>`;
  const ticks = stops.map((n, i) => `<line x1="${xs[i]}" x2="${xs[i]}" y1="${y - 5}" y2="${y + 5}" stroke="var(--line2)"/><text class="tick" x="${xs[i]}" y="${y + 22}" text-anchor="middle">Day ${n > 0 ? '+' + n : n}</text>`).join('');
  const anchor = `<circle class="anchor-grey" cx="${xOfN(0)}" cy="${y}" r="9" fill="var(--grey-soft)" stroke="#C46A2B" stroke-width="2" stroke-dasharray="4 3"/><text class="mlab" x="${xOfN(0)}" y="${y - 16}" text-anchor="middle" font-weight="700" fill="#8A4517">Day 0 回输（未定）</text>`;
  const mls = (ax.milestones || []).filter((m) => m.n !== 0).map((m) => {
    const x = xOfN(m.n).toFixed(1);
    return `<g><path d="M ${x} ${y - 14} l5 7 -5 7 -5 -7 Z" fill="${m.plan ? '#C9BFB0' : '#1F6E6B'}"/><title>${esc(m.label)}</title></g>`;
  }).join('');
  return `<div class="dayaxis-wrap"><svg class="dayaxis" viewBox="0 0 920 110" role="img" aria-label="Day+N 相对天数轴：Day 0 回输锚点${ax.day0 ? '' : '（未定，灰格占位）'}与里程碑">${axis}${ticks}${anchor}${mls}</svg></div>`;
}
function pageTpDay() {
  const p = profile(); const ax = p.tp.dayAxis;
  const cards = (ax.milestones || []).map((m) => `<div class="da-card${m.plan ? ' plan' : ''}"><b>Day ${m.n > 0 ? '+' + m.n : m.n}</b>${esc(m.label)}</div>`).join('');
  return `${head('Day+N 时间轴与 GVHD', '移植病友的通用语言是相对天数：预处理 → Day 0 回输 → 植入 → Day+100。Day 0 未定时以灰格占位、不造数（K4）。', aiBtn('tp'), 'Day+N 时间轴')}
  <div class="card" style="margin-bottom:12px">
    <div class="card-head"><div><span class="eyebrow">读模型 · anchor = Day 0 回输日（dayNOf(day0, d)）</span><h3 style="font-size:15.5px">移植时间轴 · ${esc(p.tp.status === '已移植' ? '已移植' : 'Day 0 未定')}</h3></div>${pill(ax.day0 ? '回输锚点已定' : '灰格占位 · 未定', 'org')}</div>
    ${dayAxisSVG(ax)}
    <div class="da-cards">${cards}</div>
    <p class="small-note" style="margin-top:10px">${esc(ax.note || '')}</p>
  </div>
  <div class="card">
    <h3 style="font-size:15.5px">GVHD 记录</h3>
    <p style="font-size:13.5px;margin-top:6px">${(p.tp.gvhd || []).length ? '按日期记录部位/分级/用药（只抄原文）。' : '暂无记录。观察三联：皮肤红疹 / 腹泻 / 黄疸——有变化先告诉医护，由医护记录分级；家属可补充"看到的变化"原文。'}</p>
    <p class="small-note" style="margin-top:6px">100 天内频繁复查、感染风险高、免疫重建需 1–2 年；出院 ≠ 结束。移植后随访一律用 Day+N 记录。</p>
  </div>
  <div class="actions" style="margin-top:12px">${go('看移植评估档案 →', 'tp', 'tp-eval', 'soft', 'data-step="to-tp-eval"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 看板 ---------------- */
function metricCard(code) {
  const p = profile(); const m = CATALOG[code];
  const arr = seriesAll(code); if (!arr.length) return '';
  const last = arr[arr.length - 1]; const prev = arr[arr.length - 2];
  const lastTxt = last.neg ? (last.label || '阴性') : `${fmtNum(last.v, m.dec)} ${m.unit}`;
  const back = `<div class="back">${esc(m.note || '数值照抄化验单；解读归医生。')}</div>`;
  return `<div class="m-card"><span class="lab">${esc(m.name)}</span><div class="val" style="color:${m.color}">${esc(lastTxt)}</div><div class="when">${esc(last.d)}${prev ? ` · 上次 ${prev.neg ? (prev.label || '阴性') : fmtNum(prev.v, m.dec)}（${esc(prev.d)}）` : ''}</div>${back}</div>`;
}
function pageDash() {
  const p = profile(); const d = p.dash;
  const all = allViewpoints();
  const quickEntries = [
    ['诱导日历', 'tx', 'tx-cal'], ['粒缺发热（按铃）', 'neu', 'neu-fever'], ['输注记录', 'neu', 'neu-tx'], ['MRD 双口径', 'mrd', 'mrd-trend'],
    ['移植评估', 'tp', 'tp-eval'], ['体温代记（照护者）', 'neu', 'neu-fever'], ['心理与家庭', 'mind', 'mind-feel'], ['复诊准备', 'docs', 'docs-prep']
  ].map(([label, pg, sb], i) => go(label, pg, sb, 'soft', `data-quick="${i}"`)).join('');
  const scenes = SCENES.map(([sid, label, pg, sb]) => go(`${sid} ${label}`, pg, sb, '', `data-scene="${sid}"`)).join('');
  return `${head(`看板 · ${p.name}`, p.stageLine, aiBtn('dash'), '看板')}
  <div class="hero" style="margin-bottom:12px">
    <div class="card dn-card"><span class="eyebrow">D+N 状态卡 · ${esc(d.anchorLabel)}</span><div class="big">第 ${d.anchorDays} 天</div>
      <p style="margin:6px 0 0;font-size:14px">${esc(d.stage)}</p>
      <p class="small-note" style="margin-top:6px">下次：${esc(d.nextVisit)}</p>
      <div class="actions" style="margin-top:10px">${go('看诱导日历（按天）→', 'tx', 'tx-cal', 'org', 'data-step="to-tx-cal"')}${btn('疾病概要：AML 是什么 ?', 'primer', 'soft')}</div></div>
    <div class="card ${d.neutropenic ? 'fever-mode' : ''}"><span class="eyebrow">粒缺期模式卡（ANC&lt;0.5 自动出现）</span>
      ${d.neutropenic ? '<h3 style="margin:6px 0">当前处于粒缺期</h3><p style="font-size:13.5px;margin:0 0 8px">最近 ANC ' + esc(String(d.lastANC.v)) + '×10⁹/L（' + esc(d.lastANC.d) + '）。' + esc(DATA.meta.feverAlert) + '</p><div class="actions">' + go('去粒缺发热轨道 →', 'neu', 'neu-fever', 'primary', 'data-step="to-fever-dash"') + '</div>' : `<h3 style="margin:6px 0;font-size:15.5px">当前不在粒缺期</h3><p style="font-size:13.5px;margin:0 0 8px">${esc(d.modeNote || '')}</p><div class="actions">${go('看血象趋势 →', 'neu', 'neu-cbc', 'soft', 'data-step="to-cbc-dash"')}</div>`}
      <p class="small-note" style="margin-top:8px">照护者：${esc(p.caregiver || '—')}（代记为主，体温/用药记录自动标注记录人）</p></div>
  </div>
  ${section('最近血象与体重', '点卡片看口径与上次值；谷值常在停化疗后 7–14 天。', '')}
  <div class="metric-strip" style="margin-bottom:6px">${['ANC', 'PLT', 'Hb', 'WEIGHT'].map(metricCard).join('')}</div>
  ${section('今天能做的一件事', '双主体各有一个入口：患者本人看趋势与复诊，照护者代记体温与用药。', '')}
  <div class="chip-row">${quickEntries}</div>
  <div class="card" style="margin-top:12px"><span class="eyebrow">私密三出口（K6）</span><p style="font-size:13.5px;margin:6px 0 0">心理与家庭共 ${all.length} 条记录，其中私密 ${privateCount(all)} 条（含"对死亡的准备"${privateCount(deathsAll())} 条）。私密默认不进看板摘要、不进导出、不进 AI 上下文——三出口走同一个 sharedOnly 过滤函数。${go('去心理与家庭 →', 'mind', 'mind-feel', 'linkish', 'data-step="to-mind-dash"')}</p></div>
  ${section('场景直达（S01–S13）', '从患者的话出发：', aiBtn('dash', 'AI 摘要'))}
  <div class="scene-bar">${scenes}</div>`;
}

/* ---------------- 诊断与基因 ---------------- */
function pageDxWk() {
  const p = profile(); const dx = p.dx;
  const rows = dx.timeline.map((x) => {
    const dTxt = monthOnly(x.d) ? `${esc(x.d)} · 仅知月份` : esc(longDate(x.d));
    const dPill = monthOnly(x.d) ? pill('仅知月份 · 灰格占位', 'dashed') : '';
    return `<div class="row-item"><span class="d">${dTxt}</span><span class="txt"><b>${esc(x.item)}</b> ${dPill}<div class="small-note">${esc(x.src || '')}</div></span></div>`;
  }).join('');
  const pending = (p.tx.pending || []).map((x) => `<tr><td><b>${esc(x.item)}</b></td><td>${pill(x.status, x.status === '已出' ? 'green' : x.status === '送检中' ? 'amber' : 'grey')}</td><td>${esc(x.note || '')}</td></tr>`).join('');
  return `${head('确诊经过与四大检查', '血象异常 → 骨穿 → 形态/流式/核型/分子四个结果，各日期允许"仅知月份"。为什么住院第一天就开始化疗：先打骨架、结果出来再调方向（医生答复原文见会诊页）。', aiBtn('dx'), '确诊经过与四大检查')}
  <div class="card" style="margin-bottom:12px"><div class="notice plain" style="margin-bottom:10px"><b>骨穿 ≠ 抽骨髓：</b>${esc(dx.marrowClarify)}</div><div class="list">${rows}</div>
  <p class="small-note" style="margin-top:8px">${esc(dx.precisionNote || '')}</p></div>
  ${section('检查结果等待清单（三态）', '"结果出来会先给医生看"——NGS 等待期 1–2 周是焦虑高峰，等待本身在这里被看见。', go('去等待清单页 →', 'tx', 'tx-pend', 'soft', 'data-step="to-tx-pend"'))}
  <div class="table-wrap"><table><thead><tr><th>项目</th><th>状态</th><th>说明</th></tr></thead><tbody>${pending}</tbody></table></div>
  <div class="actions" style="margin-top:12px">${go('看基因解释卡 →', 'dx', 'dx-gene', 'soft', 'data-step="to-dx-gene"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageDxGene() {
  const p = profile(); const dx = p.dx;
  const cards = dx.genes.map((g) => `<div class="card"><div class="card-head"><h3 style="font-size:15px">${esc(g.name)}</h3>${pill(g.status, g.status === '突变型' ? 'amber' : g.status === '野生型' ? 'green' : 'grey')}</div>
    <div class="kv"><em>状态</em><span>${esc(g.status)}${g.vaf && g.vaf !== '—' ? ' · ' + esc(g.vaf) : ''}</span><em>方法</em><span>${esc(g.method)}${g.d ? ' · ' + esc(longDate(g.d)) : ''}</span></div>
    <p style="font-size:13.5px;margin:8px 0 0">${esc(g.explain)}</p><p class="small-note" style="margin-top:6px">解释不是判断；具体意义请医生结合全部结果说明。</p></div>`).join('');
  return `${head('亚型、分层与基因解释卡', '骨穿是不是抽骨髓、FLT3 阳性是不是很危险——这里逐项给"是什么"；分层只存医院结论，本台不写"你是高危"。', aiBtn('dx'), '亚型、分层与基因解释卡')}
  <div class="grid grid-2" style="margin-bottom:12px">
    <div class="card"><span class="eyebrow">WHO / ICC 分类名（医院报告原文）</span><p style="font-size:14px;margin:6px 0 0">${esc(dx.subtype.who)}</p></div>
    <div class="card"><span class="eyebrow">ELN 分层（只存医院结论，本台不做分层计算）</span><p style="font-size:14px;margin:6px 0 0">${esc(dx.subtype.eln)}</p><p class="small-note" style="margin-top:6px">${esc(dx.subtype.riskBasis)}</p></div>
  </div>
  <div class="notice plain" style="margin-bottom:12px">${esc(dx.subtype.note)}</div>
  <div class="notice warn" style="margin-bottom:12px"><b>未检测 ≠ 阴性（常驻）：</b>${esc(dx.untestedNote)}</div>
  ${section('基因逐项解释', '解释名词，不做判断；不与生存率数据混排。', '')}
  <div class="grid grid-2">${cards}</div>
  <div class="actions" style="margin-top:12px">${go('看确诊经过 →', 'dx', 'dx-wk', 'soft', 'data-step="to-dx-wk"')}${go('看会诊记录 →', 'dx', 'dx-mdt', 'soft', 'data-step="to-dx-mdt"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageDxMdt() {
  const p = profile();
  const rows = (p.dx.consults || []).map((c) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><div><h3 style="font-size:15px">${esc(c.place)}</h3><p>${esc(longDate(c.d))}</p></div>${pill('答复原文', 'blue')}</div><div class="stage-quote">${esc(c.text)}</div></div>`).join('');
  return `${head('会诊与二次意见', '医生答复原文留痕：这里只抄录说过的话，不替医生总结。', aiBtn('dx'), '会诊与二次意见')}
  ${rows}
  <div class="actions" style="margin-top:12px">${go('看基因解释卡 →', 'dx', 'dx-gene', 'soft', 'data-step="to-dx-gene2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 诱导与疗程 ---------------- */
function pageTxPath() {
  const p = profile(); const t = p.tx;
  const fold = (x) => `<details class="phase-fold">
      <summary>
        <span class="tl-dot"></span>
        <b class="ph-name">${esc(x.phase)}</b>
        <span class="ph-date">${esc(longDate(x.d))}</span>
        <span class="ph-brief">${esc(x.text)}</span>
        <span class="ph-hint">展开细节 ▸</span>
      </summary>
      <div class="phase-detail">
        ${[['方案', x.detail?.regimen], ['指标和趋势', x.detail?.metrics], ['影像发现', x.detail?.imaging], ['副作用总结', x.detail?.ae], ['心理与营养措施及效果', x.detail?.support]]
          .map(([title, blk]) => blk ? `<section class="pd-block"><h4>${title}</h4>
            <p class="pd-summary">${esc(blk.summary || '')}</p>
            ${(blk.items || []).map(([k, v]) => `<div class="pd-row"><em>${esc(k)}</em><span>${esc(v)}</span></div>`).join('')}
          </section>` : `<section class="pd-block"><h4>${title}</h4><p class="pd-summary">无（本阶段无此项记录）</p></section>`).join('')}
      </div>
    </details>`;
  const pva = (t.planVsActual || []).map((x) => `<tr><td><b>${esc(x.item)}</b></td><td>${esc(x.plan)}</td><td>${esc(x.actual)}</td></tr>`).join('');
  return `${head('治疗路径（按疗程折叠）', '默认只显「阶段 · 日期 · 一句话概要」；点开看方案 / 指标 / 影像 / 副作用 / 支持措施五块细节；打印时全部展开（beforeprint）。只记录不推荐。', aiBtn('tx'), '治疗路径（折叠卡）')}
  <div class="fold-line">${(t.pathway || []).map(fold).join('')}</div>
  ${section('计划 vs 实际', esc(t.planNote || '日期差只并列，不做依从性评判。'), '')}
  <div class="table-wrap"><table><thead><tr><th>项目</th><th>计划（医生原文）</th><th>实际（记录）</th></tr></thead><tbody>${pva}</tbody></table></div><div class="scroll-hint">左右滑动查看表格（有意为之）</div>
  <div class="actions" style="margin-top:12px">${go('看诱导日历 →', 'tx', 'tx-cal', 'soft', 'data-step="to-tx-cal"')}${go('看巩固与维持 →', 'tx', 'tx-cons', 'soft', 'data-step="to-tx-cons"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageTxCons() {
  const p = profile(); const c = p.tx.cons || {};
  const hi = c.hiDAC ? `<div class="card" style="margin-bottom:12px"><div class="card-head"><div><h3 style="font-size:15.5px">${esc(c.hiDAC.title)}</h3><p>${esc(c.hiDAC.dose)}</p></div>${pill('强化巩固', 'blue')}</div>
    <div class="kv"><em>医生计划</em><span>${esc(c.hiDAC.plan)}</span></div>
    ${(c.hiDAC.cycles || []).map((x) => `<div class="row-item"><span class="d">${esc(longDate(x.start))} → ${esc(longDate(x.end))}</span><span class="txt"><b>${esc(x.n)}</b> · 按计划完成</span></div>`).join('')}
    <p class="small-note" style="margin-top:8px">${esc(c.hiDAC.note || '')}</p></div>` : '';
  const va = c.venAza ? `<div class="card" style="margin-bottom:12px"><div class="card-head"><div><h3 style="font-size:15.5px">${esc(c.venAza.title)}</h3><p>${esc(c.venAza.azaDose)}；${esc(c.venAza.venDose)}</p></div>${pill('低强度', 'org')}</div>
    <div class="kv"><em>剂量阶梯</em><span>${esc(c.venAza.ramp)}</span></div>
    <div class="notice warn" style="margin-top:10px"><b>${esc(c.venAza.interaction.title)}</b><br>${esc(c.venAza.interaction.text)}<div style="margin-top:6px">${pill(c.venAza.interaction.level, 'amber')}</div></div>
    <p class="small-note" style="margin-top:8px">${esc(c.venAza.note || '')}</p></div>` : '';
  return `${head('巩固与维持', '缓解只是开始：CR 之后仍必须继续治疗。HiDAC（强化巩固）与 ven+aza（低强度）分列；本台不评疗效、不排下一程。', aiBtn('tx'), '巩固与维持')}
  ${hi}${va}
  <div class="notice plain">${esc(c.note || '')}</div>
  <div class="actions" style="margin-top:12px">${go('看治疗路径 →', 'tx', 'tx-path', 'soft', 'data-step="to-tx-path2"')}${go('看移植评估 →', 'tp', 'tp-eval', 'soft', 'data-step="to-tp-eval"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageTxPend() {
  const p = profile();
  const rows = (p.tx.pending || []).map((x) => `<tr><td><b>${esc(x.item)}</b></td><td>${pill(x.status, x.status === '已出' ? 'green' : x.status === '送检中' ? 'amber' : 'grey')}</td><td>${esc(longDate(x.d || ''))}</td><td>${esc(x.note || '')}</td></tr>`).join('');
  return `${head('检查结果等待清单', '基因 3–7 天、NGS 1–2 周才出，而化疗不等——等待本身在这里被看见：未送 / 送检中 / 已出三态；"结果出来会先给医生看"。', aiBtn('tx'), '检查结果等待清单')}
  <div class="table-wrap"><table><thead><tr><th>项目</th><th>状态</th><th>出结果日</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div><div class="scroll-hint">左右滑动查看表格</div>
  <p class="small-note" style="margin-top:8px">${esc(p.tx.pendingNote || '')}</p>
  <div class="actions" style="margin-top:12px">${go('看诱导日历 →', 'tx', 'tx-cal', 'soft', 'data-step="to-tx-cal2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 粒缺、血象与支持 ---------------- */
function pageNeuCbc() {
  const p = profile();
  const cards = ['ANC', 'WBC', 'Hb', 'PLT'].map((code) => {
    const arr = (p.metrics.numeric || {})[code] || []; if (!arr.length) return '';
    const m = CATALOG[code]; const last = arr[arr.length - 1];
    const min = arr.reduce((a, b) => (b.v < a.v ? b : a), arr[0]);
    return `<div class="card"><div class="card-head"><h3 style="font-size:15px">${esc(m.name)}</h3><span class="val" style="color:${m.color};font-weight:650">${fmtNum(last.v, m.dec)} ${m.unit}</span></div>
      <p class="small-note">最近：${esc(last.d)}${arr.length > 1 ? ` · 上次 ${fmtNum(arr[arr.length - 2].v, m.dec)}（${esc(arr[arr.length - 2].d)}）` : ''}</p>
      <p class="small-note">谷值：${fmtNum(min.v, m.dec)}（${esc(min.d)}）— 谷值期语境对照；分级与解读归医生。</p>
      <p class="small-note" style="margin-top:4px">${esc(m.note || '数值照抄化验单。')}</p></div>`;
  }).join('');
  return `${head('血象趋势', '四项分组卡 + 谷值期对照：只给数值、上次值、谷值与何时复查；CTCAE 分级与解读归医生，本台不分级。', aiBtn('chart'), '血象趋势')}
  <div class="grid grid-2">${cards}</div>
  <div class="notice plain" style="margin-top:12px">何时复查：以预约与医嘱为准（最近一次 ${esc((p.metrics.numeric.ANC.slice(-1)[0] || {}).d || '—')}）。谷值期（停化疗后 7–14 天）是发热/出血/口腔溃疡高发窗口——防护与活动安排听医生与护士的（答复原文见「食物安全」页）。</div>
  <div class="actions" style="margin-top:12px">${go('看病情一图秀 →', 'chart', '', 'soft', 'data-step="to-chart"')}${go('看输注记录 →', 'neu', 'neu-tx', 'soft', 'data-step="to-neu-tx"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageNeuTx() {
  const p = profile();
  const rows = (p.neu.transfusions || []).map((t) => `<tr><td class="num">${esc(longDate(t.d))}</td><td>${pill(t.comp, t.comp === '红细胞' ? 'red' : 'amber')}</td><td class="num">${esc(t.units)}</td><td class="num">${esc(t.pre)}</td><td>${esc(t.reaction)}</td><td>${esc(t.attr)}</td></tr>`).join('');
  const rbc = (p.neu.transfusions || []).filter((t) => t.comp === '红细胞').reduce((s, t) => s + (parseInt(t.units) || 0), 0);
  const pltN = (p.neu.transfusions || []).filter((t) => t.comp === '血小板').length;
  return `${head('输注记录与反应', '又输血了是不是很严重——这里按成分分列：日期 / 量 / 输注前血象 / 反应 / 辐照去白；累计只做红细胞单位汇总，不判依赖（K5）。', aiBtn('neu'), '输注记录与反应')}
  <div class="grid grid-3" style="margin-bottom:12px">
    <div class="card"><span class="eyebrow">累计红细胞</span><div class="big" style="color:var(--red)">${rbc} u</div><p class="small-note">铁过载评估的直接输入（是否祛铁由医生决定；血清铁蛋白记录见指标）。</p></div>
    <div class="card"><span class="eyebrow">血小板输注</span><div class="big" style="color:var(--amber)">${pltN} 次</div><p class="small-note">只汇总次数与日期；"依赖"是否成立由医生判断。</p></div>
    <div class="card"><span class="eyebrow">口径</span><div style="font-size:13px;margin-top:4px">禁"总输注"合成列；成分分列（红细胞/血小板/血浆）。</div></div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>日期</th><th>成分</th><th>量</th><th>输注前</th><th>反应</th><th>制备</th></tr></thead><tbody>${rows}</tbody></table></div><div class="scroll-hint">左右滑动查看表格</div>
  <p class="small-note" style="margin-top:8px">${esc(p.neu.transfusionNote || '')}</p>
  <div class="actions" style="margin-top:10px">${btn('＋ 登记一次输注', 'txf-add', 'primary', 'data-step="txf-add"')}</div>
  <div class="actions" style="margin-top:12px">${go('看血象趋势 →', 'neu', 'neu-cbc', 'soft', 'data-step="to-neu-cbc2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageNeuOral() {
  const p = profile();
  const rows = (p.neu.oral || []).map((o) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><div><h3 style="font-size:15px">${esc(longDate(o.d))} · ${esc(o.grade)}</h3><p>进食能力：${esc(o.eat)}</p></div>${pill('WHO 分级 · 抄录', 'blue')}</div><p style="font-size:13.5px;margin:4px 0 0">${esc(o.measure)}</p></div>`).join('');
  return `${head('黏膜炎与症状', '口腔溃疡疼得吃不下——按 WHO 0–IV 分级呈现强度与进食能力（比疼痛评分对家属更直观）；不画曲线、不荐护理方案（S07）。', aiBtn('care'), '黏膜炎与症状')}
  ${rows || '<div class="empty"><h3>暂无黏膜炎记录</h3><p>化疗后 7–14 天高发（与谷值期重叠）。</p></div>'}
  <div class="notice plain" style="margin-top:10px">${esc(p.neu.oralNote || '')}</div>
  <div class="actions" style="margin-top:10px">${btn('＋ 记录一次黏膜炎', 'oral-add', 'primary', 'data-step="oral-add"')}</div>
  <div class="actions" style="margin-top:12px">${go('看粒缺期食物安全 →', 'care', 'care-safe', 'soft', 'data-step="to-care-safe"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageNeuInf() {
  const p = profile();
  const rows = (p.neu.infections || []).map((x) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><div><h3 style="font-size:15px">${esc(longDate(x.d))} · ${esc(x.name)}</h3></div>${pill('发作史', 'red')}</div><p style="font-size:13.5px;margin:4px 0 0">${esc(x.detail)}</p></div>`).join('');
  return `${head('感染档案与预防', '发作史、预防用药（按院方原文）、疫苗话题只记"问过什么、答了什么"原文；不指导用药（K2）。', aiBtn('neu'), '感染档案与预防')}
  ${rows}
  <div class="card" style="margin-bottom:10px"><span class="eyebrow">预防用药（院方原文）</span><p style="font-size:13.5px;margin:6px 0 0">${esc(p.neu.prophylaxis || '')}</p></div>
  <div class="notice plain">${esc(p.neu.vaccineNote || '')}</div>
  <div class="actions" style="margin-top:12px">${go('看粒缺发热轨道 →', 'neu', 'neu-fever', 'soft', 'data-step="to-neu-fever3"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- MRD 与随访 ---------------- */
function mrdMiniSVG(list, color) {
  const W = 440, H = 230, X0 = 46, X1 = 420, Y0 = 24, Y1 = 178;
  if (!list.length) return `<div class="empty" style="padding:24px"><p style="margin:0">本口径暂无记录——<b>未检测 ≠ 阴性</b>：没查不等于转阴。</p></div>`;
  const t0 = Date.parse(list[0].d) - 6 * DAY, t1 = Date.parse(list[list.length - 1].d) + 6 * DAY;
  const vals = list.map((x) => x.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(hi * 0.1, 0.01);
  const xOf = (d) => X0 + (Date.parse(d) - t0) / (t1 - t0) * (X1 - X0);
  const yOf = (v) => Y1 - (v - lo) / span * (Y1 - Y0);
  const coords = list.map((x) => ({ x: xOf(x.d), y: yOf(x.v) }));
  const path = list.length > 1 ? `<path d="${smoothPath(coords)}" fill="none" stroke="${color}" stroke-width="2.2"/>` : '';
  const dots = list.map((x, i) => `<circle class="pt${x.neg ? ' neg' : ''}" cx="${coords[i].x.toFixed(1)}" cy="${coords[i].y.toFixed(1)}" r="${x.neg ? 4.5 : 4}" ${x.neg ? `stroke="${color}" fill="#fff"` : `fill="${color}"`}><title>${esc(`${x.d} · ${x.label} · ${x.src}`)}</title></circle>`).join('');
  const ticks = list.map((x, i) => `<text class="tick" x="${coords[i].x.toFixed(1)}" y="${Y1 + 16}" text-anchor="middle">${esc(String(x.d).slice(2))}</text>`).join('');
  const labs = list.map((x, i) => `<text x="${coords[i].x.toFixed(1)}" y="${(coords[i].y - 10).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="${color}">${esc(x.label)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="MRD 趋势（单方法单靶点连线）">
    <line class="grid" x1="${X0}" x2="${X1}" y1="${Y1}" y2="${Y1}"/>
    ${path}${dots}${labs}${ticks}
    <text x="${X0}" y="${H - 6}" font-size="9.5" fill="#9a8f7e">同方法同靶点才连线；阴性点画在检出限（空心）。</text>
  </svg>`;
}
function pageMrdTrend() {
  const p = profile(); const m = p.mrd;
  return `${head('MRD 双口径趋势', '流式 % 与 PCR（靶点绑定）两列并列，跨方法不连线不换算；趋势比单点重要，判读归医生（K3）。', aiBtn('mrd'), 'MRD 双口径趋势')}
  <div class="warn-card"><b>警示一（常驻，不可关闭）：</b>${esc(m.warn1)}</div>
  <div class="warn-card"><b>警示二（常驻，不可关闭）：</b>${esc(m.warn2)}</div>
  <div class="notice plain" style="margin-bottom:12px"><b>未检测 ≠ 阴性：</b>${esc(m.untestedNote)} ${esc(m.methodNote || '')}</div>
  <div class="mrd-cols">
    <div class="card"><div class="card-head"><h3 style="font-size:15px">多色流式（LAIP %）</h3>${pill('口径一', 'blue')}</div>${mrdMiniSVG(m.flow, '#6B4F9E')}
      <div class="list" style="margin-top:8px">${m.flow.map((x) => `<div class="row-item"><span class="d">${esc(longDate(x.d))}</span><span class="txt">${esc(x.label)} <span class="small-note">${esc(x.src)}</span></span></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><h3 style="font-size:15px">PCR（RQ-PCR · 靶点绑定）</h3>${pill('口径二', 'org')}</div>${m.pcr.length ? mrdMiniSVG(m.pcr, '#1F6E6B') + `<div class="list" style="margin-top:8px">${m.pcr.map((x) => `<div class="row-item"><span class="d">${esc(longDate(x.d))}</span><span class="txt">${esc(x.label)} <span class="small-note">${esc(x.src)}</span></span></div>`).join('')}</div>` : `<div class="notice plain">${esc(m.methodNote || '本靶点不适用 PCR 监测（医生答复原文）。')}</div>`}</div>
  </div>
  <p class="small-note" style="margin-top:10px">跨方法不共轴不连线（27 号）；不存在单一"MRD 状态"合并字段。MRD 进一图秀时只以同方法（流式）单线出现。</p>
  <div class="actions" style="margin-top:12px">${go('看骨穿记录 →', 'mrd', 'mrd-bm', 'soft', 'data-step="to-mrd-bm"')}${go('看病情一图秀 →', 'chart', '', 'soft', 'data-step="to-chart2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageMrdBm() {
  const p = profile();
  const rows = (p.mrd.marrows || []).map((x) => `<tr><td class="num">${esc(longDate(x.d))}</td><td>${esc(x.site)}</td><td class="num">${esc(x.blast)}</td><td>${esc(x.result)}</td></tr>`).join('');
  return `${head('骨穿与标本记录', '每疗程采样日期/部位/结果原文；原始细胞百分比存原文+数值，判读归医生。', aiBtn('mrd'), '骨穿与标本记录')}
  <div class="table-wrap"><table><thead><tr><th>采样日期</th><th>部位</th><th>原始细胞（原文）</th><th>结论</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="small-note" style="margin-top:8px">骨穿是局麻下取约 0.2mL 骨髓液，10–15 分钟；不是"捐献骨髓"抽骨髓。</p>
  <div class="actions" style="margin-top:10px">${btn('＋ 登记一次骨穿采样', 'bm-add', 'primary', 'data-step="bm-add"')}</div>
  <div class="actions" style="margin-top:12px">${go('看 MRD 趋势 →', 'mrd', 'mrd-trend', 'soft', 'data-step="to-mrd-trend"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageMrdRhythm() {
  const p = profile();
  const rows = (p.mrd.rhythm || []).map((x) => `<div class="row-item"><span class="d">${esc(x.kind)}</span><span class="txt"><b>${esc(x.rhythm)}</b><div class="small-note">${esc(x.dates || '')}</div></span></div>`).join('');
  return `${head('复查节奏与影像并列', '骨穿按疗程、影像按区间（S09）；节点=起点+k×间隔，带宽标注为工作台约定，不是医生承诺。', aiBtn('mrd'), '复查节奏与影像并列')}
  <div class="card"><div class="list">${rows}</div></div>
  <div class="notice plain" style="margin-top:10px">同模态影像才并列（S09）；跨模态对比在本台不做。影像结论一律原文抄录、不判读。</div>
  <div class="actions" style="margin-top:12px">${go('看病情一图秀 →', 'chart', '', 'soft', 'data-step="to-chart3"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 移植 ---------------- */
function pageTpEval() {
  const p = profile(); const tp = p.tp;
  const flow = tp.statusFlow.map((s) => pill(s + (s === tp.status ? ' ← 当前' : ''), s === tp.status ? 'org' : 'grey')).join(' ');
  const items = (tp.evalItems || []).map((x) => `<tr><td><b>${esc(x.item)}</b></td><td class="num">${esc(x.d ? longDate(x.d) : '—')}</td><td>${esc(x.result)}</td></tr>`).join('');
  return `${head('移植评估档案', '要不要移植、半相合是不是退而求其次——这里只有评估过程、供者记录与医生答复原文；本台零推荐（K4）。', aiBtn('tp'), '移植评估档案')}
  <div class="card" style="margin-bottom:12px"><span class="eyebrow">状态机（移植是状态不是事件）</span><div class="chip-row" style="margin-top:8px">${flow}</div>
    <div class="stage-quote" style="margin-top:10px">${esc(tp.statusNote || '')}</div></div>
  ${section('评估项目', '心肺功能 / 感染筛查 / 铁过载——逐项记录，未做不假装做了。', '')}
  <div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>项目</th><th>日期</th><th>结果（原文）</th></tr></thead><tbody>${items}</tbody></table></div>
  <div class="card" style="margin-bottom:12px"><span class="eyebrow">医生答复原文</span><div class="stage-quote" style="margin-top:6px">${esc(tp.doctorReply || '')}</div></div>
  <div class="notice warn"><b>零推荐（常驻）：</b>${esc(tp.zeroRec || '')}</div>
  <div class="actions" style="margin-top:12px">${go('看供者与配型 →', 'tp', 'tp-donor', 'soft', 'data-step="to-tp-donor"')}${go('看 Day+N 时间轴 →', 'tp', 'tp-day', 'soft', 'data-step="to-tp-day"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageTpDonor() {
  const p = profile(); const d = p.tp.donor;
  return `${head('供者与配型记录', '四类供者（同胞全合 / 半相合 / 无关 / 脐血）+ HLA 相合度 + 检索与确认日期。半相合的可及性有文献出处（黄晓军团队单倍型移植综述，2019），本台只转述出处、不作安慰话。', aiBtn('tp'), '供者与配型记录')}
  <div class="grid grid-2" style="margin-bottom:12px">
    <div class="card"><span class="eyebrow">供者类型</span><div class="big" style="font-size:17px;margin:6px 0">${esc(d.type)}</div><div class="kv"><em>关系</em><span>${esc(d.rel)}</span><em>HLA 相合度</em><span>${esc(d.hla)}</span></div><p class="small-note" style="margin-top:8px">${esc(d.note || '')}</p></div>
    <div class="card"><span class="eyebrow">其他供者类型</span><p style="font-size:13.5px;margin:6px 0 0">${esc(d.otherTypes || '如涉及将逐类记录。')}</p><p class="small-note" style="margin-top:6px">配型流程：初诊/早期即对同胞及家属做 HLA 高分辨分型；无关供者检索周期数周–数月。</p></div>
  </div>
  <div class="notice warn"><b>零推荐（常驻）：</b>${esc(p.tp.zeroRec || '')}</div>
  <div class="actions" style="margin-top:12px">${go('看移植评估档案 →', 'tp', 'tp-eval', 'soft', 'data-step="to-tp-eval2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 一图秀页 ---------------- */
function pageChart() {
  const p = profile();
  const sel = state.sel[state.profileId];
  const selList = CAT_ORDER.map((cat) => `<div class="sel-item" style="display:block"><b style="font-size:12px;color:var(--muted)">${esc(cat)}</b><div class="sel-list" style="margin-top:4px">${Object.entries(CATALOG).filter(([, m]) => m.cat === cat).map(([code, m]) => `<label class="sel-item"><input type="checkbox" data-action="sel" data-code="${code}" ${sel.includes(code) ? 'checked' : ''}><span class="nm"><b>${esc(m.name)}</b>${m.note ? `<br><span class="small-note">${esc(m.note)}</span>` : ''}</span></label>`).join('')}</div></div>`).join('');
  const t0t1 = domain();
  return `${head('病情一图秀', 'ANC/PLT + 体重 + 同方法 MRD 放回同一段时间；疗程/粒缺发作/输注是分类节点，只画节点不连线。月粒度轴：小时级体温只以"发作"期带出现（不跨尺度共轴）。', aiBtn('chart'), '病情一图秀')}
  <div class="chart-panel" id="chart-panel" data-product="一图秀">
    <div class="chart-top">
      <div class="seg" role="group" aria-label="时间范围">
        ${[['all', '全部'], ['6m', '6 个月'], ['3m', '3 个月']].map(([k, l]) => `<button data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}
      </div>
      <label class="sel-item" style="gap:6px"><input type="checkbox" data-action="treat-toggle" ${state.toggles.treatment ? 'checked' : ''}><span class="nm">显示疗程 / 发作 / 输注节点</span></label>
    </div>
    <div class="chart-body grid-chart">
      <div class="chart-wrap" style="min-width:0"><div class="scroll-hint">曲线过宽时可横向滚动（有意为之）→</div>${chartSVG(t0t1[0], t0t1[1])}</div>
      <div class="sel-list">${selList}</div>
    </div>
    <div class="chart-legend">${Object.entries(CATALOG).filter(([c]) => sel.includes(c)).map(([c, m]) => `<span><i style="background:${m.color}"></i>${esc(m.name)}</span>`).join('')}</div>
  </div>
  <p class="small-note" style="margin-top:10px">三种时间粒度分属三个组件、互不混轴：月粒度=本页 / 天粒度=诱导日历 / 小时粒度=粒缺发热轨道（16 号合同补充断言）。</p>
  <div class="actions" style="margin-top:12px">${go('看血象趋势 →', 'neu', 'neu-cbc', 'soft', 'data-step="to-neu-cbc3"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 营养与生活 ---------------- */
function pageCareIntake() {
  const p = profile();
  const meals = [...(p.care.meals || []), ...mem().meals];
  const rows = meals.map((x) => `<div class="row-item"><span class="d">${esc(longDate(x.d))}</span><span class="txt">${esc(x.text)} ${x.author ? roleTag(x.author) : ''}</span></div>`).join('');
  return `${head('食量与体重', '粒缺期什么都不能吃吗——份量、食物、症状照记；体重进指标卡与一图秀；不给食谱处方（S10）。', aiBtn('care'), '食量与体重')}
  <div class="card" style="margin-bottom:12px"><div class="list">${rows || '<p class="small-note">暂无记录。</p>'}</div></div>
  <div class="notice plain" style="margin-bottom:10px">${esc(p.care.weightNote || '')}</div>
  <div class="actions">${btn('＋ 记一次食量', 'meal-add', 'primary', 'data-step="meal-add"')}${go('看粒缺期食物安全 →', 'care', 'care-safe', 'soft', 'data-step="to-care-safe2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageCareSafe() {
  const p = profile();
  const safe = (p.care.safe || []).map((x) => `<div class="row-item"><span class="txt">${esc(x.item)} <span class="small-note">（${esc(x.src)}）</span></span></div>`).join('');
  const io = [...(p.care.inout || []), ...mem().io];
  const ioRows = io.map((x) => `<tr><td class="num">${esc(longDate(x.d))}</td><td class="num">${esc(x.in)}</td><td class="num">${esc(x.out)}</td><td>${esc(x.note || '')}</td></tr>`).join('');
  return `${head('粒缺期食物安全与出入量', '事实提醒非命令式：避免生食/隔夜菜按院方原文；呕吐记出入量防脱水；不给食谱、不命令式（S07/S10）。', aiBtn('care'), '粒缺期食物安全与出入量')}
  <div class="card" style="margin-bottom:12px"><span class="eyebrow">食物安全（事实提醒）</span><div class="list" style="margin-top:6px">${safe}</div></div>
  <div class="notice plain" style="margin-bottom:12px">${esc(p.care.safeNote || '')}</div>
  ${section('出入量', '呕吐/腹泻多的日子记录，防脱水；数值代记自动标注记录人。', '')}
  <div class="table-wrap" style="margin-bottom:10px"><table><thead><tr><th>日期</th><th>入量</th><th>出量</th><th>备注</th></tr></thead><tbody>${ioRows}</tbody></table></div>
  <div class="actions">${btn('＋ 记一次出入量', 'io-add', 'primary', 'data-step="io-add"')}${go('看食量与体重 →', 'care', 'care-intake', 'soft', 'data-step="to-care-intake"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 心理与家庭 ---------------- */
function feelRow(x, kind) {
  return `<div class="row-item"><span class="d">${esc(longDate(x.d))}</span><span class="txt">${esc(x.text)}<div class="small-note" style="margin-top:3px">${roleTag(x.author)}${x.role ? ` · ${esc(x.role)}` : ''} · ${pill(x.visibility === 'private' ? 'private' : 'shared', x.visibility === 'private' ? 'dashed' : 'blue')}</div></span>
  <button class="linkish" data-action="vis-toggle" data-kind="${kind}" data-d="${esc(x.d)}" data-author="${esc(x.author)}">${x.visibility === 'private' ? '改为共享' : '改为私密'}</button></div>`;
}
function pageMindFeel() {
  const p = profile();
  const rows = feelsAll().map((x) => feelRow(x, 'feels')).join('');
  return `${head('当下感受（双主体）', '"我不敢跟家里人说我在想什么"——患者与照护者各自记录、并列展示、不平均；FCR（复发恐惧）不随缓解归零，反复出现是正常的（K6）。', aiBtn('mind'), '当下感受（双主体）')}
  <div class="card" style="margin-bottom:12px"><div class="list">${rows || '<p class="small-note">暂无记录。</p>'}</div></div>
  <div class="notice plain" style="margin-bottom:10px">${esc(p.mind.note || '')}</div>
  <div class="actions">${btn('＋ 记一条感受', 'feel-add', 'primary', 'data-step="feel-add"')}${go('看对死亡的准备（私密）→', 'mind', 'mind-death', 'soft', 'data-step="to-mind-death"')}${go('看家庭负担 →', 'mind', 'mind-burden', 'soft', 'data-step="to-mind-burden"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageMindDeath() {
  const p = profile();
  const rows = deathsAll().map((x) => feelRow(x, 'deaths')).join('');
  const n = deathsAll().length; const pn = privateCount(deathsAll());
  return `${head('对死亡的准备（私密）', '默认私密：默认不进导出、不进看板摘要、不进 AI 上下文（三出口同一过滤函数）；逐项可改共享；本台不承诺、不判读（S11）。', aiBtn('mind'), '对死亡的准备（私密）')}
  <div class="notice warn" style="margin-bottom:12px"><b>三出口口径（常驻）：</b>本页 ${n} 条记录中私密 ${pn} 条。导出、看板摘要、AI 上下文三处出口共用 sharedOnly() 过滤；私密内容进折叠卡 support 块时只显示"记录存在 + 已过滤"，不带数值。</div>
  <div class="card" style="margin-bottom:12px"><div class="list">${rows || '<p class="small-note">暂无记录。</p>'}</div></div>
  <div class="notice plain">${esc(p.mind.death.note || '')}</div>
  <div class="actions" style="margin-top:10px">${btn('＋ 记一条（默认私密）', 'death-add', 'primary', 'data-step="death-add"')}${go('看当下感受 →', 'mind', 'mind-feel', 'soft', 'data-step="to-mind-feel"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageMindBurden() {
  const p = profile();
  const rows = [...(p.mind.burden || []), ...mem().burdens].map((x) => feelRow(x, 'burdens')).join('');
  return `${head('家庭负担与照护者', '照护者自己的记录位："还能正常上班吗"在这里承接；代记的体温/用药在粒缺发热轨道（author_role=CAREGIVER）。', aiBtn('mind'), '家庭负担与照护者')}
  <div class="card" style="margin-bottom:12px"><div class="list">${rows || '<p class="small-note">暂无记录。</p>'}</div></div>
  <div class="notice plain" style="margin-bottom:10px">照护者：${esc(p.caregiver || '—')}。照护者的疲惫、经济与工作影响只记录事实；支持资源见医生答复原文与院方患教。</div>
  <div class="actions">${btn('＋ 记一条照护记录', 'burden-add', 'primary', 'data-step="burden-add"')}${go('看体温代记轨道 →', 'neu', 'neu-fever', 'soft', 'data-step="to-neu-fever4"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 资料与复诊 ---------------- */
function pageDocsLib() {
  const p = profile();
  const docs = [...(p.docs.materials || []), ...mem().docs];
  const rows = docs.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.kind)}</td><td>${pill(x.status, x.status === '已核对' ? 'green' : 'amber')}</td></tr>`).join('');
  return `${head('资料库与导入', '病理/流式/基因/影像报告分类；MinerU 六部件解析、失败不产候选（S13）；解析结果进「整理草稿与核对」。', aiBtn('docs'), '资料库与导入')}
  <div class="table-wrap" style="margin-bottom:10px"><table><thead><tr><th>材料</th><th>类型</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><div class="scroll-hint">左右滑动查看表格</div>
  <div class="actions">${btn('＋ 加入解析队列（演示）', 'doc-add', 'primary', 'data-step="doc-add"')}${go('去整理草稿与核对 →', 'docs', 'docs-cand', 'soft', 'data-step="to-docs-cand"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageDocsCand() {
  const p = profile();
  const cands = (p.docs.candidates || []).map((c) => `<div class="cand-card" style="margin-bottom:12px">
    <div class="card-head"><h3 style="font-size:15px">${esc(c.title)}</h3>${pill('候选 · 未入事实层', 'amber')}</div>
    <div class="kv">${c.fields.map(([k, v]) => `<em>${esc(k)}</em><span>${esc(v)}</span>`).join('')}</div>
    <p class="small-note" style="margin-top:8px">来源：${esc(c.src)}</p>
    <div class="actions" style="margin-top:8px">${btn('核对通过，入事实层', 'cand-ok', 'primary', `data-cand="${c.id}"`)}${btn('不对，改一下', 'cand-fix', 'soft', `data-cand="${c.id}"`)}${btn('不用这条', 'cand-reject', '', `data-cand="${c.id}"`)}</div>
  </div>`).join('');
  return `${head('整理草稿与核对', '候选逐项 accept 前不进正式数据：核对通过 / 修改 / 拒收零副作用——闭环三步（X4）。', aiBtn('docs'), '整理草稿与核对')}
  ${cands || '<div class="empty"><h3>暂无候选</h3><p>从「资料库与导入」加入解析队列。</p></div>'}
  <div class="actions">${go('看资料库 →', 'docs', 'docs-lib', 'soft', 'data-step="to-docs-lib2"')}${go('看就诊准备 →', 'docs', 'docs-prep', 'soft', 'data-step="to-docs-prep"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageDocsPrep() {
  const p = profile();
  const qs = questions().map((q) => `<div class="row-item"><label class="txt" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-action="q-asked" data-id="${q.id}" ${q.asked ? 'checked' : ''}><span>${esc(q.text)} <span class="small-note">（${esc(q.src)}）</span></span></label></div>`).join('');
  const all = allViewpoints(); const pn = privateCount(all);
  return `${head('就诊准备与导出', '复诊带什么——两区导出：「给医生的病程摘要」（默认过滤 private）与「自存全量」；问题清单带"已问"标记与"已过时"标注（S06）。', aiBtn('docs'), '就诊准备与导出')}
  <div class="card" style="margin-bottom:12px"><span class="eyebrow">疑问清单（版本：${esc(TODAY)} 生成）</span><div class="list" style="margin-top:6px">${qs || '<p class="small-note">暂无。</p>'}</div>
  <div class="actions" style="margin-top:8px">${btn('＋ 加一条要问的', 'q-add', 'soft', 'data-step="q-add"')}</div></div>
  ${section('两区导出（三出口之一）', `心理与家庭共 ${all.length} 条，私密 ${pn} 条默认不进「给医生的摘要」（K6 sharedOnly）。`, '')}
  <div class="actions">${btn('生成「给医生的病程摘要」', 'export-shared', 'primary', 'data-step="export-shared"')}${btn('生成「自存全量」', 'export-full', 'soft', 'data-step="export-full"')}</div>
  <p class="small-note" style="margin-top:8px">${esc(p.docs.exportNote || '')}</p>
  <div class="actions" style="margin-top:12px">${go('看试验线索 →', 'docs', 'docs-trial', 'soft', 'data-step="to-docs-trial"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}
function pageDocsTrial() {
  const p = profile();
  const rows = (p.docs.trials || []).map((t) => `<tr><td><b>${esc(t.name)}</b><div class="small-note">${esc(t.note || '')}</div></td><td class="num">${esc(t.nct)}</td><td>${esc(t.center)}</td><td>${pill(t.status, 'amber')}</td></tr>`).join('');
  return `${head('试验线索', 'venetoclax / FLT3 / IDH 方向的 2026 登记库线索：线索不是推荐；是否适合由医生评估（S12）。', aiBtn('docs'), '试验线索')}
  <div class="table-wrap"><table><thead><tr><th>研究</th><th>登记号</th><th>中心</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><div class="scroll-hint">左右滑动查看表格</div>
  <div class="notice plain" style="margin-top:10px">${esc(DATA.meta.trialNote || '')}</div>
  <div class="actions" style="margin-top:12px">${go('看就诊准备 →', 'docs', 'docs-prep', 'soft', 'data-step="to-docs-prep2"')}${go('回到看板', 'dash', '', 'linkish')}</div>`;
}

/* ---------------- 疾病概要（36 号「?」入口） ----------------
   形态是整页视图（32 号），不是弹窗：四段内容必然超过 1.5 屏。
   实现走 primer.js（window.DiseasePrimer），数据在 primer-data.js（window.DISEASE_PRIMER），
   与 README 的「## 疾病概要」四段同源。这里只保留一个兜底：
   若 primer.js 未加载（例如开发版只同步了业务四件套），提示而非静默失效。 */
function openPrimer() {
  if (window.DiseasePrimer && typeof window.DiseasePrimer.open === 'function') {
    window.DiseasePrimer.open(document.querySelector('[data-primer-open]'));
    return;
  }
  toast('疾病概要页未加载（primer.js / primer-data.js 缺失）——这不是内容为空，是文件没同步');
}

/* ---------------- 表单（每页显式编辑入口 ≤1；每表单 ≤6 字段） ---------------- */
function openForm(title, fields, onSave, eyebrowLabel = '记录 · 演示（仅内存）') {
  const body = `<div class="form-grid">${fields.map((f) => `<label>${esc(f.label)}${f.type === 'select' ? `<select data-f="${f.key}">${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>` : `<input type="${f.type || 'text'}" data-f="${f.key}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`}</label>`).join('')}</div>
  <p class="small-note" style="margin-top:8px">演示：刷新重置；正式版登记新版本、旧记录保留。</p>`;
  openModal(title, body, `<button class="primary" id="form-save">保存</button><button data-action="close">取消</button>`, eyebrowLabel);
  $('#form-save').addEventListener('click', () => {
    const vals = {};
    let bad = '';
    fields.forEach((f) => {
      const el = $(`#dialog-body [data-f="${f.key}"]`);
      vals[f.key] = el ? el.value.trim() : '';
      if (f.required && !vals[f.key]) bad = bad || f.label;
    });
    if (bad) { toast(`先填：${bad}`); return; }
    onSave(vals); closeModal();
  });
}
/* 粒缺发热判定（K2）。口径来自中国中性粒细胞缺乏伴发热指南（2020 年版）：
     单次 ≥38.3℃ 即成立；
     ≥38.0℃ 必须「持续超过 1 小时」才成立——单次 38.1℃ 不等于粒缺发热。
   两个条件不能写成一个 `v >= 38.3 || v >= 38.0`：那在数学上等价于 `v >= 38.0`，
   会让每一次 38.1℃ 都弹「这是急症信号」，把定义里的时长条件整个丢掉。
   实现：38.0–38.2℃ 先按「观察」记录并提示复测；只有同一次发热事件里
   存在 ≥1 小时的持续证据（相邻记录跨度 ≥60 分钟且都在 38.0 以上）才升级为急症。 */
const FEVER_SINGLE = 38.3;
const FEVER_SUSTAINED = 38.0;
const FEVER_SUSTAINED_MS = 60 * 60 * 1000;

/** 返回 { level: 'none' | 'watch' | 'fever', why } —— 只做记录分流，不做医疗建议。 */
function classifyTemp(ts, v, priorTemps) {
  if (!Number.isFinite(v)) return { level: 'none', why: '数值无效' };
  if (v >= FEVER_SINGLE) {
    return { level: 'fever', why: `单次 ${v.toFixed(1)}℃ ≥ ${FEVER_SINGLE}℃（定义口径：单次即成立）` };
  }
  if (v >= FEVER_SUSTAINED) {
    /* 找同一次发热事件里更早的一条 ≥38.0 记录，看跨度是否已满 1 小时 */
    const t = Date.parse(ts);
    const since = (priorTemps || [])
      .filter((x) => x.v >= FEVER_SUSTAINED && Date.parse(x.ts) <= t && t - Date.parse(x.ts) >= FEVER_SUSTAINED_MS)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
    if (since) {
      const mins = Math.round((t - Date.parse(since.ts)) / 60000);
      return { level: 'fever', why: `${FEVER_SUSTAINED}℃ 以上已持续 ${mins} 分钟（>1 小时，定义口径成立；自 ${since.ts.replace('T', ' ')} 起）` };
    }
    return { level: 'watch', why: `${v.toFixed(1)}℃ 未到单次 ${FEVER_SINGLE}℃ 线；定义要求 ${FEVER_SUSTAINED}℃ 持续>1 小时才成立，请 1 小时内复测并记录` };
  }
  return { level: 'none', why: `${v.toFixed(1)}℃ 未达 ${FEVER_SUSTAINED}℃` };
}

function feverFlag(ts, v, author, why) { /* K2：急症提示不可忽略关闭——必须确认"按铃/联系医护"才能关 */
  openModal('这是急症信号', `<div class="hl-def"><b>≥38.3℃（或 ≥38.0℃ 持续>1h）+ ANC&lt;0.5 = 粒缺发热（定义原文口径）。</b><br><br>${esc(DATA.meta.feverAlert)}</div>
  <p style="margin:10px 0 0"><b>本次判定依据：</b>${esc(why || '')}</p>
  <p class="small-note" style="margin-top:8px">本台不指导用药；是否服用退烧药、何时赴院，按医护指示。粒缺发热请按急症就医处理。</p>`,
  `<button class="primary" id="fever-ack">我知道了——立即按铃/联系医护</button>`, '粒缺发热 · 急症提示（不可忽略）');
  $('#fever-ack').addEventListener('click', () => { closeModal(); toast('已记录到发热轨道（演示，仅内存）'); render(); });
}
/* 注意：体温入列由调用方统一负责（mem().temps.push）。这里不再 push——
   否则同一次体温会进轨道两遍，体温曲线出现重复点、作者计数翻倍。 */
function afterAdd(msg) { toast(msg || '已记录（演示，仅内存）'); render(); }

/* ---------------- 导出（三出口之一：sharedOnly） ---------------- */
function buildExport(full) {
  const p = profile();
  const all = allViewpoints();
  const list = full ? all : sharedOnly(all);
  const L = [];
  L.push(`# ${p.name} · 病程${full ? '全量（自存）' : '摘要（给医生）'}`);
  L.push(`生成：${TODAY} · ${APP_INFO.brand} ${APP_INFO.displayVersion}（演示数据）`);
  L.push(`诊断：${p.diagnosis}；${p.stageLine}`);
  L.push(`\n## 疗程\n${p.tx.cycles.map((c) => `- ${c.kind}：${c.start} → ${c.end} · ${c.status} · ${c.result}`).join('\n')}`);
  L.push(`\n## 最近血象\n${Object.entries(p.metrics.numeric).map(([code, arr]) => { const m = CATALOG[code]; const x = arr[arr.length - 1]; return `- ${m.name}：${fmtNum(x.v, m.dec)} ${m.unit}（${x.d}）`; }).join('\n')}`);
  L.push(`\n## MRD（双口径）\n- 流式：${p.mrd.flow.map((x) => `${x.d} ${x.label}`).join(' → ') || '无'}\n- PCR：${p.mrd.pcr.map((x) => `${x.d} ${x.label}`).join(' → ') || '无记录'}（不同方法不可换算）`);
  L.push(`\n## 输注（成分分列）\n${p.neu.transfusions.map((t) => `- ${t.d} ${t.comp} ${t.units}（反应：${t.reaction}）`).join('\n')}`);
  L.push(`\n## 移植评估\n- 状态：${p.tp.status}；供者：${p.tp.donor.type}（${p.tp.donor.hla}）`);
  if (list.length) {
    L.push(`\n## 心理与家庭（${full ? '含私密' : '私密已过滤 ' + privateCount(all) + ' 条'}）`);
    list.forEach((v) => L.push(`- ${v.d} [${ROLE_LABEL[v.author] || v.author}] ${v.text}`));
  }
  if (!full && privateCount(all)) L.push(`\n（私密 ${privateCount(all)} 条默认不进摘要；逐项授权后才会进入。）`);
  return L.join('\n');
}
function showExport(full) {
  const md = buildExport(full);
  openModal(full ? '自存全量（含私密 · 演示）' : '给医生的病程摘要（private 已过滤）',
    `<textarea style="width:100%;min-height:300px;font:12.5px/1.6 ui-monospace,monospace;border:1px solid var(--line2);border-radius:10px;padding:10px" readonly>${esc(md)}</textarea>`,
    `<button class="primary" data-action="close">关闭</button>`, '两区导出 · 三出口之一');
}

/* ---------------- 34 号 AI 一键发送（aml:agent-draft + send:true） ---------------- */
const EMBEDDED = () => window.parent && window.parent !== window;
function sendAgentDraft(prompt) {
  state.agent.prompt = prompt;
  if (EMBEDDED()) {
    /* 34 号契约第 2 段：嵌入式形态 → 壳层直接发送（双守卫在壳层 lib 侧：phase==='plain' 才 submit） */
    try {
      window.parent.postMessage({ type: 'aml:agent-draft', prompt, send: true }, location.origin === 'null' ? '*' : location.origin);
      toast('已发送到 AI 对话，可继续互动（回复是候选，核对才采纳）');
    } catch { toast('发送失败：草稿已保留在演示面板'); }
  } else {
    if (!state.agent.open) setAgent(true);
    const input = $('.agent-foot input');
    toast('演示面板：原型独立打开不假装发送——嵌入式（壳层 iframe）形态会经 aml:agent-draft · send:true 直接发送到 AI 对话');
    if (input) input.placeholder = prompt.slice(0, 40) + '…（演示：未接入）';
  }
}

/* ---------------- AI 面板 ---------------- */
/* 34 号契约 2b「面板唯一性」：嵌入式形态下原生会话才是唯一 AI 面板，
   业务页自有的这个演示面板必须整体隐藏——否则装机后右侧会出现
   「AI 对话 · 演示」与原生会话两个面板并存（肢端肥大症 0.2.0–0.2.3 真机实漏）。
   门控放在这里而不是只在 toggle 动作里 no-op：任何路径（初始渲染/快捷键/状态恢复）
   打开面板都会被同一个早退挡住。 */
function setAgent(open) {
  state.agent.open = open;
  const pane = $('#agent-pane'), spl = $('#agent-splitter'), toggle = $('#agent-toggle');
  if (!pane) return;
  if (EMBEDDED()) {
    pane.hidden = true; spl.hidden = true;
    if (toggle) toggle.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
    return;
  }
  pane.hidden = !open; spl.hidden = !open;
  toggle?.removeAttribute('hidden');
  toggle.setAttribute('aria-expanded', String(open));
}

/* ---------------- 渲染框架 ---------------- */
const ROUTES = {
  dash: pageDash,
  'dx': pageDxWk, 'dx/dx-wk': pageDxWk, 'dx/dx-gene': pageDxGene, 'dx/dx-mdt': pageDxMdt,
  'tx': pageTxCal, 'tx/tx-cal': pageTxCal, 'tx/tx-path': pageTxPath, 'tx/tx-cons': pageTxCons, 'tx/tx-pend': pageTxPend,
  'neu': pageNeuFever, 'neu/neu-fever': pageNeuFever, 'neu/neu-cbc': pageNeuCbc, 'neu/neu-tx': pageNeuTx, 'neu/neu-oral': pageNeuOral, 'neu/neu-inf': pageNeuInf,
  'mrd': pageMrdTrend, 'mrd/mrd-trend': pageMrdTrend, 'mrd/mrd-bm': pageMrdBm, 'mrd/mrd-rhythm': pageMrdRhythm,
  'tp': pageTpEval, 'tp/tp-eval': pageTpEval, 'tp/tp-donor': pageTpDonor, 'tp/tp-day': pageTpDay,
  chart: pageChart,
  'care': pageCareIntake, 'care/care-intake': pageCareIntake, 'care/care-safe': pageCareSafe,
  'mind': pageMindFeel, 'mind/mind-feel': pageMindFeel, 'mind/mind-death': pageMindDeath, 'mind/mind-burden': pageMindBurden,
  'docs': pageDocsLib, 'docs/docs-lib': pageDocsLib, 'docs/docs-cand': pageDocsCand, 'docs/docs-prep': pageDocsPrep, 'docs/docs-trial': pageDocsTrial
};
function render() {
  const main = $('#main');
  const route = SUBPAGES[state.page] ? `${state.page}/${state.sub[state.page] || SUBPAGES[state.page][0][0]}` : state.page;
  const fn = ROUTES[route] || pageDash;
  const label = (() => { const pg = PAGES.find((x) => x[0] === state.page); const sub = (SUBPAGES[state.page] || []).find((x) => x[0] === state.sub[state.page]); return sub ? `${pg[1]} · ${sub[1]}` : pg ? pg[1] : '看板'; })();
  $('#breadcrumb').textContent = label;
  main.innerHTML = fn();
  main.setAttribute('data-route', route);
  const nav = $('#nav');
  nav.innerHTML = PAGES.map(([id, label2, ic]) => {
    const subs = SUBPAGES[id];
    const cur = state.page === id;
    return `<button class="nav-button" aria-current="${cur ? 'page' : 'false'}" data-action="go" data-page="${id}" aria-expanded="${cur && subs ? 'true' : 'false'}">${icon(ic)}<span>${label2}</span></button>${cur && subs ? `<div class="nav-subs">${subs.map(([sid, slab]) => `<button class="sub-button" aria-current="${state.sub[id] === sid ? 'true' : 'false'}" data-action="go" data-page="${id}" data-sub="${sid}">${slab}</button>`).join('')}</div>` : ''}`;
  }).join('');
  const p = profile();
  $('#profile-name').textContent = `${p.name.replace('（演示）', '')}的资料`;
  $('#profile-avatar').textContent = p.name[0];
  $('#profile-meta').textContent = `${p.age} 岁 · ${p.diagnosisShort}`;
  $('#profile-btn').setAttribute('aria-label', `切换演示档案，当前为${p.name.replace('（演示）', '')}`);
}
function navigate(page, sub) {
  if (!PAGES.some((x) => x[0] === page)) page = 'dash';
  state.page = page;
  const subs = SUBPAGES[page];
  if (subs) { const ok = sub && subs.some((x) => x[0] === sub); state.sub[page] = ok ? sub : subs[0][0]; }
  else state.sub[page] = '';
  const hash = subs && state.sub[page] ? `#${page}/${state.sub[page]}` : `#${page}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
  render();
  $('#main').scrollTop = 0;
}
function applyHash() {
  const raw = (location.hash || '#dash').slice(1);
  const [page, sub] = raw.split('/');
  if (!PAGES.some((x) => x[0] === page)) { state.page = 'dash'; state.sub = {}; return; }
  state.page = page;
  state.sub[page] = sub || (SUBPAGES[page] ? SUBPAGES[page][0][0] : '');
}

/* ---------------- 事件 ---------------- */
document.addEventListener('click', (e) => {
  /* 34 号：AI 协助协议链接（aml:agent-draft）——嵌入式直接发送（send:true）；独立打开走演示面板 */
  const link = e.target.closest('a[href^="aml:agent-draft"]');
  if (link) {
    e.preventDefault();
    try { const u = new URL(link.getAttribute('href')); sendAgentDraft(u.searchParams.get('prompt') || ''); }
    catch { toast('协议链接解析失败（演示）'); }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'go') { navigate(el.dataset.page, el.dataset.sub); return; }
  if (a === 'range') { state.range = el.dataset.range; render(); return; }
  if (a === 'pin') { const c = el.dataset.code, d = el.dataset.date; state.pin = (state.pin && state.pin.code === c && state.pin.date === d) ? null : { code: c, date: d }; render(); return; }
  if (a === 'treat-toggle') { state.toggles.treatment = el.checked; render(); return; }
  if (a === 'agent-toggle') { setAgent(!state.agent.open); return; }
  if (a === 'agent-hide') { setAgent(false); toast('已收起面板（会话保留，草稿不丢）'); return; }
  if (a === 'primer') { openPrimer(); return; }
  if (a === 'close') { closeModal(); return; }
  if (a === 'open-store') { toast('资料目录已激活（演示）'); return; }
  if (a === 'settings') { openModal('设置（演示）', '<p style="font-size:13.5px">原型不接真实设置；工作区目录 / 文档解析 / 临床数据包在正式版提供。</p><p class="small-note">演示数据来自 demo/build-demo-data.mjs（唯一源）。</p>'); return; }
  if (a === 'about') { openModal('关于小橙宝', `<p style="font-size:13.5px">${APP_INFO.brand} ${APP_INFO.displayVersion} · build ${APP_INFO.build}<br>${esc(APP_INFO.channelLabel)}</p><p class="small-note">演示数据（合成）：人物、数值与时间线不指向任何真实患者。</p>`); return; }
  if (a === 'help') { openModal('原型操作说明', '<p style="font-size:13.5px">· 左侧切换 10 条一级线；二级页签在导航下方展开。<br>· 顶部「?」打开疾病概要（36 号）。<br>· 「AI 协助 ↗」为 aml:agent-draft 协议链接（34 号）：嵌入式形态直接发送开启互动；独立打开时走演示面板。<br>· 所有数据为合成演示；刷新重置。</p>'); return; }
  if (a === 'profiles') { openProfiles(); return; }
  if (a === 'pick-profile') { state.profileId = el.dataset.id; state.pin = null; closeModal(); render(); toast(`已切换到 ${profile().name}（演示）`); return; }
  if (a === 'sel') {
    const c = el.dataset.code; const arr = state.sel[state.profileId];
    if (el.checked) { if (arr.length >= 4) { el.checked = false; toast('最多同时看 4 个指标；先取消一个再加。'); return; } arr.push(c); }
    else { if (arr.length === 1) { el.checked = true; toast('至少留一个指标。'); return; } state.sel[state.profileId] = arr.filter((x) => x !== c); }
    render(); return;
  }
  if (a === 'q-asked') { const q = questions().find((x) => x.id === el.dataset.id); if (q) { q.asked = el.checked; toast(q.asked ? '已标记"已问"' : '恢复为待问'); } return; }
  if (a === 'vis-toggle') {
    const { kind, d, author } = el.dataset;
    const pool = kind === 'deaths' ? deathsAll() : kind === 'feels' ? feelsAll() : [...(profile().mind.burden || []), ...mem().burdens];
    const item = pool.find((x) => x.d === d && x.author === author);
    if (item) { item.visibility = item.visibility === 'private' ? 'shared' : 'private'; toast(item.visibility === 'private' ? '已改为私密（默认三出口过滤）' : '已改为共享（逐项授权）'); render(); }
    return;
  }
  /* 候选核对闭环（X4）：确认入事实层 / 改一下 / 拒收零副作用 */
  if (a === 'cand-ok') { toast('演示：核对通过后进入事实层（原型仅示意，不写库）', { long: true }); return; }
  if (a === 'cand-fix') { toast('演示：进入逐项修改（每项都可以改）'); return; }
  if (a === 'cand-reject') { toast('已拒收这条候选（无副作用）'); return; }
  if (a === 'export-shared') { showExport(false); return; }
  if (a === 'export-full') { showExport(true); return; }
  /* 表单类（每页显式编辑入口 ≤1；每表单 ≤6 字段） */
  if (a === 'temp-add') {
    openForm('连录一次体温（双源）', [
      { key: 'ts', label: '时间（YYYY-MM-DD HH:mm）', ph: `${TODAY} 08:10`, required: true },
      { key: 'v', label: '体温（℃）', ph: '38.3', required: true },
      { key: 'site', label: '部位', type: 'select', options: ['腋', '口', '耳'] },
      { key: 'author', label: '记录人（author_role）', type: 'select', options: ['patient', 'caregiver'] }
    ], (v) => {
      const ts = v.ts.replace(' ', 'T').slice(0, 16); const val = Number(v.v);
      const prior = mem().temps.slice();
      mem().temps.push({ ts, v: val, author: v.author });
      const verdict = classifyTemp(ts, val, prior);
      if (verdict.level === 'fever') feverFlag(ts, val, v.author, verdict.why);
      else if (verdict.level === 'watch') { toast(`${verdict.why}（已记录，观察中）`, { long: true }); render(); }
      else { toast(`已记录：${verdict.why}`, { long: true }); render(); }
    }, '体温连录 · author_role 贯穿');
    return;
  }
  if (a === 'txf-add') {
    openForm('登记一次输注', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'comp', label: '成分', type: 'select', options: ['红细胞', '血小板', '血浆'] },
      { key: 'units', label: '量（如 2u / 1 治疗量）', required: true },
      { key: 'reaction', label: '反应', type: 'select', options: ['无', '发热', '过敏', '其他（备注）'] }
    ], (v) => { mem().txf.push({ ...v, pre: '', attr: '辐照去白' }); afterAdd('已登记（演示，仅内存）'); });
    return;
  }
  if (a === 'oral-add') {
    openForm('记录一次黏膜炎', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'grade', label: 'WHO 分级', type: 'select', options: ['0 无', 'I 级（红斑/疼痛）', 'II 级（红斑+溃疡，能进固体）', 'III 级（仅流食）', 'IV 级（无法进食）'] },
      { key: 'eat', label: '进食能力', type: 'select', options: ['正常', '固体受限', '仅流食', '不能进食'] },
      { key: 'measure', label: '措施（医嘱原文）' }
    ], (v) => { mem().oral.push(v); afterAdd('已记录（不荐护理方案）'); });
    return;
  }
  if (a === 'meal-add') {
    openForm('记一次食量', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'text', label: '吃了什么（份量照记）', required: true },
      { key: 'author', label: '记录人', type: 'select', options: ['patient', 'caregiver'] }
    ], (v) => { mem().meals.push(v); afterAdd('已记录（不给食谱）'); });
    return;
  }
  if (a === 'io-add') {
    openForm('记一次出入量', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'in', label: '入量（mL）', required: true },
      { key: 'out', label: '出量（mL）', required: true },
      { key: 'note', label: '备注' }
    ], (v) => { mem().io.push(v); afterAdd('已记录（防脱水提醒看护士答复原文）'); });
    return;
  }
  if (a === 'feel-add') {
    openForm('记一条感受（默认 shared）', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'text', label: '想记的话', required: true },
      { key: 'author', label: '记录人', type: 'select', options: ['patient', 'caregiver'] }
    ], (v) => { mem().feels.push({ ...v, role: ROLE_LABEL[v.author], visibility: 'shared' }); afterAdd('已记录（双主体并列，不平均）'); });
    return;
  }
  if (a === 'death-add') {
    openForm('记一条（默认 private）', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'text', label: '想记的话', required: true },
      { key: 'author', label: '记录人', type: 'select', options: ['patient', 'caregiver'] }
    ], (v) => { mem().deaths.push({ ...v, role: ROLE_LABEL[v.author], visibility: 'private' }); afterAdd('已记录 · 默认私密（三出口过滤）'); });
    return;
  }
  if (a === 'burden-add') {
    openForm('记一条照护记录', [
      { key: 'd', label: '日期', ph: TODAY, required: true },
      { key: 'text', label: '照护者的话', required: true },
      { key: 'author', label: '记录人', type: 'select', options: ['patient', 'caregiver'] }
    ], (v) => { mem().burdens.push({ ...v, role: ROLE_LABEL[v.author], visibility: 'shared' }); afterAdd('已记录'); });
    return;
  }
  if (a === 'bm-add') {
    openForm('登记骨穿采样', [
      { key: 'd', label: '采样日期', ph: TODAY, required: true },
      { key: 'site', label: '部位', type: 'select', options: ['髂后上棘（左）', '髂后上棘（右）', '胸骨'] },
      { key: 'blast', label: '原始细胞（原文）' },
      { key: 'result', label: '结论（医生原文）' }
    ], (v) => { added('bm').push(v); afterAdd('已登记（判读归医生）'); });
    return;
  }
  if (a === 'doc-add') {
    openForm('加入解析队列', [
      { key: 'name', label: '文件名', required: true },
      { key: 'kind', label: '类型', type: 'select', options: ['PDF', '图片'] }
    ], (v) => {
      mem().docs.push({ name: v.name, kind: v.kind, status: '待核对' });
      profile().docs.candidates.push({ id: uid('cand'), title: `${v.name} 抄单候选（演示候选）`, fields: [['文件', v.name], ['状态', '待核对（原文抄录）']], src: 'docs-lib 演示' });
      closeModal(); render(); toast('已加入解析队列：到「整理草稿与核对」看候选', { back: true });
    });
    return;
  }
  if (a === 'q-add') {
    openForm('加一条要问的', [{ key: 'text', label: '问题', required: true }], (v) => {
      questions().push({ id: uid('q'), text: v.text, asked: false, src: `${TODAY} 就诊准备生成` });
      closeModal(); render(); toast('已加入疑问清单', { back: true });
    });
    return;
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'sel' || a === 'treat-toggle' || a === 'q-asked') {
    const ev = new Event('click', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: el, writable: false });
    el.dispatchEvent(ev);
  }
});

function openProfiles() {
  const rows = DATA.profiles.map((p) => `<button class="prof-item" data-action="pick-profile" data-id="${p.id}" aria-pressed="${p.id === state.profileId}">
    <div class="avatar" aria-hidden="true">${p.name[0]}</div>
    <div style="min-width:0"><b>${esc(p.name)} · ${p.age}岁${p.gender}</b><span>${esc(p.diagnosisShort)} · ${esc(p.stageLine)}</span><span>照护者：${esc(p.caregiver || '—')}</span></div>
  </button>`).join('');
  openModal('切换演示档案', `<div class="prof-list">${rows}</div><p class="small-note" style="margin-top:8px">两档案均为合成演示数据；切换后各页数据独立。</p>`);
}

/* ---------------- 分隔条拖动 / 键盘 ---------------- */
(() => {
  const spl = $('#agent-splitter'), pane = $('#agent-pane');
  if (!spl) return;
  let dragging = false;
  spl.addEventListener('pointerdown', (e) => { dragging = true; spl.setPointerCapture(e.pointerId); });
  spl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const stage = spl.parentElement.getBoundingClientRect();
    const pct = Math.min(45, Math.max(25, ((stage.right - e.clientX) / stage.width) * 100));
    pane.style.width = pct + '%'; spl.setAttribute('aria-valuenow', String(Math.round(pct)));
  });
  spl.addEventListener('pointerup', () => { dragging = false; });
  spl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = parseInt(spl.getAttribute('aria-valuenow') || '35', 10);
    const next = Math.min(45, Math.max(25, cur + (e.key === 'ArrowRight' ? 2 : -2)));
    pane.style.width = next + '%'; spl.setAttribute('aria-valuenow', String(next));
  });
})();
$('#dialog').addEventListener('click', (e) => { if (e.target === $('#dialog')) closeModal(); });

/* ---------------- 打印展开（32 号：beforeprint，Chrome printToPDF 实测修正） ---------------- */
(function printExpandFoldouts() {
  let prior = null;
  window.addEventListener('beforeprint', () => {
    const folds = [...document.querySelectorAll('details.phase-fold')];
    prior = folds.map((d) => d.open);
    folds.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!prior) return;
    document.querySelectorAll('details.phase-fold').forEach((d, i) => { d.open = Boolean(prior[i]); });
    prior = null;
  });
})();

window.addEventListener('hashchange', () => { applyHash(); render(); });
window.addEventListener('popstate', () => { applyHash(); render(); });

/* ---------------- boot ---------------- */
applyHash();
render();
/* 34 号 2b：嵌入式启动即隐藏自有演示面板（不等用户点 toggle） */
if (EMBEDDED()) setAgent(false);
document.body.setAttribute('data-booted', '1');
