#!/usr/bin/env node
/**
 * 医疗与法律表述越界检查（AML K1–K6 红线）。
 *
 * 产品只提供信息，不做诊断、不给处置建议、不做移植推荐。AML 高发区：
 *  1) 出门/活动指导——"粒缺期能不能出门"只保留医生/护士答复原文，产品不自行指导；
 *  2) 移植推荐——零推荐（K4），只记录评估过程与医生答复原文；
 *  3) "MRD 阴性=治愈"——转阴≠治愈、阳性≠复发（K3）；
 *  4) 退烧药指导——不指导用药（K2）。
 *
 * 扫描范围：会被用户读到的实现代码——dsh/、lib/、public/、src/、demo/、prototypes/ 下 .js/.mjs/.html/.css。
 * 三种放行方式：
 *  1. 否定语境：命中词前 12 个字符内出现否定词（不/勿/禁/别/零/≠/不等于/不代表/不是…），放行；
 *  2. 引用语境：该行含「答复原文 / 院方原文 / 患教原文 / 医嘱 / 医生」等引用标记（引的是医生的话，不是产品在说）；
 *  3. 显式标注：该行含 `wording-allow` 注释（需写明原因）。
 *
 * 另含必现句断言（必现句 = 红线文案必须真的上屏，缺失即失败）。
 *
 * 用法：node scripts/check-wording.mjs；退出码 0/1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['dsh', 'lib', 'public', 'src', 'demo', 'prototypes']
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css'])

/** 越界表述：不是"提到疾病"，而是"替医生下结论 / 给处置 / 做推荐 / 判治愈复发"。 */
const RULES = [
  /* AML 1：出门/活动指导（答复原文引用放行——产品只保留医护原话） */
  { id: 'going-out-advice', re: /(不要|避免|禁止|尽量不?|可以|能|应(该|当)?)\s*(出门|外出|去人多)/g },
  /* AML 2：移植/供者推荐（零推荐 K4） */
  { id: 'transplant-recommend', re: /(推荐|建议|应该|应当|不妨|最好)\s*(你|您|患者)?[^。；]{0,10}(做|选|选?用|接受)?\s*(移植|半相合|全相合|供者|配型)/g },
  /* AML 3："MRD 阴性=治愈"（转阴≠治愈；单独"治愈"结论禁；含 ≠/不等于 的否定句放行） */
  { id: 'mrd-cure', re: /(转阴|阴性|MRD)[^。；\n]{0,8}(治愈|痊愈|彻底好了|没事了)/g, exempt: (seg) => /≠|不等于|不代表|不是/.test(seg) },
  /* AML 4：退烧药/用药指导 */
  { id: 'med-advice', re: /(吃|服用|服|用|打)\s*(点|点)?(退烧药|消炎药|抗生素)/g },
  /* 通用：复发/预后判定 */
  { id: 'relapse-claim', re: /(就是|一定是?|肯定|意味着|说明)\s*(复发|要复发了|快复发)/g },
  { id: 'prognosis-claim', re: /(预后|生存期)\s*(很好|不错|很差|还有|不足|大概)/g },
  { id: 'cure-rate', re: /治愈率|生存率|还能活/g },
  { id: 'diagnose-claim', re: /(确诊|诊断)\s*(为|就是)\s*(癌|肿瘤|恶性|白血病)/g },
]

/* 否定/引用放行语境 */
const NEGATION = /[不勿禁别零]$|≠|不等于|不等于|不代表|不构成|不是|并非|不做|不提供|不含|不给|不暗示|不出现|零推荐|不是推荐|解释不是判断/
const QUOTE = /答复原文|院方原文|患教原文|医嘱|医护|医生(答复|沟通|说|的)|护士答复|结论原文|报告原文|按医护指示/

function walk(dir) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (st.isFile() && EXTS.has(extname(entry))) out.push(full)
  }
  return out
}

const files = DIRS.flatMap((d) => walk(join(root, d)))
const hits = []
for (const file of files) {
  const rel = file.slice(root.length + 1)
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line))) {
        const before = line.slice(Math.max(0, m.index - 12), m.index)
        const after = line.slice(m.index, m.index + 24)
        if (rule.exempt && rule.exempt(m[0])) continue
        if (NEGATION.test(before)) continue
        if (QUOTE.test(line)) continue /* 引用语境：引的是医生/护士的话（本台只保留原文） */
        if (line.includes('wording-allow')) continue
        hits.push({ file: rel, line: i + 1, rule: rule.id, hit: after.trim().slice(0, 40) })
      }
    }
  })
}

/* ---- 必现句断言（红线文案必须上屏；在会被用户读到的文件里计数） ---- */
const REQUIRED = [
  { id: 'fever-def-383', re: /≥38\.3℃/g, min: 1, why: '粒缺发热定义原文（≥38.3℃）常驻（K2）' },
  { id: 'fever-def-anc', re: /ANC[^。\n]{0,20}0\.5/g, min: 1, why: '定义原文口径 ANC<0.5（K2）' },
  { id: 'untested-not-negative', re: /未检测 ≠ 阴性|未检测≠阴性/g, min: 2, why: '未检测≠阴性（dx 与 MRD 页）' },
  { id: 'fever-emergency', re: /急症/g, min: 3, why: '粒缺发热急症语境（K2）' },
  { id: 'ring-bell', re: /按铃/g, min: 2, why: '"一发烧就按铃"（K2）' },
  { id: 'dual-source-temp', re: /双源/g, min: 1, why: '双源体温（K6）' },
  { id: 'zero-rec', re: /零推荐/g, min: 2, why: '移植零推荐（K4）' },
  { id: 'trial-not-rec', re: /线索不是推荐/g, min: 2, why: '试验线索不是推荐（S12）' },
  { id: 'mrd-warn-cure', re: /转阴 ≠ 治愈|转阴≠治愈/g, min: 1, why: 'MRD 转阴≠治愈（K3）' },
  { id: 'mrd-warn-relapse', re: /阳性 ≠ 一定复发|阳性≠一定复发/g, min: 1, why: 'MRD 阳性≠复发（K3）' },
  { id: 'judgment-free', re: /解释不是判断/g, min: 2, why: '基因解释不是判断（dx）' },
  { id: 'no-dependency', re: /不判依赖/g, min: 1, why: '输注不判依赖（K5）' },
]
const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n')
const missing = []
for (const req of REQUIRED) {
  const n = (corpus.match(req.re) || []).length
  if (n < req.min) missing.push({ id: req.id, found: n, need: req.min, why: req.why })
}

if (hits.length || missing.length) {
  console.log(`check:wording FAIL — 禁词命中 ${hits.length} 处，必现句缺失 ${missing.length} 条：`)
  for (const h of hits.slice(0, 15)) console.log(`  禁词 [${h.rule}] ${h.file}:${h.line} → ${h.hit}`)
  for (const m of missing) console.log(`  必现句缺失 [${m.id}] found=${m.found}/${m.min} — ${m.why}`)
  process.exit(1)
} else {
  console.log(`check:wording PASS — 禁词 0（${RULES.length} 条规则 × ${files.length} 个文件）；必现句 ${REQUIRED.length}/${REQUIRED.length} 全部在场`)
}
