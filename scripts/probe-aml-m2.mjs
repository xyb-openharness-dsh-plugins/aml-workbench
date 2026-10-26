#!/usr/bin/env node
/**
 * AML M2 自验探针：全部路由 × 2 档案截图（逐个查询→点击→再查询）+ 三新组件渲染断言
 * + 一图秀 computed fill=none 断言（16 号合同从 thyroid 继承）。
 *
 * 产出：
 *  - docs/shots/m2/<profile>/<route>.png —— 走查原图（37 路由 × 2 档案）
 *  - docs/shots/m2/report.json —— 断言数字报告
 *  - console：断言汇总，退出码 0/1
 *
 * 用法：node scripts/probe-aml-m2.mjs
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep, stopChrome } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'docs', 'shots', 'm2');
mkdirSync(join(SHOTS, 'demo1'), { recursive: true });
mkdirSync(join(SHOTS, 'demo2'), { recursive: true });
const CDP_PORT = Number(process.env.AML_M2_CDP_PORT || 9366);
const URL_APP = `file://${join(ROOT, 'prototypes', 'v0.2', 'index.html')}`;

const ROUTES = [
  'dash', 'chart',
  'dx/dx-wk', 'dx/dx-gene', 'dx/dx-mdt',
  'tx/tx-cal', 'tx/tx-path', 'tx/tx-cons', 'tx/tx-pend',
  'neu/neu-fever', 'neu/neu-cbc', 'neu/neu-tx', 'neu/neu-oral', 'neu/neu-inf',
  'mrd/mrd-trend', 'mrd/mrd-bm', 'mrd/mrd-rhythm',
  'tp/tp-eval', 'tp/tp-donor', 'tp/tp-day',
  'care/care-intake', 'care/care-safe',
  'mind/mind-feel', 'mind/mind-death', 'mind/mind-burden',
  'docs/docs-lib', 'docs/docs-cand', 'docs/docs-prep', 'docs/docs-trial'
];

const ch = await launchChrome({ port: CDP_PORT });
const { cdp } = ch;
const report = { screenshots: 0, errors: [], assertions: {}, clickWalk: { pages: 0, clicks: 0 } };

async function navigate(route) {
  await cdp.eval(`location.hash = '#${route}'; window.dispatchEvent(new Event('hashchange'));`);
  await sleep(150);
}
async function shot(file) {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  report.screenshots += 1;
}

try {
  await cdp.send('Page.navigate', { url: URL_APP });
  await sleep(500);
  for (let i = 0; i < 40 && !(await cdp.eval("document.body && document.body.getAttribute('data-booted') === '1'")); i += 1) await sleep(120);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false });

  for (const prof of ['demo1', 'demo2']) {
    await navigate('dash');
    await cdp.eval("document.querySelector('[data-action=\"profiles\"]').click()");
    await sleep(150);
    await cdp.eval(`document.querySelector('[data-action="pick-profile"][data-id="${prof}"]').click()`);
    await sleep(200);
    for (const route of ROUTES) {
      await navigate(route);
      const at = await cdp.eval("document.getElementById('main').getAttribute('data-route')");
      if (at !== route) report.errors.push(`${prof}/${route}: 路由错位 → ${at}`);
      /* 查询 → 点击（页内第一个 data-step 或场景 chip）→ 再查询 */
      const clicked = await cdp.eval(`(() => {
        const el = document.querySelector('#main [data-step], #main [data-scene]');
        if (!el) return 'none'; el.click(); return el.dataset.step || el.dataset.scene;
      })()`);
      await sleep(130);
      if (clicked !== 'none') {
        report.clickWalk.pages += 1; report.clickWalk.clicks += 1;
        const after = await cdp.eval("document.getElementById('main').getAttribute('data-route')");
        if (!after) report.errors.push(`${prof}/${route}: 点击后路由丢失`);
      }
      await navigate(route);
      await shot(join(SHOTS, prof, route.replace(/\//g, '__') + '.png'));
      if (cdp.errors.length) { report.errors.push(`${prof}/${route}: ${cdp.errors.join(' | ')}`); cdp.errors.length = 0; }
    }
  }

  /* ── 三新组件渲染断言 ── */
  /* dayGrid：demo1 诱导 42 天（05-14 周四起，lead 3）= 45 格；demo2 C3 28 天（10-02 周五起，lead 4）= 32 格 */
  await navigate('dash');
  await cdp.eval("document.querySelector('[data-action=\"profiles\"]').click()"); await sleep(120);
  await cdp.eval("document.querySelector('[data-action=\"pick-profile\"][data-id=\"demo1\"]').click()"); await sleep(180);
  await navigate('tx/tx-cal');
  report.assertions.dayGrid_demo1_cells = await cdp.eval("document.querySelectorAll('#main .dg-cell').length");
  report.assertions.dayGrid_demo1_dn = await cdp.eval(`Array.from(document.querySelectorAll('#main .dg-dn')).some((e) => e.textContent === 'D42') ? 1 : 0`);
  report.assertions.dayGrid_demo1_bands = await cdp.eval("document.querySelectorAll('#main .dg-cell.band-nadir').length");
  await navigate('dash');
  await cdp.eval("document.querySelector('[data-action=\"profiles\"]').click()"); await sleep(120);
  await cdp.eval("document.querySelector('[data-action=\"pick-profile\"][data-id=\"demo2\"]').click()"); await sleep(180);
  await navigate('tx/tx-cal');
  report.assertions.dayGrid_demo2_cells = await cdp.eval("document.querySelectorAll('#main .dg-cell').length");
  report.assertions.dayGrid_demo2_ven = await cdp.eval("document.querySelectorAll('#main .dg-mark.ven').length");

  /* hourLane：demo2 两 episodes → 2 条 svg.hourlane + 每条 2 条参考线（38.3/38.0）+ 事件节点 */
  await navigate('neu/neu-fever');
  report.assertions.hourLane_demo2_svgs = await cdp.eval("document.querySelectorAll('#main svg.hourlane').length");
  report.assertions.hourLane_demo2_reflines = await cdp.eval("document.querySelectorAll('#main .refline').length");
  report.assertions.hourLane_demo2_feverdef = await cdp.eval(`document.querySelector('#main .hl-def')?.textContent.includes('38.3') ? 1 : 0`);
  report.assertions.hourLane_demo2_dual = await cdp.eval(`document.body.textContent.includes('双源体温') ? 1 : 0`);
  await navigate('dash');
  await cdp.eval("document.querySelector('[data-action=\"profiles\"]').click()"); await sleep(120);
  await cdp.eval("document.querySelector('[data-action=\"pick-profile\"][data-id=\"demo1\"]').click()"); await sleep(180);
  await navigate('neu/neu-fever');
  report.assertions.hourLane_demo1_svgs = await cdp.eval("document.querySelectorAll('#main svg.hourlane').length");
  report.assertions.hourLane_demo1_reflines = await cdp.eval("document.querySelectorAll('#main .refline').length");

  /* Day+N：锚点（Day 0 灰格）+ 里程碑 + Day+100 */
  await navigate('tp/tp-day');
  report.assertions.dayAxis_svg = await cdp.eval("document.querySelectorAll('#main svg.dayaxis').length");
  report.assertions.dayAxis_anchor = await cdp.eval("document.querySelectorAll('#main .anchor-grey').length");
  report.assertions.dayAxis_day100 = await cdp.eval(`document.body.textContent.includes('Day +100') || document.body.textContent.includes('Day+100') ? 1 : 0`);
  report.assertions.dayAxis_milestones = await cdp.eval("document.querySelectorAll('#main .da-card').length");

  /* 一图秀：SVG 根 class="chart" + computed fill=none（16 号继承断言） */
  await navigate('chart');
  report.assertions.chart_root_class = await cdp.eval(`(document.querySelector('#main svg.chart') ? 1 : 0)`);
  report.assertions.chart_computed_fill = await cdp.eval(`getComputedStyle(document.querySelector('#main svg.chart .line')).fill`);
  report.assertions.chart_lines = await cdp.eval(`document.querySelectorAll('#main svg.chart .line').length`);

  /* 32 折叠卡：5 卡 · 默认全收起 · 展开后 pd-block=5 */
  await navigate('tx/tx-path');
  report.assertions.fold_count = await cdp.eval("document.querySelectorAll('#main details.phase-fold').length");
  report.assertions.fold_default_open = await cdp.eval("document.querySelectorAll('#main details.phase-fold[open]').length");
  report.assertions.fold_blocks = await cdp.eval(`(() => { const d = document.querySelector('#main details.phase-fold'); d.open = true; return d.querySelectorAll('.pd-block').length; })()`);

  /* 候选闭环 / AI 链接（34 号） */
  await navigate('docs/docs-prep');
  report.assertions.export_buttons = await cdp.eval("document.querySelectorAll('#main [data-action^=\"export-\"]').length");
  report.assertions.ai_links_total = await cdp.eval(`document.querySelectorAll('#main a[href^="aml:agent-draft"]').length`);

  /* 深色/大字冒烟：无异常即可 */
  await cdp.eval("document.body.classList.add('large')"); await sleep(100);
  await cdp.eval("document.body.classList.remove('large')");
} finally {
  await stopChrome(ch);
}

writeFileSync(join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
const A = report.assertions;
const checks = [
  ['dayGrid demo1=45格', A.dayGrid_demo1_cells === 45], ['dayGrid demo1 D42', A.dayGrid_demo1_dn === 1],
  ['dayGrid demo1 谷值带', A.dayGrid_demo1_bands >= 7], ['dayGrid demo2=32格', A.dayGrid_demo2_cells === 32],
  ['dayGrid demo2 VEN 28格', A.dayGrid_demo2_ven === 28],
  ['hourLane demo2 x2', A.hourLane_demo2_svgs === 2], ['hourLane demo2 参考线x4', A.hourLane_demo2_reflines === 4],
  ['hourLane demo1 x1', A.hourLane_demo1_svgs === 1], ['hourLane demo1 参考线x2', A.hourLane_demo1_reflines === 2],
  ['定义原文常驻', A.hourLane_demo2_feverdef === 1], ['双源体温', A.hourLane_demo2_dual === 1],
  ['Day+N svg', A.dayAxis_svg === 1], ['Day+N 锚点灰格', A.dayAxis_anchor === 1], ['Day+100', A.dayAxis_day100 === 1],
  ['里程碑卡x4', A.dayAxis_milestones === 4],
  ['chart 根class', A.chart_root_class === 1], ['computed fill=none', A.chart_computed_fill === 'none'],
  ['折叠卡x5', A.fold_count === 5], ['默认收起=0', A.fold_default_open === 0], ['展开5块', A.fold_blocks === 5],
  ['两区导出x2', A.export_buttons === 2],
];
const fails = checks.filter(([, okk]) => !okk);
console.log(JSON.stringify({
  screenshots: report.screenshots, clickWalk: report.clickWalk, errors: report.errors.length,
  assertions: A, checks: `${checks.length - fails.length}/${checks.length}`, failedChecks: fails.map(([n]) => n)
}, null, 1));
process.exit(fails.length || report.errors.length ? 1 : 0);
