#!/usr/bin/env node
/**
 * check-agent-draft-bridge.mjs — AI 协助一键发送「对穿断言」（34 号 §四）
 *
 * 防"两端各自实现了"的假接通（肢端肥大症 0.2.0 真实坑：页面渲染了协议链接、
 * 壳层监听了 postMessage，但 public/app.js 从未 postMessage，链路实际不通）。
 *
 * 用法：node scripts/check-agent-draft-bridge.mjs <项目根> [<app-slug>]
 * 断言（任一失败即非零退出）：
 *   A1 public/app.js 出现 agent-draft 协议链接 ⇒ 必须出现 parent.postMessage 且消息带 send
 *   A2 lib/client.js 必须监听同 <app>:agent-draft 且校验 event.source
 *   A3 lib/client.js 若自动发送 ⇒ 必须带双守卫证据（plain 相判断 + submit）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const slug = process.argv[3] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name.replace(/^@[^/]+\//, '')
const read = (p) => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null

const problems = []
const pub = read('public/app.js')
const cli = read('lib/client.js')

if (pub === null && cli === null) { console.log('- 无 public/app.js 与 lib/client.js，跳过（未到 M5）'); process.exit(0) }

if (pub) {
  const hasLink = pub.includes(`agent-draft`)
  const hasPost = pub.includes('parent.postMessage') || pub.includes('window.parent.postMessage')
  const hasSend = /\bsend\s*:\s*true\b/.test(pub)
  if (hasLink && !hasPost) problems.push('A1 页面有 agent-draft 协议链接但没有 parent.postMessage（假接通）')
  if (hasLink && hasPost && !hasSend) problems.push('A1 postMessage 未携带 send:true（34 号默认一键发送；回退须留痕）')
}
if (cli) {
  if (!cli.includes(`${slug.split('/').pop()}:agent-draft`) && !cli.includes(':agent-draft')) problems.push('A2 壳层未监听 <app>:agent-draft 消息')
  if (!/event\.source\s*!==?\s*frame/.test(cli) && !/event\.source\s*===?\s*frame/.test(cli)) problems.push('A2 壳层未校验 event.source（只校 origin 挡不住同源窗口）')
  if (/submit\(/.test(cli) && !/plain/.test(cli)) problems.push('A3 自动发送缺 plain 相守卫')
}

if (problems.length) { console.error('✗ agent-draft 对穿断言失败：\n- ' + problems.join('\n- ')); process.exit(1) }
console.log('✓ agent-draft 链路对穿（页面发送 ↔ 壳层监听 ↔ 双守卫提交）')
