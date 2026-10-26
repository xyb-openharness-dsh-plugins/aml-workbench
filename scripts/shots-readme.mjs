#!/usr/bin/env node
/**
 * README 精选截图（33 号）：1440 宽、真实渲染、演示数据、私密内容不入图。
 * 产出 docs/screenshots/readme-<feature>-<version>.png（≥4，含折叠卡收/展各一张、疾病概要整页一张）。
 * 用法：node scripts/shots-readme.mjs
 *
 * 与 33 号的关系：截图必须能被脚本重跑出来，而不是手工截一张放进去——
 * 手工截图的页面在下一轮改版后就不再代表产品，而 README 还在引用它。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep, stopChrome } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
const URL_APP = `file://${join(ROOT, 'prototypes', 'v0.2', 'index.html')}`;
const CDP_PORT = Number(process.env.AML_SHOTS_CDP_PORT || 9372);

const ch = await launchChrome({ port: CDP_PORT, userDataPrefix: '.xyb-aml-shots-' });
const { cdp } = ch;
const shots = [];
const checks = [];

const assert = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  if (!ok) throw new Error(`${name} 不成立${detail ? '：' + detail : ''}`);
};

async function goto(page, sub) {
  await cdp.eval(`location.hash = ${JSON.stringify('#' + page + (sub ? '/' + sub : ''))}`);
  await sleep(140);
  await cdp.eval('window.scrollTo(0,0)');
  await sleep(100);
}
async function shot(name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  shots.push(name);
}

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  /* 清缓存后再导航：file:// 页面在同一个 Chrome 用户目录里会被缓存，
     改完 app.js 立刻重跑截图，可能截到**上一版**（2026-10-27 实测：
     入口文案已改，截图仍是旧的 8 个 chip）。这类"截图比代码旧"的假通过
     最难发现——截图看着正常，只是不是现在的样子。 */
  await cdp.send('Network.enable', {});
  await cdp.send('Network.clearBrowserCache', {});
  await cdp.send('Page.navigate', { url: URL_APP + '?v=' + Date.now() });
  await sleep(700);
  for (let i = 0; i < 50 && !(await cdp.eval("document.body.getAttribute('data-booted') === '1'")); i += 1) await sleep(120);

  /* 1 看板：D+N 状态卡 + 粒缺期模式卡 + 血象四卡 + 今天能做的一件事 */
  await goto('dash', '');
  const dn = await cdp.eval("(document.querySelector('#main .dn-card')||{}).textContent||''");
  assert('看板有 D+N 状态卡', /第\s*\d+\s*天/.test(dn), dn.slice(0, 40));
  await shot(`readme-dashboard-${VERSION}.png`);

  /* 2 诱导日历（按天）dayGrid */
  await goto('tx', 'tx-cal');
  const cells = await cdp.eval("document.querySelectorAll('#main .dg-grid .dg-cell').length");
  assert('dayGrid 按天格数 > 0', cells > 0, `cells=${cells}`);
  await shot(`readme-daygrid-${VERSION}.png`);

  /* 3 粒缺发热轨道 hourLane：38.3/38.0 参考线必须在 */
  await goto('neu', 'neu-fever');
  const reflines = await cdp.eval("document.querySelectorAll('#main .hl-svg-wrap line.refline').length");
  assert('hourLane 有 38.3/38.0 参考线', reflines >= 1, `reflines=${reflines}`);
  await shot(`readme-hourlane-${VERSION}.png`);

  /* 4 Day+N 相对天数轴 */
  await goto('tp', 'tp-day');
  const anchor = await cdp.eval("!!document.querySelector('#main circle.anchor-grey')");
  assert('Day+N 轴有 Day 0 锚点', anchor);
  const day100 = await cdp.eval("document.querySelector('#main').textContent.includes('Day +100')");
  assert('Day+N 轴标出 Day +100 节点', day100);
  await shot(`readme-dayaxis-${VERSION}.png`);

  /* 5 一图秀：线是线，不是被默认黑填充 */
  await goto('chart', '');
  const rootClass = await cdp.eval("!!document.querySelector('#main svg.chart')");
  assert('一图秀 svg 根节点带 class="chart"', rootClass);
  const fill = await cdp.eval("(() => { const p = document.querySelector('#main svg.chart .line'); return p ? getComputedStyle(p).fill : 'missing'; })()");
  assert('一图秀线语料 fill=none（不是黑块）', fill === 'none', `fill=${fill}`);
  await shot(`readme-onechart-${VERSION}.png`);

  /* 6/7 治疗路径折叠卡：收（默认全收）→ 展（五块齐） */
  await goto('tx', 'tx-path');
  const openCount = await cdp.eval("document.querySelectorAll('#main .phase-fold[open]').length");
  assert('折叠卡默认收起', openCount === 0, `open=${openCount}`);
  const total = await cdp.eval("document.querySelectorAll('#main .phase-fold').length");
  assert('折叠卡数量 > 0', total > 0, `total=${total}`);
  await shot(`readme-pathway-folded-${VERSION}.png`);

  await cdp.eval("document.querySelector('#main .phase-fold summary').click()");
  await sleep(180);
  const blocks = await cdp.eval("document.querySelectorAll('#main .phase-fold[open] .phase-detail section.pd-block').length");
  assert('展开态五块齐全（方案/指标/影像/副作用/支持）', blocks === 5, `blocks=${blocks}`);
  await shot(`readme-pathway-expanded-${VERSION}.png`);

  /* 8 私密三出口（红线页，不含私密数值） */
  await goto('mind', 'mind-death');
  const privateNote = await cdp.eval("document.body.innerText.includes('私密')");
  assert('私密页有私密说明', privateNote);
  await shot(`readme-private-filter-${VERSION}.png`);

  /* 9 疾病概要整页（36 号）：四段齐全 + 铺满视口（是整页不是弹窗） */
  await cdp.eval("document.querySelector('[data-primer-open]').click()");
  await sleep(320);
  const secs = await cdp.eval("document.querySelectorAll('#disease-primer .dp-section, #disease-primer section[data-sec]').length");
  assert('疾病概要四段齐全', secs === 4, `sections=${secs}`);
  const box = await cdp.eval("(() => { const el = document.getElementById('disease-primer'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()");
  assert('疾病概要是整页（宽高 ≥ 视口 90%）', box && box.w >= box.vw * 0.9 && box.h >= box.vh * 0.9, JSON.stringify(box));
  await shot(`readme-primer-${VERSION}.png`);
  await cdp.eval("window.DiseasePrimer && window.DiseasePrimer.back ? window.DiseasePrimer.back() : null");
  await sleep(200);

  const scrollWidth = await cdp.eval("document.documentElement.scrollWidth");
  assert('1440 宽下无横向溢出', scrollWidth <= 1440, `scrollWidth=${scrollWidth}`);

  console.log(JSON.stringify({ ok: true, version: VERSION, width: 1440, scrollWidth, shots, count: shots.length, checks: `${checks.length}/${checks.length}` }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message ?? error), shots, checks }, null, 2));
  process.exitCode = 1;
} finally {
  await stopChrome(ch);
}
