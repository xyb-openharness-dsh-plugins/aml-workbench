#!/usr/bin/env node
/**
 * 「今天能做的一件事」入口质量断言（G1 判断的固化）
 *
 * 为什么需要这个文件：
 *   看板上这组入口是患者**每天真正会点的地方**。它最典型的退化是：
 *     ① 变成页签名的搬运（"诱导日历""MRD 双口径""移植评估"）——患者得先知道那个页干什么才敢点；
 *     ② 重复指向同一页（AML 初版「粒缺发热（按铃）」与「体温代记（照护者）」都去 neu-fever）；
 *     ③ 写成专业名词（"双口径""评估档案"），刚确诊的人读不懂。
 *   这三类都不会让任何现有探针变红——它们只数"有几个入口"。
 *
 * 判据：
 *   Q1 入口数在 8–12 之间（少于 8 覆盖不足；多于 12 等于又造了一个导航栏）
 *   Q2 不得有两个入口指向完全相同的 (page, sub)
 *   Q3 标签必须是动作短语：包含动词性词（看/记/查/准备/登记/发烧/找/问/画/存），
 *      且不得直接等于左侧导航的页签名
 *   Q4 标签长度 ≤ 14 个汉字（长了在窄宽下换行、也读不完）
 *   Q5 必须存在"急症"类入口（含"发烧/发热/急"字样），否则最要紧那一刻找不到
 *
 * 用法：node scripts/check-quick-entries.mjs
 * 退出码：0 通过 / 1 有硬问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(ROOT, 'prototypes/v0.2/app.js')
const src = readFileSync(APP, 'utf8')

const fails = []
const oks = []

/* 取 QUICK 定义块 */
const m = src.match(/const QUICK = \{([\s\S]*?)\n  \};/)
if (!m) {
  console.error('✗ 找不到 const QUICK = {...}（看板入口清单）——若已改名请同步本断言')
  process.exit(1)
}
const entries = [...m[1].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)]
  .map((x) => ({ label: x[1], page: x[2], sub: x[3] }))

if (!entries.length) {
  console.error('✗ QUICK 里解析不到任何入口')
  process.exit(1)
}

/* Q1 数量 */
if (entries.length < 8 || entries.length > 12) {
  fails.push(`Q1 入口数 ${entries.length} 不在 8–12 之间（少于 8 覆盖不足，多于 12 等于又造一个导航栏）`)
} else oks.push(`Q1 入口数 ${entries.length}（8–12 区间内）`)

/* Q2 目标去重 */
const byTarget = new Map()
for (const e of entries) {
  const k = `${e.page}/${e.sub}`
  if (!byTarget.has(k)) byTarget.set(k, [])
  byTarget.get(k).push(e.label)
}
for (const [k, labels] of byTarget) {
  if (labels.length > 1) {
    fails.push(`Q2 「${k}」被 ${labels.length} 个入口指向：[${labels.join(' | ')}]——`
      + '两个入口去同一页时，患者分不清该点哪个；要么合并，要么让标签说清目的差别')
  }
}
if (![...byTarget.values()].some((v) => v.length > 1)) oks.push(`Q2 ${byTarget.size} 个目标页无重复入口`)

/* Q3 动作短语 + 不得等于页签名 */
const PAGES = [...src.matchAll(/\[\s*'([a-z]+)'\s*,\s*'([^']+)'\s*,\s*'[a-z]+'\s*\]/g)].map((x) => x[2])
const VERB = /[看记查准登发烧找问画存写填删改选切换听读讲说算比较]/
for (const e of entries) {
  if (!VERB.test(e.label)) fails.push(`Q3 「${e.label}」不像动作短语（缺动词：看/记/查/准备/登记…）——入口应写"我要做的那件事"，不是页名`)
  if (PAGES.includes(e.label)) fails.push(`Q3 「${e.label}」与左侧导航页签名完全相同——入口不该是导航的复制`)
}
if (!fails.some((f) => f.startsWith('Q3'))) oks.push('Q3 全部入口都是动作短语，且未直接复制页签名')

/* Q4 长度 */
const tooLong = entries.filter((e) => [...e.label].length > 14)
if (tooLong.length) fails.push(`Q4 标签超过 14 字：${tooLong.map((e) => `「${e.label}」(${[...e.label].length})`).join('、')}——窄宽下会换行且读不完`)
else oks.push('Q4 全部标签 ≤14 字')

/* Q5 急症入口 */
const urgent = entries.filter((e) => /发烧|发热|急/.test(e.label))
if (!urgent.length) fails.push('Q5 没有急症类入口（含"发烧/发热/急"）——最要紧那一刻会找不到')
else oks.push(`Q5 有 ${urgent.length} 条急症入口（${urgent.map((e) => e.label).join(' / ')}）`)

if (fails.length) {
  console.error('✗ 看板入口质量断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 看板入口质量：${oks.length} 条断言通过（数量 / 去重 / 动作短语 / 长度 / 急症入口）`)
