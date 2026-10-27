#!/usr/bin/env node
/**
 * 疾病概要 §2.5 链接完整性断言（36 号 v2）
 *
 * 判据（docs/36-DISEASE-PRIMER.md §2.5，2026-10-27 硬约束）：
 *   L1 `sources` 里 original:true 的行必须有 https:// 的 url
 *   L2 `sources` 里 original:false 的行必须有 https:// 的 secondaryUrl
 *   L3 `evidence` 表的「原件」列：字符串纯文字 → 违规；对象 {text,url} 且 url 必须 https
 *   L4 显式 nolink:true 的行放行，但 note 必须说明原因（说明行 / 本仓文件 / 无对应文件）
 *   L5 不得出现 http:// 或 javascript: 等非 https 协议
 *   L6 url 不得只是域名首页（形如 https://example.com 或 https://example.com/）——
 *      §2.5 要的是"能打开到原件或二次来源"，域名首页等于让人自己去找
 *
 * 为什么需要这个文件（2026-10-27 AML 实测）：
 *   初版 12 条来源里有 3 条不可用——NCI 链接 404（路径写错成 myeloproliferative/hp）、
 *   CSCO 指向无法解析的 csco.ac.cn、nhsa 只给域名首页。这些都不会让任何探针变红：
 *   探针只验"四段齐全 + 有来源"，不验"链接点开有没有东西"。
 *   而 36 号 §2.5 存在的意义正是"患者能点开看到原件"。
 *
 * 用法：node scripts/check-primer-links.mjs
 * 退出码：0 通过 / 1 有硬问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'prototypes/v0.2/primer-data.js')

const fails = []
const oks = []

const src = readFileSync(DATA, 'utf8')
const sandbox = { window: {} }
try {
  new Function('window', src)(sandbox.window)
} catch (e) {
  console.error(`✗ primer-data.js 求值失败：${e.message}`)
  process.exit(1)
}
const primer = sandbox.window.DISEASE_PRIMER
if (!primer) {
  console.error('✗ primer-data.js 没有设置 window.DISEASE_PRIMER')
  process.exit(1)
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u)
/** 只到域名/根路径的链接：能打开但没有指向具体内容 */
const isBareDomain = (u) => {
  try {
    const p = new URL(u)
    return (p.pathname === '/' || p.pathname === '') && !p.search && !p.hash
  } catch { return true }
}
const checkUrl = (u) => {
  if (!isHttps(u)) return '必须是 https:// 链接'
  if (isBareDomain(u)) return '不能只给域名首页（§2.5 要求能打开到原件或二次来源）'
  return null
}

let checked = 0

for (const sec of primer.sections || []) {
  /* L1/L2/L4/L5/L6：sources */
  for (const [i, s] of (sec.sources || []).entries()) {
    const at = `${sec.id}.sources[${i}]（${s.org || '?'}）`
    checked++
    if (s.nolink) {
      /* L4：显式放行，但必须有 note 说明 */
      if (!s.note) fails.push(`L4 ${at} 标了 nolink:true 但没有 note 说明原因`)
      else oks.push(`L4 ${at} nolink 有说明`)
      continue
    }
    if (s.original === true) {
      const bad = checkUrl(s.url)
      if (bad) fails.push(`L1 ${at} original:true 的 url ${bad}（当前：${s.url || '缺失'}）`)
      else oks.push(`L1 ${at} 原件链接可点`)
    } else {
      const bad = checkUrl(s.secondaryUrl)
      if (bad) fails.push(`L2 ${at} original:false 的 secondaryUrl ${bad}（当前：${s.secondaryUrl || '缺失'}）`)
      else oks.push(`L2 ${at} 二次来源可点`)
    }
    /* L5：禁止非 https（含 http:// 与 javascript:） */
    for (const [k, v] of [['url', s.url], ['secondaryUrl', s.secondaryUrl]]) {
      if (v && !isHttps(v)) fails.push(`L5 ${at} 的 ${k} 不是 https：${String(v).slice(0, 60)}`)
    }
  }

  /* L3：evidence 表的「原件」列 */
  const t = sec.table
  if (t && Array.isArray(t.rows)) {
    const colIdx = (t.head || []).findIndex((h) => String(h).includes('原件'))
    if (colIdx < 0) {
      fails.push(`L3 ${sec.id} 的表格没有「原件」列（§2.5 要求该列可点）`)
    } else {
      for (const [ri, row] of t.rows.entries()) {
        checked++
        const cell = row[colIdx]
        const at = `${sec.id}.table[${ri}]（${String(row[0] || '?').slice(0, 18)}）`
        if (cell && typeof cell === 'object') {
          const bad = checkUrl(cell.url)
          if (bad) fails.push(`L3 ${at} 原件列对象里的 url ${bad}（当前：${cell.url || '缺失'}）`)
          else oks.push(`L3 ${at} 原件列可点`)
        } else if (typeof cell === 'string' && cell.trim()) {
          fails.push(`L3 ${at} 原件列是纯文字「${cell}」——§2.5 不允许只写文字，须改成 {text,url} 可点对象`)
        } else {
          fails.push(`L3 ${at} 原件列为空`)
        }
      }
    }
  }
}

/* 汇总：至少检查到一定数量，防止"结构变了导致一条都没查"的假通过 */
if (checked < 10) fails.push(`只检查到 ${checked} 个链接位（预期 ≥10）——结构可能变了，本断言已失效`)

if (fails.length) {
  console.error('✗ 疾病概要链接完整性断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 疾病概要链接完整：${oks.length} 条通过（L1 原件 / L2 二次来源 / L3 表格原件列 / L4 nolink 说明 / L5 仅 https / L6 非域名首页）`)
