#!/usr/bin/env node
/* public 同步（readme staging 教训）：prototypes/v0.2 的四件套逐字符同步到 public/（离线回退）。 */
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'prototypes', 'v0.2');
const DST = join(ROOT, 'public');
for (const f of ['index.html', 'style.css', 'app.js', 'demo-data.js']) {
  copyFileSync(join(SRC, f), join(DST, f));
  const a = statSync(join(SRC, f).replace('app.js', 'app.js'));
  console.log(`synced ${f}`);
}
