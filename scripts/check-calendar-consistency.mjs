#!/usr/bin/env node
/**
 * 诱导日历一致性断言（K1 · 天数结构不可自相矛盾）
 *
 * 为什么需要这个文件（2026-10-26 AML M2 实测，独立评审发现）：
 *   dayGrid 的高亮带里，骨穿复核窗口标的是 D21–D28，但它的标签写着
 *   「停化疗后 7–14 天」——7+3 的化疗占 D1–D7，停化疗是 D8，
 *   按标签自己的定义窗口应该是 D15–D22。更直接的证据：D15（2026-05-28）
 *   真有一条「骨穿复核」记录。也就是说，**带的位置、标签、实际记录三者不一致**，
 *   而所有既有探针都全绿——它们只数"有几条带"，不验"带对不对"。
 *
 * 判据（对每个档案的每个疗程日历）：
 *   C1 daily 的 day_index 必须等于 floor((d − anchor)/DAY)+1，且连续不跳号
 *   C2 化疗日（有 marks）必须从 D1 起连续，且 nadir 带必须紧接最后一个化疗日之后
 *   C3 bx 带的起点必须等于「最后一个化疗日 + 7」，终点等于「最后一个化疗日 + 14」
 *      （即"停化疗后第 7–14 天"，含两端）
 *   C4 若 daily 里存在标记为骨穿的记录（notes 含「骨穿」），它必须落在 bx 带内
 *   C5 nadir / bx 带不得互相重叠，也不得越出 daily 覆盖范围
 *
 * 用法：node scripts/check-calendar-consistency.mjs
 * 退出码：0 通过 / 1 有硬问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'prototypes/v0.2/demo-data.js')
const DAY = 86400000

const src = readFileSync(DATA, 'utf8')
const m = src.match(/window\.DEMO_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)
if (!m) {
  console.error('✗ 解析不到 window.DEMO_DATA（demo-data.js 结构变了？）')
  process.exit(1)
}
const data = JSON.parse(m[1])

const fails = []
const oks = []
const dayOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

for (const p of data.profiles || []) {
  const who = p.name || '(未命名)'
  const cal = p?.tx?.calendar
  if (!cal) { fails.push(`${who}: 没有 tx.calendar（K1 要求诱导/巩固都按天）`); continue }
  const daily = cal.daily || []
  if (!daily.length) { fails.push(`${who}: calendar.daily 为空`); continue }

  /* C1 天数派生 */
  const bad = daily
    .map((row) => ({ d: row.d, got: row.day, exp: dayOf(cal.anchor, row.d) + 1 }))
    .filter((x) => x.got !== x.exp)
  if (bad.length) fails.push(`${who}: C1 day_index 与 anchor 不符 ${bad.length} 处（例 ${bad[0].d} 标 D${bad[0].got}，应为 D${bad[0].exp}）`)
  else oks.push(`${who}: C1 day_index 全部由 anchor 派生（${daily.length} 天）`)

  const days = daily.map((r) => r.day)
  const gaps = days.filter((d, i) => i > 0 && d !== days[i - 1] + 1)
  if (gaps.length) fails.push(`${who}: C1 daily 跳号（断点 ${gaps.slice(0, 3).join(',')}）`)
  else oks.push(`${who}: C1 daily 连续无跳号 D${days[0]}–D${days[days.length - 1]}`)

  const bands = cal.bands || []
  const bandOf = (kind) => bands.find((b) => b.kind === kind)

  /* C2 化疗日连续 + nadir 紧接其后。
     两种方案形态要分开判：
     ① 短程强化（7+3 类）：化疗集中在开头几天，之后停药 → 谷值带应紧接停化疗日；
     ② 连续给药（ven+aza 28 天周期类）：化疗贯穿整个周期，**没有"停化疗"节点** →
        谷值带不由停化疗日推出，只能要求它落在周期内且不与化疗区完全错位。
     初版把 ② 也套 ①的公式，于是报了一条假失败（刘桂芳 D14 vs D29）。
     这是检查器的错，不是数据的错——修检查器，不改数据。 */
  const chemo = daily.filter((r) => (r.marks || []).length).map((r) => r.day)
  if (chemo.length) {
    const lastChemo = Math.max(...chemo)
    const lastDay = days[days.length - 1]
    const continuous = lastChemo === lastDay
    const chemoContig = chemo.every((d, i) => d === i + 1)
    if (!chemoContig) fails.push(`${who}: C2 化疗日不是从 D1 起连续（实际 ${chemo.join(',')}）`)
    else oks.push(`${who}: C2 化疗日 D1–D${lastChemo} 连续${continuous ? '（连续给药方案，无停化疗节点）' : ''}`)

    const nadir = bandOf('nadir')
    if (nadir && !continuous) {
      if (nadir.from !== lastChemo + 1) fails.push(`${who}: C2 谷值带应从 D${lastChemo + 1} 起（化疗结束次日），实际 D${nadir.from}`)
      else oks.push(`${who}: C2 谷值带紧接化疗结束（D${nadir.from}–D${nadir.to}）`)
    } else if (nadir) {
      if (nadir.from < 1 || nadir.to > lastDay) fails.push(`${who}: C2 连续给药方案的谷值带越界（D${nadir.from}–D${nadir.to}，周期 D1–D${lastDay}）`)
      else oks.push(`${who}: C2 连续给药方案谷值带在周期内（D${nadir.from}–D${nadir.to}，不套"停化疗后"公式）`)
    }

    /* C3 骨穿窗口 = 停化疗后第 7–14 天。
       只对"有停化疗节点"的方案成立；连续给药方案由医生按周期安排，
       本台不推算（推算就是替医生排计划）。 */
    const bx = bandOf('bx')
    if (bx && continuous) {
      oks.push(`${who}: C3 连续给药方案无骨穿推算带（符合"不替医生排计划"）`)
    } else if (bx) {
      const stop = lastChemo + 1
      const wantFrom = stop + 7
      const wantTo = stop + 14
      if (bx.from !== wantFrom || bx.to !== wantTo) {
        fails.push(`${who}: C3 骨穿带应为 D${wantFrom}–D${wantTo}（停化疗 D${lastChemo} 后 7–14 天），实际 D${bx.from}–D${bx.to}——`
          + `这正是 2026-10-26 修掉的缺陷：带的位置与它自己的标签矛盾`)
      } else oks.push(`${who}: C3 骨穿带 D${bx.from}–D${bx.to} 与「停化疗后 7–14 天」一致`)
    }

    /* C4 实际骨穿记录必须落在骨穿带内（没有骨穿带的方案跳过：不推算就不校验） */
    if (bx) {
      const bxNotes = daily.filter((r) => (r.notes || []).some((n) => String(n).includes('骨穿')))
      for (const r of bxNotes) {
        if (r.day < bx.from || r.day > bx.to) fails.push(`${who}: C4 D${r.day}（${r.d}）有骨穿记录，但不在骨穿带 D${bx.from}–D${bx.to} 内`)
      }
      if (bxNotes.length) oks.push(`${who}: C4 ${bxNotes.length} 条骨穿记录全部落在骨穿带内（D${bxNotes.map((r) => r.day).join('/')}）`)
    }
  }

  /* C5 带不重叠、不越界。
     端点相接（前一带 to == 后一带 from）是**相邻**不是重叠：
     刘桂芳的 nadir D14–D21 与 fever D21–D26 共用 D21，这是同一天既在谷值窗口
     又记录到发热——语义上正常，不该报红。只有 from < 前一带的 to 才是真重叠。 */
  const sorted = [...bands].sort((a, b) => a.from - b.from)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) {
      fails.push(`${who}: C5 带真重叠 ${sorted[i - 1].kind}(D${sorted[i - 1].from}–${sorted[i - 1].to}) 与 ${sorted[i].kind}(D${sorted[i].from}–D${sorted[i].to})`)
    }
  }
  const lo = days[0], hi = days[days.length - 1]
  for (const b of bands) {
    if (b.from < lo || b.to > hi) fails.push(`${who}: C5 带 ${b.kind}(D${b.from}–D${b.to}) 越出日历范围 D${lo}–D${hi}`)
  }
  if (bands.length && !fails.some((f) => f.startsWith(`${who}: C5`))) oks.push(`${who}: C5 ${bands.length} 条带无重叠、无越界`)
}

if (fails.length) {
  console.error('✗ 诱导日历一致性断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 诱导日历一致性：${oks.length} 条断言通过（${(data.profiles || []).length} 个档案 × C1–C5）`)
