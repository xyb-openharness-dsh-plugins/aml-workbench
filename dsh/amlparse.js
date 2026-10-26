/**
 * 小橙宝的指标抽取器（六部件之一：dsh/amlparse.js）。
 *
 * 输入是 MinerU 的 full.md；输出是**候选**（field/value/src 三元组），不是记录。
 *
 * AML 字典只认这条病程里会反复出现的项：ANC（中性粒细胞绝对值）、WBC、Hb、PLT、
 * 原始细胞比例、血清铁蛋白、CRP、LDH。**不含任何"是否缓解/是否复发"的字段**——
 * 抽取只抄写，判读归血液科团队（K3：MRD 与复发判定都不在抽取层）。
 *
 * 三条家族纪律（docs/18 §8 + AML K2/K3）：
 * 1. 表格先 htmlTablesToPipes() 再按位置对齐（第 i 个指标名配第 i 个数），
 *    数量不符整行放弃，不做模糊匹配；
 * 2. 单位先剥 LaTeX 外壳（`$10^9/L$` → `10^9/L`）再比对；
 * 3. 只抄写不推测：参考区间两数一格的行整行放弃；`<0.5` 这类留原文；
 *    MRD 一律不抽（双口径、方法不同不可换算，必须人工录入）。
 */

/** 指标字典：aliases → 候选 field 名（与 CATALOG / metric_def 的 code 对应）。 */
export const LAB_DICT = [
  { key: 'ANC', name: 'ANC（中性粒细胞绝对值）', aliases: ['中性粒细胞绝对值', 'ANC', '中性粒细胞计数', '中性粒细胞'], unit: '×10⁹/L' },
  { key: 'WBC', name: 'WBC（白细胞）', aliases: ['白细胞', 'WBC', '白细胞计数'], unit: '×10⁹/L' },
  { key: 'Hb', name: 'Hb（血红蛋白）', aliases: ['血红蛋白', 'Hb', 'HGB'], unit: 'g/L' },
  { key: 'PLT', name: 'PLT（血小板）', aliases: ['血小板', 'PLT', '血小板计数'], unit: '×10⁹/L' },
  { key: 'BLAST', name: '原始细胞比例', aliases: ['原始细胞', '原始细胞比例', '骨髓原始细胞', 'blasts'], unit: '%' },
  { key: 'SF', name: '血清铁蛋白', aliases: ['血清铁蛋白', '铁蛋白', 'SF'], unit: 'μg/L' },
  { key: 'CRP', name: 'C 反应蛋白', aliases: ['C反应蛋白', 'C 反应蛋白', 'CRP', '超敏C反应蛋白'], unit: 'mg/L' },
  { key: 'LDH', name: '乳酸脱氢酶', aliases: ['乳酸脱氢酶', 'LDH'], unit: 'U/L' },
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 词边界匹配：中文别名用前后断言（\b 对中文无效）。 */
function aliasHit(text, alias) {
  const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRe(alias)}(?![A-Za-z0-9-])`, 'i')
  return re.test(text)
}

const decodeEntities = (text) => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/** markdown 里的 HTML 表格 → `| a | b |` 管道行。colspan 不补位（宁可少抽不串位）。 */
export function htmlTablesToPipes(md) {
  if (!/<table/i.test(String(md ?? ''))) return String(md ?? '')
  return String(md).replace(/<table[\s\S]*?<\/table>/gi, (block) => {
    const out = []
    for (const row of block.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const tds = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
      if (tds.length) out.push(`| ${tds.join(' | ')} |`)
    }
    return out.join('\n')
  })
}

/** 单位先剥 LaTeX 外壳（$10^9/L$ → 10^9/L）再归一空白。 */
export function normalizeUnit(unit) {
  return String(unit ?? '').trim()
    .replace(/^\$\s*(.+?)\s*\$$/, '$1')
    .replace(/\\times/g, '×')
    .replace(/\\mu/g, 'μ')
    .replace(/\s+/g, '')
}

/** 认识的单位集合（含 ×10⁹/L 与 10^9/L 两种常见写法）。 */
const UNIT_RE = /^(×10[⁹9]\/L|10\^?9\/L|g\/L|g\/dL|%|μg\/L|ug\/L|ng\/mL|mg\/L|mg\/dL|U\/L|IU\/L|mmol\/L|μmol\/L|umol\/L|10\^?12\/L)$/i

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}
const isTableLine = (line) => line.trim().startsWith('|') && line.trim().endsWith('|')
const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim())

const NUM_RE = /^(?:[<>≤≥]\s*)?-?\d+(?:\.\d+)?$/
/** 单一可抄写值：纯数字 / <0.5 这类带比较符的原文；参考区间（两数一格）一律不要。 */
function valueOf(cell) {
  const t = String(cell).replace(/\s/g, '')
  if (!t) return null
  if (/^[<>≤≥]/.test(t)) {
    const m = t.match(/^([<>≤≥])(-?\d+(?:\.\d+)?)$/)
    return m ? { raw: `${m[1]}${m[2]}`, num: null } : null
  }
  if (!NUM_RE.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? { raw: t, num: n } : null
}

/** MRD 相关行一律不抽：双口径、跨方法不可换算，必须人工录入（K3）。 */
const MRD_ROW = /MRD|残留病|流式|RQ-?PCR|NPM1\s*突变定量/i

/**
 * 从 markdown 抽候选。
 * @returns {{candidates: Array, skipped: Array}} candidates 每项 {key, field, value, unit, line}
 */
export function extractLabCandidates(markdown) {
  const md = htmlTablesToPipes(markdown)
  const candidates = []
  const skipped = []
  const seen = new Set()

  const lines = md.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    if (!isTableLine(lines[i])) { i += 1; continue }

    const start = i
    while (i < lines.length && isTableLine(lines[i])) i += 1
    const blockLines = lines.slice(start, i).filter((l) => !isSeparator(l))
    if (blockLines.length < 2) continue

    const header = cells(blockLines[0])
    const idxName = header.findIndex((h) => /项目|指标|名称|检验|item|test/i.test(h))
    const idxVal = header.findIndex((h) => /结果|数值|value|result/i.test(h))
    const idxUnit = header.findIndex((h) => /单位|unit/i.test(h))
    if (idxName === -1 || idxVal === -1) continue

    for (const line of blockLines.slice(1)) {
      const row = cells(line)
      const name = row[idxName] ?? ''
      if (MRD_ROW.test(name)) {
        skipped.push({ name, cell: row[idxVal] ?? '', reason: 'MRD 不自动抽（双口径、方法不同不可换算，需人工录入）' })
        continue
      }
      const hit = LAB_DICT.find((d) => d.aliases.some((a) => aliasHit(name, a)))
      if (!hit) continue
      const val = valueOf(row[idxVal] ?? '')
      if (!val) {
        skipped.push({ name, cell: row[idxVal] ?? '', reason: '不是单一数值（参考范围/文字）' })
        continue
      }
      const unitCell = idxUnit >= 0 ? normalizeUnit(row[idxUnit] ?? '') : ''
      if (unitCell && !UNIT_RE.test(unitCell)) {
        skipped.push({ name, cell: unitCell, reason: '单位不认识' })
        continue
      }
      const dedupe = `${hit.key}:${val.raw}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      candidates.push({
        key: hit.key,
        field: hit.name,
        value: val.num === null ? val.raw : val.num,
        unit: unitCell || hit.unit,
        line: start + 1,
      })
    }
  }
  return { candidates, skipped }
}

/** 报告日期：文件名或正文里的 YYYY-MM-DD / YYYY年M月D日。取不到就是 null（不猜今天）。 */
export function guessReportDate(text, fallback = null) {
  const m = String(text ?? '').match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (!m) return fallback
  const [_, y, mo, d] = m
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
