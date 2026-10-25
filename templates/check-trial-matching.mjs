#!/usr/bin/env node
/**
 * check-trial-matching.mjs — 试验匹配"三态+无判读"断言（35 号 §四）
 *
 * 用法：node scripts/check-trial-matching.mjs <项目根>
 * 断言：
 *   T1 出现匹配输出 ⇒ 必须含"无法自动匹配"（三态词）
 *   T2 禁止 match_score/eligible/suitability 判读列或综合分字面量
 *   T3 结果渲染必须含"未核实"与快照日期
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const problems = []
const sources = []
for (const dir of ['dsh', 'src', 'public']) {
  const p = join(root, dir)
  if (existsSync(p)) for (const f of readdirSync(p).filter((x) => x.endsWith('.js'))) sources.push(join(dir, f))
}
const texts = sources.map((f) => ({ f, s: readFileSync(join(root, f), 'utf8') }))

// 触发条件：存在明确匹配模块（trialMatch 符号/路由或"匹配引擎"标注）才启用三态断言；
// 只提到"试验"与"匹配"二词的仓（如一期演示线）不算实现，跳过不误报。
const implemented = texts.filter(({ s }) => /trialMatch|trial_match|matchTrials|匹配引擎/.test(s))
const hasMatch = implemented
if (hasMatch.length) {
  const all = hasMatch.map(({ f, s }) => ({ f, s })).filter(({ s }) => /命中|match/.test(s))
  if (all.length && !all.some(({ s }) => s.includes('无法自动匹配'))) problems.push('T1 有匹配输出但无"无法自动匹配"三态词')
  for (const { f, s } of texts) {
    if (/match_score|matchScore|suitability/i.test(s)) problems.push(`T2 ${f} 出现综合分字面量（match_score/suitability）`)
    if (/\beligible\b|eligib_/.test(s) && /CREATE TABLE|schema/i.test(s)) problems.push(`T2 ${f} 出现 eligible 判读列`)
  }
  if (!hasMatch.some(({ s }) => s.includes('未核实'))) problems.push('T3 匹配结果未含"未核实"字样')
  if (!hasMatch.some(({ s }) => /snapshot|快照/i.test(s))) problems.push('T3 匹配结果未含快照日期语境')
}
if (problems.length) { console.error('✗ 试验匹配断言失败：\n- ' + problems.join('\n- ')); process.exit(1) }
console.log(`✓ 试验匹配契约（${sources.length} 个 JS 文件扫描：三态词/无判读列/未核实+快照）`)
