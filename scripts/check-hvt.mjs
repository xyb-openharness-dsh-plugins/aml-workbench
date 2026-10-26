#!/usr/bin/env node
/**
 * HVT 交互路径一致性 X1–X4（15-HVT-REVIEW §X；基准=docs/INTERACTION-DESIGN.md v1）。
 *
 * X1 页面覆盖：SCENES（13 场景路径 = 看板入口 + 落地页 + 步骤表）∪ 页面上真实存在的 data-step
 *   锚点的并集必须盖满 10 线 27 页签（孤儿=0）。dash/chart 由场景与步骤覆盖。
 * X2 路径逐字走通：从看板逐 key 点「场景直达」chip → 落地页（须有 data-product 锚）→
 *   逐个"查询→点击→再查询"页内 data-step → 每站必须有 data-product 锚 →
 *   点「回到看板」一步回首页。两档案各走一遍（13 × 2 = 26）。
 * X3 编辑入口 ≤1：每 (view,sub) 打开表单/弹窗的显式编辑入口 ≤1（FORM_ACTIONS）。
 * X4 AI 产出候选闭环：ai-draft → 候选卡 → 确认入事实层 / 不对改一下 / 不用这条 三步；
 *   且每条一级线至少 1 个 AI 协助协议链接（aml:agent-draft，34 号）。
 *
 * 用法：node scripts/check-hvt.mjs；退出码 0/1。依赖本机 Chrome。
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, stopChrome, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = Number(process.env.AML_HVT_CDP_PORT || 9364);
const URL_APP = `file://${join(ROOT, 'prototypes', 'v0.2', 'index.html')}`;

/* 与 app.js SCENES 同源的静态表（检查器单持一份，避免读页面内变量做判定）。
   步骤表=INTERACTION-DESIGN §一 的"关键步骤"列；X2 只点 DOM 里真实存在的 data-step。 */
const SCENES = [
  ['S01', 'tx', 'tx-cal', ['to-tx-path', 'to-neu-fever2']],
  ['S02', 'neu', 'neu-fever', ['to-neu-inf', 'to-neu-cbc']],
  ['S03', 'mrd', 'mrd-trend', ['to-mrd-bm', 'to-chart2']],
  ['S04', 'tp', 'tp-eval', ['to-tp-donor', 'to-tp-day']],
  ['S05', 'neu', 'neu-tx', ['to-neu-cbc2']],
  ['S06', 'docs', 'docs-prep', ['to-docs-trial']],
  ['S07', 'neu', 'neu-oral', ['to-care-safe']],
  ['S08', 'neu', 'neu-fever', ['to-mind-burden2']],
  ['S09', 'mrd', 'mrd-rhythm', ['to-chart3']],
  ['S10', 'care', 'care-intake', ['to-care-safe2']],
  ['S11', 'mind', 'mind-death', ['to-mind-feel']],
  ['S12', 'docs', 'docs-trial', ['to-docs-prep2']],
  ['S13', 'docs', 'docs-lib', ['to-docs-cand']]
];
/* data-step → (page,sub) 落点（与 app.js 的 go() 目标一一对应；带序号后缀=同页多入口去重） */
const STEP_TARGET = {
  'to-dx-wk': ['dx', 'dx-wk'], 'to-tx-pend': ['tx', 'tx-pend'], 'to-neu-fever': ['neu', 'neu-fever'],
  'to-neu-fever2': ['neu', 'neu-fever'], 'to-neu-fever3': ['neu', 'neu-fever'], 'to-neu-fever4': ['neu', 'neu-fever'],
  'to-neu-inf': ['neu', 'neu-inf'], 'to-neu-cbc': ['neu', 'neu-cbc'], 'to-neu-cbc2': ['neu', 'neu-cbc'],
  'to-neu-cbc3': ['neu', 'neu-cbc'], 'to-neu-tx': ['neu', 'neu-tx'], 'to-neu-oral': ['neu', 'neu-oral'],
  'to-mrd-bm': ['mrd', 'mrd-bm'], 'to-mrd-trend': ['mrd', 'mrd-trend'], 'to-mrd-rhythm': ['mrd', 'mrd-rhythm'],
  'to-chart': ['chart', ''], 'to-chart2': ['chart', ''], 'to-chart3': ['chart', ''],
  'to-tp-donor': ['tp', 'tp-donor'], 'to-tp-day': ['tp', 'tp-day'], 'to-tp-eval': ['tp', 'tp-eval'],
  'to-tp-eval2': ['tp', 'tp-eval'],
  'to-docs-lib': ['docs', 'docs-lib'], 'to-docs-lib2': ['docs', 'docs-lib'], 'to-docs-cand': ['docs', 'docs-cand'],
  'to-docs-prep': ['docs', 'docs-prep'], 'to-docs-prep2': ['docs', 'docs-prep'], 'to-docs-trial': ['docs', 'docs-trial'],
  'to-care-safe': ['care', 'care-safe'], 'to-care-safe2': ['care', 'care-safe'], 'to-care-intake': ['care', 'care-intake'],
  'to-mind-burden': ['mind', 'mind-burden'], 'to-mind-burden2': ['mind', 'mind-burden'],
  'to-mind-feel': ['mind', 'mind-feel'], 'to-mind-death': ['mind', 'mind-death'],
  'to-dx-gene': ['dx', 'dx-gene'], 'to-dx-gene2': ['dx', 'dx-gene'], 'to-dx-mdt': ['dx', 'dx-mdt'],
  'to-tx-cal': ['tx', 'tx-cal'], 'to-tx-cal2': ['tx', 'tx-cal'], 'to-tx-path': ['tx', 'tx-path'],
  'to-tx-path2': ['tx', 'tx-path'], 'to-tx-cons': ['tx', 'tx-cons']
};
const ALL_SUBS = [
  ['dx', 'dx-wk'], ['dx', 'dx-gene'], ['dx', 'dx-mdt'],
  ['tx', 'tx-cal'], ['tx', 'tx-path'], ['tx', 'tx-cons'], ['tx', 'tx-pend'],
  ['neu', 'neu-fever'], ['neu', 'neu-cbc'], ['neu', 'neu-tx'], ['neu', 'neu-oral'], ['neu', 'neu-inf'],
  ['mrd', 'mrd-trend'], ['mrd', 'mrd-bm'], ['mrd', 'mrd-rhythm'],
  ['tp', 'tp-eval'], ['tp', 'tp-donor'], ['tp', 'tp-day'],
  ['care', 'care-intake'], ['care', 'care-safe'],
  ['mind', 'mind-feel'], ['mind', 'mind-death'], ['mind', 'mind-burden'],
  ['docs', 'docs-lib'], ['docs', 'docs-cand'], ['docs', 'docs-prep'], ['docs', 'docs-trial']
];
/* 表单动作（X3：每 (view,sub) 打开表单/弹窗的显式编辑入口 ≤1；每表单 ≤6 字段） */
const FORM_ACTIONS = ['temp-add', 'txf-add', 'oral-add', 'meal-add', 'io-add', 'feel-add', 'death-add', 'burden-add', 'bm-add', 'doc-add', 'q-add'];
const FORM_PAGE = {
  'temp-add': ['neu', 'neu-fever'], 'txf-add': ['neu', 'neu-tx'], 'oral-add': ['neu', 'neu-oral'],
  'meal-add': ['care', 'care-intake'], 'io-add': ['care', 'care-safe'], 'feel-add': ['mind', 'mind-feel'],
  'death-add': ['mind', 'mind-death'], 'burden-add': ['mind', 'mind-burden'], 'bm-add': ['mrd', 'mrd-bm'],
  'doc-add': ['docs', 'docs-lib'], 'q-add': ['docs', 'docs-prep']
};

const out = { X1: {}, X2: { failures: [], walked: 0 }, X3: { over: [], max: 0, perPage: {} }, X4: {} };
const ch = await launchChrome({ port: CDP_PORT });
const { cdp } = ch;

async function navigate(page, sub) {
  await cdp.eval(`location.hash = '#${page}${sub ? '/' + sub : ''}'; window.dispatchEvent(new Event('hashchange'));`);
  await sleep(140);
}
const currentRoute = () => cdp.eval("document.getElementById('main').getAttribute('data-route')");

try {
  await cdp.send('Page.navigate', { url: URL_APP });
  await sleep(400);
  for (let i = 0; i < 40 && !(await cdp.eval("document.body && document.body.getAttribute('data-booted') === '1'")); i += 1) await sleep(120);
  if (cdp.errors.length) throw new Error('boot errors: ' + cdp.errors.join(' | '));

  /* ── X1：路径并集 vs 10 线 27 页签（逐页收集真实存在的 data-step 锚点；dash 为路径枢纽不计） ── */
  const covered = new Set();
  SCENES.forEach(([sid, lp, ls, steps]) => {
    covered.add(ls ? `${lp}/${ls}` : lp);
    steps.forEach((s) => { const t = STEP_TARGET[s]; if (t) covered.add(t[1] ? `${t[0]}/${t[1]}` : t[0]); });
  });
  const anchorByRoute = {};
  for (const [p, s] of [...ALL_SUBS, ['chart', '']]) {
    await navigate(p, s);
    const stepsHere = await cdp.eval(`Array.from(document.querySelectorAll('#main [data-step]')).map((e) => e.dataset.step)`);
    anchorByRoute[`${p}${s ? '/' + s : ''}`] = stepsHere;
    stepsHere.forEach((st) => { const t = STEP_TARGET[st]; if (t) covered.add(t[1] ? `${t[0]}/${t[1]}` : t[0]); });
  }
  const allRoutes = [...ALL_SUBS.map(([p, s]) => `${p}/${s}`), 'dash', 'chart'];
  const orphans = allRoutes.filter((r) => r !== 'dash' && !covered.has(r)); /* dash 为路径枢纽不占页签名（家族惯例） */
  out.X1 = { total: allRoutes.length, covered: covered.size, orphans, anchors: anchorByRoute, ok: orphans.length === 0 };

  /* ── X2：13 场景 × 2 档案 逐字走通 ── */
  for (const prof of ['demo1', 'demo2']) {
    await navigate('dash', '');
    await cdp.eval(`document.querySelector('[data-action="pick-profile"][data-id="${prof}"]') ? (document.body.dataset.forced='1') : 0`);
    /* 切档案（走真实 UI：看板头像 → 弹窗 → pick-profile） */
    await cdp.eval(`document.querySelector('[data-action="profiles"]').click()`);
    await sleep(150);
    await cdp.eval(`document.querySelector('[data-action="pick-profile"][data-id="${prof}"]').click()`);
    await sleep(200);
    for (const [sid, landingPage, landingSub, steps] of SCENES) {
      await navigate('dash', '');
      const chip = await cdp.eval(`(() => { const el = document.querySelector('[data-scene="${sid}"]'); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
      await sleep(150);
      if (chip !== 'ok') { out.X2.failures.push(`${prof}/${sid}: 看板无场景 chip`); continue; }
      const land = await currentRoute();
      if (land !== `${landingPage}/${landingSub}`) { out.X2.failures.push(`${prof}/${sid}: 落地页 ${land} ≠ ${landingPage}/${landingSub}`); continue; }
      const product = await cdp.eval(`document.querySelector('#main [data-product]') ? 1 : 0`);
      if (!product) { out.X2.failures.push(`${prof}/${sid}: 落地页无 data-product 锚`); continue; }
      for (const step of steps) {
        await navigate(landingPage, landingSub);
        const clicked = await cdp.eval(`(() => { const el = document.querySelector('[data-step="${step}"]'); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
        await sleep(140);
        if (clicked !== 'ok') { out.X2.failures.push(`${prof}/${sid}/${step}: 页内无 data-step 锚`); continue; }
        const at = await currentRoute();
        const want = STEP_TARGET[step];
        const wantRoute = want[1] ? `${want[0]}/${want[1]}` : want[0];
        if (at !== wantRoute) { out.X2.failures.push(`${prof}/${sid}/${step}: 到达 ${at} ≠ ${wantRoute}`); continue; }
        const prod2 = await cdp.eval(`document.querySelector('#main [data-product]') ? 1 : 0`);
        if (!prod2) { out.X2.failures.push(`${prof}/${sid}/${step}: 站点无 data-product 锚`); continue; }
        out.X2.walked += 1;
      }
      /* 回到看板一步 */
      await navigate(landingPage, landingSub);
      const back = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('#main [data-action="go"][data-page="dash"]'))[0]; if (!b) return 'missing'; b.click(); return 'ok'; })()`);
      await sleep(130);
      if (back !== 'ok' || (await currentRoute()) !== 'dash') out.X2.failures.push(`${prof}/${sid}: 无法一步回看板`);
    }
  }

  /* ── X3：每 (view,sub) 表单入口 ≤1 ── */
  const perPage = {};
  for (const [action, [p, s]] of Object.entries(FORM_PAGE)) { const k = `${p}/${s}`; perPage[k] = (perPage[k] || 0) + 1; }
  out.X3.perPage = perPage;
  out.X3.max = Math.max(...Object.values(perPage));
  out.X3.over = Object.entries(perPage).filter(([, n]) => n > 1).map(([k, n]) => `${k}:${n}`);
  /* 页面上每个表单动作按钮实际只出现一次（同一页重复入口也算违规） */
  for (const [p, s] of ALL_SUBS) {
    await navigate(p, s);
    const counts = await cdp.eval(`(() => { const m = {}; for (const a of ${JSON.stringify(FORM_ACTIONS)}) m[a] = document.querySelectorAll('#main [data-action="' + a + '"]').length; return JSON.stringify(m); })()`);
    const cm = JSON.parse(counts);
    for (const [a, n] of Object.entries(cm)) if (n > 1) out.X3.over.push(`${p}/${s} ${a}×${n}`);
  }

  /* ── X4：候选闭环 + 每条一级线 ≥1 个 AI 协助协议链接 ── */
  await navigate('docs', 'docs-cand');
  const candBtns = await cdp.eval(`(() => ({ ok: document.querySelectorAll('[data-action="cand-ok"]').length, fix: document.querySelectorAll('[data-action="cand-fix"]').length, rej: document.querySelectorAll('[data-action="cand-reject"]').length }))()`);
  out.X4.candLoop = candBtns.ok >= 1 && candBtns.fix >= 1 && candBtns.rej >= 1 ? 'ok' : `missing(${JSON.stringify(candBtns)})`;
  /* 逐页数 aml:agent-draft 链接（X4 拓展：10 条一级线覆盖） */
  const aiPages = {};
  for (const [p] of [['dash'], ['dx'], ['tx'], ['neu'], ['mrd'], ['tp'], ['chart'], ['care'], ['mind'], ['docs']]) {
    const subs = ALL_SUBS.filter(([pp]) => pp === p).map(([, s]) => s);
    await navigate(p, subs[0] || '');
    aiPages[p] = await cdp.eval(`document.querySelectorAll('#main a[href^="aml:agent-draft"]').length`);
  }
  out.X4.aiLinks = aiPages;
  out.X4.aiOk = Object.values(aiPages).every((n) => n >= 1);
} finally {
  await stopChrome(ch);
}

let ok = out.X1.ok && out.X2.failures.length === 0 && out.X3.over.length === 0 && out.X4.candLoop === 'ok' && out.X4.aiOk;
console.log(JSON.stringify({
  X1: { total: out.X1.total, covered: out.X1.covered, orphans: out.X1.orphans, ok: out.X1.ok },
  X2W: { walked: out.X2.walked, failures: out.X2.failures.slice(0, 10), failureCount: out.X2.failures.length },
  X3: { max: out.X3.max, over: out.X3.over.slice(0, 6), overCount: out.X3.over.length },
  X4: { candLoop: out.X4.candLoop, aiLinks: out.X4.aiLinks, aiOk: out.X4.aiOk },
  ok
}, null, 1));
process.exit(ok ? 0 : 1);
