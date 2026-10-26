#!/usr/bin/env node
/**
 * 窄宽自适应探针（RESPONSIVE-RULES 30 号 0.1.5 · AML 移植版）。
 *
 * 背景：AI 会话面板打开后业务区只剩 60%–75% 宽。根因不是断点不够，而是卡内**横向排列**
 * （标签 / 值 / 注并排）在窄容器里被压到每列只剩一两字宽。
 *
 * 判定规则（SCAN 段自 thyroid scripts/probe-responsive.mjs 整段移植）：
 * 1. `竖排单字`：元素宽度 < 3em 且自身文字 ≥ 6 字 → 一行只放得下 1–2 个字，必是挤压；
 * 2. `横向溢出`：documentElement.scrollWidth > innerWidth + 1（页面被撑出横向滚动）；
 * 3. `溢出容器`：元素 scrollWidth > clientWidth + 2 且 overflow hidden/clip（内容被裁）。
 *
 * 本原型是 file:// 直开的零依赖页面，无需起服务器。
 * 默认 8 档宽度（1300→600，含 1180/900/600 三个断点与 940=AI 面板展开态）× 10 个一级页。
 * M2 硬要求：扫描覆盖 dayGrid（tx/tx-cal）与 hourLane（neu/neu-fever）两页（三新组件窄宽）。
 *
 * 用法：`node scripts/probe-responsive.mjs`；退出码 0/1。依赖本机 Chrome。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep, stopChrome } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'docs', 'shots', 'dev');
mkdirSync(SHOTS, { recursive: true });
const CDP_PORT = Number(process.env.AML_RESP_CDP_PORT || 9362);
const WIDTHS = (process.env.AML_RESP_WIDTHS || '1300,1180,1000,940,900,780,700,600').split(',').map(Number);
/* 10 个一级页 + 三新组件两页（dayGrid / hourLane）——M2 硬要求 */
const PAGES = (process.env.AML_RESP_PAGES || 'dash,dx/dx-wk,tx/tx-cal,tx/tx-path,neu/neu-fever,neu/neu-tx,mrd/mrd-trend,tp/tp-day,tp/tp-eval,chart,care/care-safe,mind/mind-death,docs/docs-prep').split(',');
const URL_APP = `file://${join(ROOT, 'prototypes', 'v0.2', 'index.html')}`;

/* 页内扫描：返回竖排/溢出嫌疑元素。规则写在一处，页面里也照这个跑。 */
const SCAN = `(() => {
  const bad = [];
  const em = (el) => parseFloat(getComputedStyle(el).fontSize) || 12;
  const walk = document.querySelectorAll('#main *');
  for (const el of walk) {
    if (el.closest('svg') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, '');
    if (own.length < 6) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width < em(el) * 3) {
      bad.push({ kind: '竖排单字', sel: el.className || el.tagName, w: Math.round(rect.width), text: own.slice(0, 18) });
    }
  }
  const overflow = [];
  for (const el of document.querySelectorAll('#main *')) {
    const cs = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(cs.overflowX) && !['hidden', 'clip'].includes(cs.overflow)) continue;
    if (!(el.textContent || '').trim()) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== 'inline') {
      overflow.push({ sel: el.className || el.tagName, scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  }
  return JSON.stringify({
    bodyScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    vertical: bad.slice(0, 12),
    clipped: overflow.slice(0, 8),
  });
})()`;

const ch = await launchChrome({ port: CDP_PORT });
const { cdp } = ch;
const problems = [];
const report = {};

try {
  await cdp.send('Page.navigate', { url: URL_APP });
  await sleep(400);
  for (let i = 0; i < 40 && !(await cdp.eval("document.body && document.body.getAttribute('data-booted') === '1'")); i += 1) await sleep(120);
  for (const width of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    /* 940 = AI 面板展开态（家族惯例）：展开原生演示面板，量业务区被压缩后的真实宽度 */
    if (width === 940) { await cdp.eval(`document.getElementById('agent-toggle').click()`); await sleep(120); }
    else if ((await cdp.eval("document.getElementById('agent-pane').hidden")) === false) { await cdp.eval(`document.getElementById('agent-hide').click()`); await sleep(120); }
    await sleep(160);
    for (const page of PAGES) {
      await cdp.eval(`location.hash = '#${page}'; window.dispatchEvent(new Event('hashchange'));`);
      await sleep(150);
      const r = JSON.parse(await cdp.eval(SCAN));
      const overflowX = r.bodyScrollW > r.innerW + 1;
      report[`${width}/${page}`] = r;
      if (overflowX) problems.push({ w: width, page, kind: '横向溢出', bodyScrollW: r.bodyScrollW, innerW: r.innerW });
      for (const v of r.vertical) problems.push({ w: width, page, kind: '竖排单字', ...v });
      for (const v of r.clipped) problems.push({ w: width, page, kind: '内容被裁', ...v });
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.eval("location.hash='#dash'; window.dispatchEvent(new Event('hashchange'));");
  await sleep(300);
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(async (s) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(SHOTS, 'responsive-dash-1440.png'), Buffer.from(s.data, 'base64'));
  });
} finally {
  await stopChrome(ch);
}

writeFileSync(join(SHOTS, 'responsive-report.json'), JSON.stringify(report, null, 2));
if (problems.length) {
  console.log(`probe:resp FAIL — ${problems.length} 处问题：`);
  for (const p of problems.slice(0, 20)) console.log(`  [${p.w}px ${p.page}] ${p.kind} ${p.sel || ''} ${p.text || ''} ${p.scrollW ? `${p.scrollW}>${p.clientW}` : ''}`);
  process.exit(1);
} else {
  const pages = PAGES.length;
  console.log(`probe:resp PASS — ${WIDTHS.length} 档宽度 × ${pages} 页（含 dayGrid/hourLane）全部干净：竖排 0 / 溢出 0 / 裁切 0`);
}
