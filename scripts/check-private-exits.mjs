#!/usr/bin/env node
/**
 * 私密三出口断言（K6 · 隐私红线，P0 级）
 *
 * 为什么需要这个文件：
 *   「私密默认不进导出、不进看板摘要、不进 AI 上下文」是本台对患者的核心承诺。
 *   它最容易在两类改动里悄悄破掉：
 *     ① 新增一条出口（比如又做了一个"一键发给家属"）忘了调 sharedOnly；
 *     ② sharedOnly 被改成只过滤某个字段名，而数据里用的是另一个字段。
 *   两种都不会让任何现有探针变红——探针不读私密正文。
 *
 * 做法（真实浏览器，不是静态猜）：
 *   S1 数据层：每个档案必须存在至少 1 条 private 记录，且其正文有可识别的特征串
 *   S2 AI 出口：页面上所有 `a.ai-link` 的 href（解码后）不得包含任何私密特征串
 *   S3 导出出口：「给医生的摘要」（export-shared）正文不得包含任何私密特征串
 *   S4 看板出口：看板可见文本不得包含任何私密特征串（只允许出现条数）
 *   S5 自存全量（export-full）**允许**包含——那是患者给自己存的，反过来验证 S3 不是"整段都没导出"
 *
 * 用法：node scripts/check-private-exits.mjs
 * 退出码：0 通过 / 1 泄漏
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, stopChrome } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'prototypes/v0.2/demo-data.js')
const URL_APP = `file://${join(ROOT, 'prototypes', 'v0.2', 'index.html')}`

const fails = []
const oks = []

/* S1 数据层：从 demo-data 里取出私密正文的特征片段（前 12 个非空白字符） */
const src = readFileSync(DATA, 'utf8')
const m = src.match(/window\.DEMO_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)
if (!m) { console.error('✗ 解析不到 window.DEMO_DATA'); process.exit(1) }
const data = JSON.parse(m[1])

const secrets = []
const profiles = data.profiles || []
for (const p of profiles) {
  const items = p?.mind?.death?.items || []
  const priv = items.filter((x) => x.visibility === 'private')
  if (!priv.length) fails.push(`S1 ${p.name}：没有 private 记录（无法验证过滤是否生效；演示数据应至少留 1 条）`)
  for (const x of priv) {
    const text = String(x.text || x.title || '').replace(/\s+/g, '')
    if (text.length >= 12) secrets.push(text.slice(0, 12))
  }
  oks.push(`S1 ${p.name}：${priv.length} 条 private 记录（共 ${items.length} 条）`)
}
if (!secrets.length) {
  console.error('✗ S1 取不到可识别的私密特征串（私密记录为空或文本过短），断言无法生效')
  process.exit(1)
}

const ch = await launchChrome({ port: Number(process.env.AML_PRIV_CDP_PORT || 9393), userDataPrefix: '.xyb-aml-priv-exits-' })
const { cdp } = ch

const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }
const leaks = (text) => secrets.filter((s) => String(text).replace(/\s+/g, '').includes(s))

try {
  await cdp.send('Page.navigate', { url: URL_APP })
  await sleep(700)
  for (let i = 0; i < 40 && !(await cdp.eval("document.body.getAttribute('data-booted')==='1'")); i += 1) await sleep(120)

  for (const prof of ['demo1', 'demo2']) {
    await cdp.eval("location.hash='#dash'; window.dispatchEvent(new Event('hashchange'))")
    await sleep(160)
    await cdp.eval("document.querySelector('[data-action=\"profiles\"]').click()")
    await sleep(160)
    await cdp.eval(`(document.querySelector('[data-action="pick-profile"][data-id="${prof}"]')||{click(){}}).click()`)
    await sleep(220)

    /* S2 AI 出口 */
    const hrefs = decode(await cdp.eval("[...document.querySelectorAll('a.ai-link')].map(a=>a.getAttribute('href')||'').join('\\n')"))
    const aiLeak = leaks(hrefs)
    if (aiLeak.length) fails.push(`S2 ${prof}：AI 提示词含私密正文（${aiLeak.join(' / ')}）`)
    else oks.push(`S2 ${prof}：${(hrefs.match(/agent-draft/g) || []).length} 个 AI 入口均不含私密正文`)

    /* S4 看板可见文本 */
    await cdp.eval("location.hash='#dash'; window.dispatchEvent(new Event('hashchange'))")
    await sleep(200)
    const dashText = await cdp.eval("document.querySelector('#main').innerText")
    const dashLeak = leaks(dashText)
    if (dashLeak.length) fails.push(`S4 ${prof}：看板可见文本含私密正文（${dashLeak.join(' / ')}）`)
    else oks.push(`S4 ${prof}：看板只出现条数、不含私密正文`)

    /* S3 导出（给医生的摘要）+ S5 自存全量 */
    await cdp.eval("location.hash='#docs/docs-prep'; window.dispatchEvent(new Event('hashchange'))")
    await sleep(250)
    for (const [action, label, mustLeak] of [['export-shared', 'S3 给医生的摘要', false], ['export-full', 'S5 自存全量', true]]) {
      const ok = await cdp.eval(`!!document.querySelector('[data-action="${action}"]')`)
      if (!ok) { fails.push(`${label} ${prof}：找不到导出按钮 [data-action="${action}"]`); continue }
      await cdp.eval(`document.querySelector('[data-action="${action}"]').click()`)
      await sleep(280)
      const body = await cdp.eval("(document.querySelector('#dialog-body textarea')||{}).value||''")
      await cdp.eval("document.querySelector('#dialog-foot [data-action=\"close\"]')?.click()")
      await sleep(120)
      if (!body.length) { fails.push(`${label} ${prof}：导出正文为空（导出没跑起来，不能算通过）`); continue }
      const leak = leaks(body)
      if (!mustLeak) {
        if (leak.length) fails.push(`${label} ${prof}：含私密正文（${leak.join(' / ')}）——这是隐私红线`)
        else oks.push(`${label} ${prof}：${body.length} 字，私密正文 0 处`)
      } else {
        /* 反向对照：自存全量必须能看到私密，否则说明过滤函数把所有东西都滤掉了（假通过） */
        if (!leak.length) fails.push(`${label} ${prof}：自存全量里也找不到私密正文——说明 S3 的"没泄漏"可能是整段都没导出（假通过）`)
        else oks.push(`${label} ${prof}：自存全量含私密（${leak.length} 处），反证 S3 的过滤是真的在起作用`)
      }
    }
  }
} catch (e) {
  fails.push(`运行异常：${e?.message || e}`)
} finally {
  await stopChrome(ch)
}

if (fails.length) {
  console.error('✗ 私密三出口断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 私密三出口：${oks.length} 条断言通过（数据层 / AI / 看板 / 摘要导出 / 自存全量反向对照）`)
