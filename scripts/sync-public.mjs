#!/usr/bin/env node
/* public 同步（readme staging 教训）：prototypes/v0.2 的四件套 + primer 三件套逐字符同步到 public/。
 *
 * 36 号：primer-data.js / primer.js / primer.css 必须一起同步——
 * 只同步业务四件套会让装机版「?」点开是空白，而原型里一切正常。
 *
 * M5 起（AML 0.3.0）：**public/ 与原型逐字符一致，同步脚本不做任何改写**。
 * 数据层（先向 /api/aml/bootstrap 要真数据、拿不到才回退 DEMO_DATA）已经写在
 * prototypes/v0.2/app.js 里——因为它同时也是双击 index.html 时的实现。
 * 构建期再打一遍补丁会让两份渲染代码分叉，parity 就没人守得住了。
 *
 * 用法：
 *   node scripts/sync-public.mjs            写入
 *   node scripts/sync-public.mjs --check    只校验，不同步退出码 1
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'prototypes', 'v0.2');
const DST = join(ROOT, 'public');
const checkOnly = process.argv.includes('--check');

const REQUIRED = ['index.html', 'style.css', 'app.js', 'demo-data.js'];
const PRIMER = ['primer-data.js', 'primer.js', 'primer.css'];
const ALL = [...REQUIRED, ...PRIMER];

let failed = false;
const stale = [];

for (const f of ALL) {
  const src = join(SRC, f);
  if (!existsSync(src)) {
    /* 缺文件是硬错，不做"缺了就跳过"——跳过会让 public/ 停在旧内容而脚本仍报成功。 */
    console.error(`✗ 缺源文件 ${f}（${src}）`);
    failed = true;
    continue;
  }
  if (checkOnly) {
    const dst = join(DST, f);
    if (!existsSync(dst)) stale.push(`缺 public/${f}`);
    else if (readFileSync(dst, 'utf8') !== readFileSync(src, 'utf8')) stale.push(`public/${f} 与原型不同步`);
    continue;
  }
  copyFileSync(src, join(DST, f));
  console.log(`synced ${f}`);
}

if (failed) {
  console.error('✗ 同步未完成：上面列出的源文件缺失，public/ 可能停在旧内容');
  process.exit(1);
}

if (checkOnly) {
  if (stale.length) {
    for (const s of stale) console.error(`✗ ${s}`);
    console.error('（修法：node scripts/sync-public.mjs）');
    process.exit(1);
  }
  console.log(`✓ public/ 与原型逐字符一致（${ALL.length} 个文件：业务四件套 + primer 三件套）`);
  process.exit(0);
}

console.log(`✓ 同步完成：${ALL.length} 个文件（业务四件套 + primer 三件套）`);
