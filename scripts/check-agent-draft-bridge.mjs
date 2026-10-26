#!/usr/bin/env node
/**
 * check-agent-draft-bridge.mjs — AI 协助一键发送「对穿断言」（34 号 §四）
 *
 * 防"两端各自实现了"的假接通（肢端肥大症 0.2.0 真实坑：页面渲染了协议链接、
 * 壳层监听了 postMessage，但 public/app.js 从未 postMessage，链路实际不通）。
 *
 * 用法：node scripts/check-agent-draft-bridge.mjs [项目根]
 * 断言（任一失败即非零退出）：
 *   A1 页面有 agent-draft 协议链接 ⇒ 必须 parent.postMessage 且消息带 send:true
 *   A4 支持嵌入式（有 postMessage）且页面含自有 AI 面板 ⇒ 必须有面板门控证据
 *   A2/A3 壳层侧（监听 + event.source 校验 + plain 相双守卫）：
 *        **阶段感知**——壳层还是 M0 占位骨架时跳过并说明原因，不假装通过。
 *        判据是"壳层是否已接真实业务"：占位骨架的标志是「服务已连接，业务功能待按 spec 实现」。
 *
 * 为什么要 A4 而不是只查 EMBEDDED 常量存在：常量存在 ≠ 面板被门控。
 *   AML M2 实测：EMBEDDED 只用在发送分支，setAgent() 无条件显示面板，
 *   装机后右侧会出现「AI 对话 · 演示」+ 原生会话两个面板。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const pkgPath = join(root, 'package.json')
const slug = existsSync(pkgPath)
  ? JSON.parse(readFileSync(pkgPath, 'utf8')).name.replace(/^@[^/]+\//, '')
  : 'app'
const read = (p) => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null

const problems = []
const notes = []
const pub = read('public/app.js')
const cli = read('lib/client.js')

if (pub === null && cli === null) {
  console.log('- 无 public/app.js 与 lib/client.js，跳过（未到 M2/M5）')
  process.exit(0)
}

if (pub) {
  const hasLink = pub.includes('agent-draft')
  const hasPost = pub.includes('parent.postMessage')
  const hasSend = /\bsend\s*:\s*true\b/.test(pub)
  if (hasLink && !hasPost) problems.push('A1 页面有 agent-draft 协议链接但没有 parent.postMessage（假接通）')
  if (hasLink && hasPost && !hasSend) problems.push('A1 postMessage 未携带 send:true（34 号默认一键发送；回退须留痕）')

  /* A4 面板唯一性（34 号 §一 2b）。
     门控证据必须是「面板显隐处」的门控，不是任意位置的常量定义——
     所以要求 EMBEDDED/window.parent !== window 在 setAgent（或等价显隐函数）体内出现。 */
  const hasOwnPane = pub.includes('agent-pane')
  if (hasPost && hasOwnPane) {
    const fnBody = (() => {
      const m = pub.match(/function\s+setAgent\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)
      return m ? m[1] : null
    })()
    const gateInFn = fnBody && (/EMBEDDED\s*\(/.test(fnBody) || /window\.parent\s*!==\s*window/.test(fnBody))
    const gateAnywhere = /const\s+EMBEDDED/.test(pub) || (pub.match(/window\.parent\s*!==\s*window/g) || []).length >= 2
    if (!gateAnywhere) problems.push('A4 嵌入式支持但演示面板无门控（需 EMBEDDED 常量或 window.parent !== window ≥2 处）——面板会漏进装机版')
    else if (fnBody && !gateInFn) problems.push('A4 有 EMBEDDED 常量但面板显隐函数（setAgent）体内没有门控——常量只用在发送分支，装机后仍会出现双面板')
    else if (!fnBody) notes.push('A4 未找到 setAgent 函数（自定义显隐实现？需人工确认面板门控在显隐路径上）')
  }
}

if (cli) {
  /* 阶段感知：M0 占位骨架不查壳层契约，但必须明说跳过原因 */
  const placeholder = /业务功能待按 spec 实现/.test(cli)
  if (placeholder) {
    notes.push('A2/A3 跳过：lib/client.js 仍是 M0 占位骨架（壳层尚未监听 agent-draft）——M5 接真实客户端后本断言自动生效')
  } else {
    if (!cli.includes(':agent-draft')) problems.push('A2 壳层未监听 <app>:agent-draft 消息')
    if (!/event\.source\s*!==?\s*frame/.test(cli) && !/event\.source\s*===?\s*frame/.test(cli))
      problems.push('A2 壳层未校验 event.source（只校 origin 挡不住同源窗口）')
    if (/submit\(/.test(cli) && !/plain/.test(cli)) problems.push('A3 自动发送缺 plain 相守卫')
  }
}

if (problems.length) {
  console.error('✗ agent-draft 对穿断言失败：\n- ' + problems.join('\n- '))
  for (const n of notes) console.error('  · ' + n)
  process.exit(1)
}
if (notes.length) for (const n of notes) console.log('  · ' + n)
console.log(pub && pub.includes('agent-draft')
  ? '✓ agent-draft 链路（页面发送 + 面板门控已验证；壳层侧按阶段判定）'
  : '· 页面尚未使用 agent-draft（未到 34 号接入点）')
