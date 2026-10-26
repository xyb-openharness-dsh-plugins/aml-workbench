#!/usr/bin/env node
/**
 * 粒缺发热判定断言（K2 · 定义口径不可退化）
 *
 * 为什么需要这个文件（2026-10-26 AML M2 实测）：
 *   初版写的是 `if (val >= 38.3 || val >= 38.0) feverFlag(...)`。
 *   这在数学上等价于 `val >= 38.0`——定义里的「持续 >1 小时」条件被整个丢掉，
 *   于是单次 38.1℃ 也会弹「这是急症信号」。
 *   症状很隐蔽：探针全绿（弹窗确实弹了）、文案也对（文案里写着"持续>1h"），
 *   只有判定逻辑与文案不一致。这正是「文案对 ≠ 逻辑对」。
 *
 * 判据来源：中国中性粒细胞缺乏伴发热患者抗菌药物临床应用指南（2020 年版）
 *   口腔温度单次 ≥38.3℃，或 ≥38.0℃ 持续超过 1 小时；且 ANC<0.5×10⁹/L 或预计 48h 内降至 0.5 以下。
 *
 * 做法：把 app.js 里的 classifyTemp 抽出来在 Node 里直接跑（它不依赖 DOM），
 *      对 6 个边界用例断言分流结果。这样判定逻辑被真实执行，不是靠正则猜。
 *
 * 用法：node scripts/check-fever-rule.mjs
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

/* 抽出 classifyTemp 及其三个常量，在隔离作用域里求值。
   不 eval 整个 app.js：它有 DOM 依赖，会直接崩。 */
function extractBlock(name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return null
  let depth = 0, started = false
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1) }
  }
  return null
}

const consts = ['FEVER_SINGLE', 'FEVER_SUSTAINED', 'FEVER_SUSTAINED_MS']
  .map((n) => {
    const m = src.match(new RegExp(`const ${n} = ([^;]+);`))
    return m ? `const ${n} = ${m[1]};` : null
  })

if (consts.some((c) => c === null)) {
  fails.push(`找不到阈值常量（${consts.map((c, i) => (c ? null : ['FEVER_SINGLE', 'FEVER_SUSTAINED', 'FEVER_SUSTAINED_MS'][i])).filter(Boolean).join('、')}）——判定逻辑可能被重写，请同步本断言`)
}

const fn = extractBlock('classifyTemp')
if (!fn) fails.push('找不到 classifyTemp()：粒缺发热判定必须是一个可单独执行、可断言的函数（不要内联在事件处理里）')

if (!fails.length) {
  let classifyTemp
  try {
    classifyTemp = new Function(`${consts.join('\n')}\n${fn}\nreturn classifyTemp;`)()
  } catch (e) {
    fails.push(`classifyTemp 无法在隔离环境执行：${e.message}`)
  }

  if (classifyTemp) {
    const T = (h, m) => `2026-10-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const cases = [
      {
        name: '单次 38.5℃ → 急症（≥38.3 单次即成立）',
        ts: T(22, 10), v: 38.5, prior: [],
        want: 'fever',
        why: '38.3 线是"单次即成立"，不该被时长条件绑住'
      },
      {
        name: '单次 38.3℃（恰在线上）→ 急症',
        ts: T(22, 10), v: 38.3, prior: [],
        want: 'fever',
        why: '边界值含等号'
      },
      {
        name: '单次 38.1℃、无更早记录 → 观察（不是急症）',
        ts: T(22, 10), v: 38.1, prior: [],
        want: 'watch',
        why: '这正是初版的错：38.1 不该弹急症，定义要求 ≥38.0 持续>1h'
      },
      {
        name: '38.1℃ 且有 90 分钟前的 38.2℃ → 急症（持续>1h 成立）',
        ts: T(22, 10), v: 38.1, prior: [{ ts: T(20, 40), v: 38.2 }],
        want: 'fever',
        why: '跨度 90 分钟 ≥60 分钟，定义成立'
      },
      {
        name: '38.1℃ 且只有 30 分钟前的 38.2℃ → 观察（时长不足）',
        ts: T(22, 10), v: 38.1, prior: [{ ts: T(21, 40), v: 38.2 }],
        want: 'watch',
        why: '跨度 30 分钟 <60 分钟，不成立'
      },
      {
        name: '37.5℃ → 不触发（未达 38.0 线）',
        ts: T(22, 10), v: 37.5, prior: [],
        want: 'none',
        why: '低于 38.0 不进发热分流'
      },
      {
        name: '38.1℃ 且 2 小时前是 37.9℃（未达 38.0）→ 观察',
        ts: T(22, 10), v: 38.1, prior: [{ ts: T(20, 10), v: 37.9 }],
        want: 'watch',
        why: '持续条件要求"在 38.0 以上"持续，37.9 不计入'
      },
      {
        name: '数值无效（NaN）→ 不触发',
        ts: T(22, 10), v: Number('abc'), prior: [],
        want: 'none',
        why: '非法输入不得进入分流'
      }
    ]

    for (const c of cases) {
      let got
      try { got = classifyTemp(c.ts, c.v, c.prior) } catch (e) { fails.push(`${c.name}：抛异常 ${e.message}`); continue }
      if (got.level === c.want) oks.push(`${c.name}`)
      else fails.push(`${c.name}：期望 ${c.want}，实得 ${got.level}（${got.why}）——${c.why}`)
    }

    /* 元断言：证明这套用例真能抓到初版那个 bug。
       把初版逻辑（v>=38.3 || v>=38.0）写回来，它必须让"单次 38.1"用例失败。 */
    const buggy = (ts, v) => (v >= 38.3 || v >= 38.0 ? 'fever' : 'none')
    if (buggy(T(22, 10), 38.1) === 'fever') oks.push('元断言：初版逻辑确实会把单次 38.1℃ 判成急症（本断言能抓住它）')
    else fails.push('元断言失败：无法复现初版缺陷，说明用例设计没覆盖到退化点')
  }
}

if (fails.length) {
  console.error('✗ 粒缺发热判定断言失败：')
  for (const f of fails) console.error('  - ' + f)
  console.error(`  （通过 ${oks.length} 条）`)
  process.exit(1)
}
console.log(`✓ 粒缺发热判定：${oks.length}/${oks.length} 条用例通过（38.3 单次 / 38.0 持续>1h / 边界 / 无效值 + 元断言）`)
