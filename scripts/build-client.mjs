#!/usr/bin/env node
/**
 * 生成 lib/client.js（DSH 客户端入口）。
 *
 * 官方要求客户端必须是「已构建好的单文件」——Desktop 不会替我们打包（workbench-standard §3.5）。
 * 本项目的客户端是零依赖脚本，这个"构建"只做一件事：把常量注入 src/client.js。
 * 面板参数（customFrame / 0.65 / 25%–45%）、接口前缀、版本号、仓库地址各自只有一份来源
 * （lib/layout.js、dsh/routes.js、VERSION、package.json），由 npm run check 的 --check 兜住。
 *
 * 用法：
 *   node scripts/build-client.mjs           写入（内容没变不落盘）
 *   node scripts/build-client.mjs --check   只校验，与来源不一致时退出码 1
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'client.js')
const target = join(root, 'lib', 'client.js')
const checkOnly = process.argv.includes('--check')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { PANEL, AGENT_PANE, assertPanelConfig } = await import('../lib/layout.js')
const { API_PREFIX, UI_PREFIX } = await import('../dsh/routes.js')
const { version } = await import('../lib/version.js')

/** 仓库地址规范化成 https://github.com/<owner>/<repo>。 */
function canonicalRepository(raw) {
  const url = typeof raw === 'string' ? raw : raw?.url
  if (!url) return ''
  let text = String(url).trim()
  if (text.startsWith('git@')) text = text.replace(/^git@([^:]+):/, 'https://$1/')
  text = text.replace(/^git:\/\//, 'https://').replace(/\.git$/, '')
  return text.replace(/\/+$/, '')
}

const repository = canonicalRepository(pkg.repository)
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repository)) {
  console.error(`✗ package.json 的 repository 不是可用的 GitHub 地址：${pkg.repository?.url ?? pkg.repository ?? '（未填）'}`)
  process.exit(1)
}

const problems = []
if (!pkg.name) problems.push('package.json 缺少 name')
for (const problem of assertPanelConfig(PANEL, AGENT_PANE)) problems.push(problem)
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}

const replacements = {
  __PKG_NAME__: pkg.name,
  __REPOSITORY__: repository,
  __API_PREFIX__: API_PREFIX,
  __UI_ENTRY__: UI_PREFIX,
  __VERSION__: version,
  __BUSINESS_SIDE__: PANEL.businessSide,
  __BUSINESS_WIDTH__: String(PANEL.businessWidth),
  __CUSTOM_FRAME__: String(PANEL.customFrame === true),
  __AGENT_DEFAULT__: String(AGENT_PANE.default ?? AGENT_PANE.def),
  __AGENT_MIN__: String(AGENT_PANE.min),
  __AGENT_MAX__: String(AGENT_PANE.max),
  __AGENT_STEP__: String(AGENT_PANE.ratioStep),
  __NARROW_BELOW__: String(AGENT_PANE.narrowBelowPx),
  __DRAWER_MAX__: String(AGENT_PANE.drawerMaxPx),
}

const header = `/* 本文件由 scripts/build-client.mjs 从 src/client.js 生成，请勿手改。\n`
  + ` * 改客户端源码请改 src/client.js 后运行 npm run build:client。\n`
  + ` * 包名 ${pkg.name} · 仓库 ${repository}\n`
  + ` * 面板 customFrame 开关 ${PANEL.customFrame === true ? '开' : '关'} · 业务 ${PANEL.businessSide} ${PANEL.businessWidth}\n`
  + ` * AI 会话可拖宽度 ${AGENT_PANE.min}–${AGENT_PANE.max}（默认 ${AGENT_PANE.def}）\n`
  + ` */\n`

let generated = header + readFileSync(source, 'utf8')
for (const [token, value] of Object.entries(replacements)) {
  generated = generated.split(token).join(value)
}

const leftover = [...new Set([...generated.matchAll(/__[A-Z_]+__/g)].map((m) => m[0]))]
if (leftover.length) {
  console.error(`✗ src/client.js 里有未替换的占位：${leftover.join(', ')}`)
  process.exit(1)
}

if (checkOnly) {
  if (!existsSync(target)) {
    console.error('✗ 缺少 lib/client.js，请先运行 npm run build:client')
    process.exit(1)
  }
  if (readFileSync(target, 'utf8') !== generated) {
    console.error('✗ lib/client.js 与来源不同步，请运行 npm run build:client')
    process.exit(1)
  }
  console.log(`✓ lib/client.js 与来源同步（${pkg.name} · customFrame=${PANEL.customFrame === true} · 会话 ${AGENT_PANE.min}–${AGENT_PANE.max}）`)
  process.exit(0)
}

if (existsSync(target) && readFileSync(target, 'utf8') === generated) {
  console.log(`= lib/client.js 未变化（v${version} · ${pkg.name}）`)
  process.exit(0)
}

writeFileSync(target, generated)
console.log(`✓ 已生成 lib/client.js（v${version} · ${pkg.name} · customFrame=${PANEL.customFrame === true} · 会话 ${AGENT_PANE.min}–${AGENT_PANE.max}）`)
