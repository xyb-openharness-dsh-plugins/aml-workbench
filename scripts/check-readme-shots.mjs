#!/usr/bin/env node
/**
 * README 截图版本一致性断言（33 号）
 *
 * 为什么需要这个文件（2026-10-27 AML 实测）：
 *   仓库从 0.2.0 一路走到 0.4.0（M3/M5/M6 都已完成），但 README 里 9 张截图
 *   仍然全部引用 `readme-*-0.2.0.png`。而 `shots-readme.mjs` 是按 VERSION 命名的，
 *   所以它每次重跑都生成 `-0.4.0.png`，旧图**永远留在原地且永远被 README 引用**。
 *
 *   症状极其隐蔽：截图脚本"跑成功了"（14/14 断言通过）、文件也确实更新了，
 *   但 README 展示给用户的是两个版本之前的界面。这类缺陷在 33 号里本该被拦住，
 *   但 33 号只规定了"要有截图、要 1440 宽、要不含 PII"，没有规定"要与当前版本一致"。
 *
 * 判据：
 *   R1 README 里出现的 `docs/screenshots/readme-*.png` 引用，文件名里的版本号必须等于 VERSION
 *   R2 每个被引用的文件必须真实存在（缺文件时 GitHub 上是破图）
 *   R3 `docs/screenshots/` 下不得有**其它版本**的 readme 截图（否则会有人照着旧图理解产品）
 *   R4 README 至少要引用 4 张截图（33 号下限）
 *
 * 用法：node scripts/check-readme-shots.mjs
 * 退出码：0 通过 / 1 有硬问题
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
const README = join(ROOT, 'README.md')
const SHOTS = join(ROOT, 'docs', 'screenshots')

const fails = []
const oks = []

if (!existsSync(README)) {
  console.error('✗ 找不到 README.md')
  process.exit(1)
}
const md = readFileSync(README, 'utf8')

/* R1 + R2：被引用的截图 */
const refs = [...md.matchAll(/docs\/screenshots\/(readme-[A-Za-z0-9._-]+\.png)/g)].map((m) => m[1])
const uniq = [...new Set(refs)]

if (uniq.length < 4) {
  fails.push(`R4 README 只引用了 ${uniq.length} 张截图（33 号要求 ≥4）`)
} else oks.push(`R4 README 引用 ${uniq.length} 张截图（≥4）`)

let versionOk = true
for (const f of uniq) {
  /* 文件名形如 readme-dashboard-0.4.0.png：取最后两段数字作版本 */
  const m = f.match(/^(.*)-(\d+\.\d+\.\d+)\.png$/)
  if (!m) {
    fails.push(`R1 截图文件名不含语义化版本：${f}（无法判断它是不是当前版本）`)
    versionOk = false
    continue
  }
  const v = m[2]
  if (v !== VERSION) {
    fails.push(`R1 README 引用的截图版本 ${v} ≠ 当前 VERSION ${VERSION}：${f}`
      + '——重跑 npm run shots:readme 并按新版本号更新引用')
    versionOk = false
  }
  if (!existsSync(join(SHOTS, f))) fails.push(`R2 README 引用的截图不存在（GitHub 上会是破图）：docs/screenshots/${f}`)
}
if (versionOk && uniq.length) oks.push(`R1 全部引用截图版本 = ${VERSION}`)
if (!fails.some((f) => f.startsWith('R2'))) oks.push('R2 全部被引用截图真实存在')

/* R3：不得残留其它版本的 readme 截图 */
if (existsSync(SHOTS)) {
  const stale = readdirSync(SHOTS)
    .filter((f) => /^readme-.*\.png$/.test(f))
    .filter((f) => {
      const m = f.match(/^(.*)-(\d+\.\d+\.\d+)\.png$/)
      return m && m[2] !== VERSION
    })
  if (stale.length) {
    fails.push(`R3 docs/screenshots/ 残留 ${stale.length} 张旧版本截图：[${stale.join(', ')}]`
      + '——旧图会让人照着两个版本前的界面理解产品；确认无用后删除')
  } else oks.push(`R3 无旧版本截图残留（当前 ${VERSION}）`)
}

if (fails.length) {
  console.error('✗ README 截图版本一致性断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ README 截图版本一致：${oks.length} 条断言通过（版本 / 存在 / 无旧图 / 数量）`)
