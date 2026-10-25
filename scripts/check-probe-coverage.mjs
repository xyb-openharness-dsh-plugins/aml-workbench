/* 探针覆盖断言（LESSONS 第 10 类「检查器全绿可能是它没在看你那一页」的可断言版）
   用法：node scripts/check-probe-coverage.mjs
   判据：三个探针脚本的 PAGES 必须覆盖 prototypes/v0.2/app.js 里的每一条 ROUTES。
        探针 PAGES 是手写常量，加路由时极易漏改 —— 漏改时探针"全绿"只是因为它没扫新页。
   为什么不是直接比对字符串：探针用元组 ("route", "标签") 或纯字符串两种写法，只查路由名出现与否。 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, 'prototypes/v0.2/app.js');
const fails = [], oks = [];

/* 新项目从第一天起 check 必须全绿（此时还没有原型）。
   原型不存在 → 明确 skip 并说清"等原型出来才开始保护"，而不是静默通过或直接崩。
   注意：skip 不是静默——它会把 skip 原因打出来，避免以后误以为已经被保护了。 */
if (!existsSync(APP)) {
  console.log(JSON.stringify({ pass: true, skipped: true,
    reason: 'prototypes/v0.2/app.js 还不存在（原型未开始）：探针覆盖断言暂不启用，原型落地后自动生效。',
    fails: [], oks: [] }, null, 2));
  process.exit(0);
}

const app = readFileSync(APP, 'utf8');
const m = app.match(/var ROUTES = \[([^\]]+)\]/);
if (!m) fails.push('routes: 在 app.js 里找不到 var ROUTES = [...]');
else {
  const routes = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const PROBES = ['scripts/probe-page-view.py', 'scripts/probe-ip-matrix.py', 'scripts/probe-write-paths.py', 'scripts/probe-router.py'];
  let checked = 0;
  for (const rel of PROBES) {
    let txt;
    try { txt = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; } // 可选探针，缺了不报
    checked++;
    const missing = routes.filter((r) => !txt.includes(`"${r}"`) && !txt.includes(`'${r}'`));
    if (missing.length) fails.push(`coverage: ${rel} 的 PAGES 漏了 ${missing.length} 条路由 [${missing.join(', ')}]（新页不会被它扫到）`);
  }
  if (checked === 0)
    fails.push('coverage: 原型已存在但一个探针脚本都没有（scripts/probe-page-view.mjs 等）——'
      + '此时没有任何东西在扫新页面，先写探针再启用本断言');
  if (!fails.length) oks.push(`coverage: ${checked} 个探针覆盖全部 ${routes.length} 条路由（${routes.join('/')}）`);
}
console.log(JSON.stringify({ pass: fails.length === 0, fails, oks }, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
