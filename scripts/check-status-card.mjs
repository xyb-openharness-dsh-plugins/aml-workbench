#!/usr/bin/env node
/**
 * 看板状态卡四件结构断言（36 号 §2.6）
 *
 * 为什么需要这个文件（2026-10-27 AML 实测）：
 *   状态卡是疾病概要浮窗的入口，也是患者打开工作台第一眼看到的东西。
 *   它退化时**两种分支都能正常渲染**，截图上完全看不出问题：
 *     · 初版写了 `d.anchor && Number.isFinite(d.anchorDays)`，
 *       但数据里只有 anchorDays、没有 anchor 字段 →
 *       本来该显示「第 43 天」的档案被判成「待初始化」。
 *     · 反过来，某次改版把副按钮（疾病概要）删了，卡片照样好看。
 *   所以必须逐件检查，而不是"卡片有内容就算过"。
 *
 * 判据（§2.6 四件，缺一即不合格）：
 *   S1 卡头：.dn-card 里有 .eyebrow，且含「D+N 状态卡」
 *   S2 大字天数：.dn-card 里有 .big，文案是「第 N 天」或「待初始化」
 *   S3 现状行：含当前阶段描述，且含「下次：」+ 日期
 *   S4 出口按钮排：主按钮指向当前阶段核心页；副按钮打开疾病概要浮窗
 *   S5 降级分支存在：源码里必须有「待初始化」分支（无锚点时不手填假天数）
 *   S6 天数与锚点一致：大字里的 N 必须等于读模型给的 anchorDays（不手填、不偏差）
 *
 * 用法：node scripts/check-status-card.mjs
 * 退出码：0 通过 / 1 有硬问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, stopChrome } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(ROOT, 'prototypes/v0.2', 'app.js')
const DATA = join(ROOT, 'prototypes/v0.2', 'demo-data.js')
const URL_APP = `file://${join(ROOT, 'prototypes/v0.2', 'index.html')}`

const fails = []
const oks = []

/* S5：静态检查降级分支（不跑浏览器也能判） */
const src = readFileSync(APP, 'utf8')
if (!/待初始化/.test(src)) fails.push('S5 源码里没有「待初始化」降级分支——无锚点时会手填假天数或被判成错误')
else oks.push('S5 存在「待初始化」降级分支')

/* 读模型：取第一个档案的 anchorDays 作为 S6 的基准 */
const dsrc = readFileSync(DATA, 'utf8')
const dm = dsrc.match(/window\.DEMO_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)
if (!dm) {
  console.error('✗ 解析不到 demo-data.js 的 window.DEMO_DATA')
  process.exit(1)
}
const demo = JSON.parse(dm[1])
const first = (demo.profiles || [])[0]
const expectDays = first?.dash?.anchorDays

const ch = await launchChrome({ port: Number(process.env.AML_CARD_CDP_PORT || 9417), userDataPrefix: '.xyb-card-' })
const { cdp } = ch
try {
  await cdp.send('Network.enable', {})
  await cdp.send('Network.clearBrowserCache', {})
  await cdp.send('Page.navigate', { url: URL_APP + '?v=' + Date.now() })
  await sleep(1400)
  for (let i = 0; i < 40 && !(await cdp.eval("document.body.getAttribute('data-booted')==='1'")); i += 1) await sleep(150)

  const card = await cdp.eval(`(() => {
    const c = document.querySelector('#main .dn-card')
    if (!c) return null
    const btn = [...c.querySelectorAll('button')].map((b) => ({
      text: (b.innerText || '').trim(),
      action: b.getAttribute('data-action') || '',
      page: b.getAttribute('data-page') || '',
    }))
    return {
      eyebrow: (c.querySelector('.eyebrow')?.innerText || '').trim(),
      big: (c.querySelector('.big')?.innerText || '').trim(),
      text: (c.innerText || '').replace(/\\n+/g, ' '),
      buttons: btn,
    }
  })()`)

  if (!card) {
    fails.push('S1 找不到 #main .dn-card（看板首卡不存在）')
  } else {
    /* S1 */
    if (!/D\+N\s*状态卡/.test(card.eyebrow)) fails.push(`S1 卡头应含「D+N 状态卡」，实际「${card.eyebrow}」`)
    else oks.push(`S1 卡头：${card.eyebrow}`)

    /* S2 */
    if (!card.big) fails.push('S2 缺少大字天数（.big）')
    else if (!/^第\s*\d+\s*天$/.test(card.big) && card.big !== '待初始化') {
      fails.push(`S2 大字应是「第 N 天」或「待初始化」，实际「${card.big}」`)
    } else oks.push(`S2 大字：${card.big}`)

    /* S3 */
    const hasNext = /下次：/.test(card.text)
    const hasDate = /\d{4}-\d{2}-\d{2}/.test(card.text)
    if (!hasNext || !hasDate) fails.push(`S3 现状行缺「下次：<日期>」（hasNext=${hasNext} hasDate=${hasDate}）`)
    else oks.push('S3 现状行含阶段 + 下次日期')

    /* S4 */
    const main = card.buttons.find((b) => b.page)
    const primer = card.buttons.find((b) => /primer/.test(b.action))
    if (!main) fails.push('S4 缺主按钮（进入当前阶段核心页）')
    else oks.push(`S4 主按钮 → ${main.page}「${main.text.slice(0, 20)}」`)
    if (!primer) fails.push('S4 缺副按钮「疾病概要」（36 号浮窗入口）')
    else oks.push(`S4 副按钮 → 疾病概要「${primer.text.slice(0, 24)}」`)

    /* S6：大字里的 N 必须等于读模型的 anchorDays；反之，有 anchorDays 就不许显示「待初始化」。
       后一半是关键：初版 bug 正是"有天数却走降级分支"，此时 S2 会放过「待初始化」，
       只有这条能直接指出根因（条件里引用了一个不存在的字段）。 */
    const m = card.big.match(/第\s*(\d+)\s*天/)
    const hasExpect = Number.isFinite(Number(expectDays))
    if (card.big === '待初始化' && hasExpect) {
      fails.push(`S6 读模型有 anchorDays=${expectDays}，卡片却显示「待初始化」——`
        + '降级分支的判断条件写错了（常见原因：引用了数据里不存在的字段），有天数被误判成无天数')
    } else if (m && hasExpect) {
      if (Number(m[1]) !== Number(expectDays)) {
        fails.push(`S6 大字显示第 ${m[1]} 天，但读模型 anchorDays=${expectDays}——天数必须由锚点派生，不许手填或偏差`)
      } else oks.push(`S6 天数 = anchorDays = ${expectDays}（由锚点派生）`)
    } else if (card.big !== '待初始化' && !m) {
      fails.push(`S6 大字「${card.big}」既不是「第 N 天」也不是「待初始化」`)
    } else if (card.big === '待初始化') {
      oks.push('S6 无 anchorDays → 正确走「待初始化」降级分支')
    }
  }
} catch (e) {
  fails.push(`运行异常：${e?.message || e}`)
} finally {
  await stopChrome(ch)
}

if (fails.length) {
  console.error('✗ 看板状态卡四件断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 看板状态卡四件：${oks.length} 条通过（卡头 / 大字天数 / 现状行 / 出口按钮 / 降级分支 / 天数派生）`)
