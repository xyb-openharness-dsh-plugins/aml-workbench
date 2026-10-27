#!/usr/bin/env node
/**
 * check-runtime-files.mjs — 装机面规则⑨的静态断言（AML 0.5.0 回收）
 *
 * 抓的缺陷：dsh 运行时按仓库相对路径读盘的目录（research/demo/schema/public/assets），
 * 忘了放进 package.json files 白名单 → npm pack 装机后目录不存在 →
 * 临床检索为空 / 迁移静默空库（头颈癌 0.1.x 实漏过 schema/migrations）。
 *
 * 用法：node scripts/check-runtime-files.mjs <项目根>
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const files = pkg.files ?? []
const RUNTIME_DIRS = ['research', 'demo', 'schema', 'public', 'assets']
const problems = []

const dshDir = join(root, 'dsh')
const srcs = existsSync(dshDir) ? readdirSync(dshDir).filter((f) => f.endsWith('.js')).map((f) => join('dsh', f)) : []
for (const rel of srcs) {
  const s = readFileSync(join(root, rel), 'utf8')
  for (const dir of RUNTIME_DIRS) {
    const used = new RegExp(`['"\`]${dir}['"\`]`).test(s)
    if (used && !files.includes(dir)) problems.push(`${rel} 引用了运行时目录 '${dir}'，但 package.json files 白名单没有它 → 装机后该目录缺失（规则⑨）`)
  }
}

if (problems.length) { console.error('✗ 运行时文件断言失败：\n- ' + problems.join('\n- ')); process.exit(1) }
console.log(`✓ 运行时目录都在 files 白名单（${RUNTIME_DIRS.join('/')}）`)
