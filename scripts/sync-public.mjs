#!/usr/bin/env node
/* public 同步（readme staging 教训）：prototypes/v0.2 的四件套 + primer 三件套逐字符同步到 public/（离线回退）。
   36 号：primer-data.js / primer.js / primer.css 必须一起同步——
   只同步业务四件套会让装机版「?」点开是空白，而原型里一切正常。 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'prototypes', 'v0.2');
const DST = join(ROOT, 'public');

const REQUIRED = ['index.html', 'style.css', 'app.js', 'demo-data.js'];
const PRIMER = ['primer-data.js', 'primer.js', 'primer.css'];

let failed = false;
for (const f of [...REQUIRED, ...PRIMER]) {
  const src = join(SRC, f);
  if (!existsSync(src)) {
    /* 缺文件是硬错，不做"缺了就跳过"——跳过会让 public/ 停在旧内容而脚本仍报成功。 */
    console.error(`✗ 缺源文件 ${f}（${src}）`);
    failed = true;
    continue;
  }
  copyFileSync(src, join(DST, f));
  console.log(`synced ${f}`);
}
if (failed) {
  console.error('✗ 同步未完成：上面列出的源文件缺失，public/ 可能停在旧内容');
  process.exit(1);
}
console.log(`✓ 同步完成：${REQUIRED.length + PRIMER.length} 个文件（业务四件套 + primer 三件套）`);
