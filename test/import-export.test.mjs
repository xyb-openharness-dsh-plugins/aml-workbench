/* 解析候选→待核对→确认入事实层（FAILED 如实）+ 导出 private 过滤与红线文案。
 *
 * MinerU 客户端注入假实现（不联网）；抽取层用真实 markdown 夹具。
 * 本台特有的三条：
 * - MRD 行**一律不自动抽**（双口径、跨方法不可换算，必须人工录入）；
 * - 原始细胞/铁蛋白/CRP 补进 metric_def 时 category 不是 cbc → 不进血象趋势；
 * - 解析失败要落 parse_failed 且**不产候选**（"云端失败就本地凑一份"是本台明令禁止的）。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase, migrate, close } from '../dsh/store.js'
import { seedDemo } from '../dsh/demo.js'
import { readDemoJson } from '../demo/build-demo-data.mjs'
import { extractLabCandidates, htmlTablesToPipes, normalizeUnit, guessReportDate, LAB_DICT } from '../dsh/amlparse.js'
import { parseAndRecord, listCandidates, acceptCandidate, rejectCandidate } from '../dsh/parse.js'
import { MineruError, resolveToken } from '../dsh/mineru.js'
import { renderPrepMarkdown, exportFilename } from '../dsh/export.js'
import { getProfile } from '../dsh/readmodels.js'

function openSeeded() {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDemo(db, readDemoJson())
  return db
}

/* ---------------- 抽取层（六部件之一：dsh/amlparse.js） ---------------- */

const LAB_MD = `# 血常规
| 项目 | 结果 | 单位 | 参考范围 |
| --- | --- | --- | --- |
| 中性粒细胞绝对值 | 0.42 | ×10⁹/L | 1.8–6.3 |
| 白细胞 | 1.9 | ×10⁹/L | 3.5–9.5 |
| 血红蛋白 | 68 | g/L | 130–175 |
| 血小板 | 12 | ×10⁹/L | 125–350 |
| 血清铁蛋白 | 820 | μg/L | 30–400 |
| 原始细胞 | 2.0 | % | — |`

test('① 管道表格按位置对齐：AML 五项各成候选，参考区间不充当结果', () => {
  const { candidates } = extractLabCandidates(LAB_MD)
  assert.deepEqual(candidates.map((c) => c.key), ['ANC', 'WBC', 'Hb', 'PLT', 'SF', 'BLAST'])
  assert.equal(candidates[0].value, 0.42)
  assert.equal(candidates[2].unit, 'g/L')
  assert.equal(candidates.at(-1).value, 2.0)
})

test('② HTML 表格先转管道再对齐（不转就会整表压成一行）', () => {
  const html = `<table><tr><td>项目</td><td>结果</td></tr><tr><td>血红蛋白</td><td>71</td></tr></table>`
  const md = htmlTablesToPipes(html)
  assert.match(md, /\| 血红蛋白 \| 71 \|/)
  const { candidates } = extractLabCandidates(html)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].value, 71)
})

test('③ 单位先剥 LaTeX 外壳；<0.5 留原文；两数一格（参考区间）整行放弃', () => {
  assert.equal(normalizeUnit('$10^9/L$'), '10^9/L')
  assert.equal(normalizeUnit('$\\times 10^9/L$'), '×10^9/L')
  const md = `| 项目 | 结果 | 单位 |\n| --- | --- | --- |\n| 中性粒细胞绝对值 | <0.5 | ×10⁹/L |\n| 血红蛋白 | 130–175 | g/L |`
  const { candidates, skipped } = extractLabCandidates(md)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].value, '<0.5', '不等式留原文，不四舍五入成 0')
  assert.ok(skipped.some((s) => /参考范围/.test(s.reason)), '两数一格必须放弃并说明')
})

test('③b K3：MRD / 流式 / PCR 行一律不自动抽，并说明"需人工录入"', () => {
  const md = `| 项目 | 结果 | 单位 |
| --- | --- | --- |
| 流式 MRD（LAIP） | 0.08 | % |
| NPM1 突变定量 PCR | 0.32 | % |
| 血红蛋白 | 68 | g/L |`
  const { candidates, skipped } = extractLabCandidates(md)
  assert.deepEqual(candidates.map((c) => c.key), ['Hb'], '只有普通化验进候选')
  const mrdSkips = skipped.filter((s) => /MRD/.test(s.reason ?? ''))
  assert.equal(mrdSkips.length, 2, '两条 MRD 行都要被显式跳过并说明原因')
})

test('④ 报告日期从文件名/正文取，取不到不猜', () => {
  assert.equal(guessReportDate('血常规2026-10-13.pdf'), '2026-10-13')
  assert.equal(guessReportDate('报告 2026年10月13日.png'), '2026-10-13')
  assert.equal(guessReportDate('无名文件.pdf'), null)
})

test('④b 字典不含判读类字段：没有"缓解/复发/疗效/危险度"', () => {
  const names = LAB_DICT.flatMap((d) => [d.key, d.name, ...d.aliases]).join(' ')
  assert.equal(/缓解|复发|疗效|危险度|预后/i.test(names), false, '抽取层只抄数值，不产判读字段')
})

/* ---------------- 编排层（六部件之一：dsh/parse.js） ---------------- */

const fakeClient = (markdown) => ({ parse: async () => ({ markdown, pages: 2 }) })
const failingClient = { parse: async () => { throw new MineruError('TASK_FAILED', '云端解析失败：demo') } }

test('⑤ 解析成功：document=parsed、候选挂待核对、成功不碰事实表', async () => {
  const db = openSeeded()
  const before = db.prepare('SELECT COUNT(*) AS n FROM metric_point WHERE in_use=1').get().n
  const r = await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '血常规2026-10-13.pdf', profileId: 'demo1', client: fakeClient(LAB_MD) })
  assert.equal(r.status, 'parsed')
  assert.equal(r.candidates.length, 6)
  const pending = listCandidates(db, { documentId: r.documentId })
  assert.equal(pending.length, 6)
  assert.ok(pending.every((c) => c.state === 'pending'))
  const after = db.prepare('SELECT COUNT(*) AS n FROM metric_point WHERE in_use=1').get().n
  assert.equal(after, before, '确认之前候选不许进事实层')
  close(db)
})

test('⑥ FAILED 如实：解析失败 document=parse_failed、不产候选、异常抛回', async () => {
  const db = openSeeded()
  await assert.rejects(
    () => parseAndRecord(db, { bytes: Buffer.from('fake'), filename: 'bad.pdf', profileId: 'demo1', client: failingClient }),
    /云端解析失败/,
  )
  const doc = db.prepare("SELECT status FROM document WHERE file_name='bad.pdf' ORDER BY id DESC").get()
  assert.equal(doc.status, 'parse_failed', '失败状态必须如实落库（可重试）')
  const pending = listCandidates(db).filter((c) => c.src.startsWith('bad.pdf'))
  assert.equal(pending.length, 0, '解析失败不许产候选')
  close(db)
})

test('⑦ 白名单守卫：.html/.txt 不发请求，直接给可诊断错误', async () => {
  const db = openSeeded()
  await assert.rejects(() => parseAndRecord(db, { bytes: Buffer.from('x'), filename: 'a.html', profileId: 'demo1', client: fakeClient('') }), /不支持的文件类型/)
  await assert.rejects(() => parseAndRecord(db, { bytes: Buffer.from('x'), filename: 'a.txt', profileId: 'demo1', client: fakeClient('') }), /不支持的文件类型/)
  await assert.rejects(() => parseAndRecord(db, { bytes: Buffer.from('x'), filename: 'a.pdf', profileId: 'nope', client: fakeClient('') }), /没有这个档案/)
  close(db)
})

test('⑧ 确认入事实层：Hb 落 metric_point 且进趋势；铁蛋白/原始细胞分类不进趋势；拒收零副作用', async () => {
  const db = openSeeded()
  const r = await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '血常规2026-10-13.pdf', profileId: 'demo1', client: fakeClient(LAB_MD) })
  const pending = listCandidates(db, { documentId: r.documentId })

  const hb = pending.find((c) => c.key === 'Hb')
  const hbRes = acceptCandidate(db, hb.id)
  assert.equal(hbRes.category, 'cbc')
  const point = db.prepare("SELECT value_num, in_use, revision FROM metric_point WHERE code='Hb' ORDER BY id DESC").get()
  assert.equal(point.value_num, 68)
  assert.equal(point.in_use, 1)
  assert.equal(point.revision, 1)
  assert.equal(getProfile(db, 'demo1').metrics.numeric.Hb.length, 7, 'Hb 序列从 6 条变 7 条')
  /* 历史不丢：旧点仍在，只是多了一条。 */
  assert.ok(getProfile(db, 'demo1').metrics.numeric.Hb.some((x) => x.d === '2026-05-12'))

  const sf = pending.find((c) => c.key === 'SF')
  const sfRes = acceptCandidate(db, sf.id)
  assert.equal(sfRes.category, 'inflammation', '铁蛋白不进血象趋势')
  assert.equal('SF' in getProfile(db, 'demo1').metrics.numeric, false, '趋势里不许出现铁蛋白')
  assert.equal(getProfile(db, 'demo1').ferritin.length, 2, '铁蛋白走独立列（demo1 原有 1 条 + 新增 1 条）')

  const blast = pending.find((c) => c.key === 'BLAST')
  const blastRes = acceptCandidate(db, blast.id)
  assert.equal(blastRes.category, 'marrow', '原始细胞比例不进血象趋势（那是骨穿/MRD 语境的原文）')

  rejectCandidate(db, pending.find((c) => c.key === 'WBC').id)
  const rest = listCandidates(db, { documentId: r.documentId })
  assert.equal(rest.length, 5, '三条已确认 + 两条仍待核对；拒收的直接移除')
  assert.equal(rest.filter((c) => c.state === 'accepted').length, 3)
  assert.equal(rest.filter((c) => c.key === 'WBC').length, 0)
  assert.throws(() => rejectCandidate(db, 'nope'), /没有这条候选/)
  close(db)
})

/* ---------------- 设置层（六部件之一：dsh/settings.js） ---------------- */

test('⑧b Token 优先级：显式 > 密钥文件 > env（v1 写反过，这里钉住顺序）', () => {
  const env = { MINERU_TOKEN: 'sk-env-000000000000' }
  /* 三处都有：显式赢 */
  assert.equal(resolveToken({ token: 'sk-explicit-111111', env, secretFile: '/nonexistent/x.json' }).source, 'explicit')
  /* 没有显式与文件：env 兜底 */
  const envOnly = resolveToken({ token: null, env, secretFile: '/nonexistent/x.json' })
  assert.equal(envOnly.source, 'env:MINERU_TOKEN')
  /* 文件存在时文件赢 env（v2 定稿：文件排在 env 前面） */
  const dir = mkdtempSync(join(tmpdir(), 'aml-token-'))
  try {
    const file = join(dir, 'mineru.json')
    writeFileSync(file, JSON.stringify({ token: 'sk-file-2222222222' }))
    const byFile = resolveToken({ token: null, env, secretFile: file })
    assert.equal(byFile.source, 'secret-file')
    assert.equal(byFile.token, 'sk-file-2222222222')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⑧c 没有 Token 时报 NO_TOKEN 并给申请地址（不是静默匿名请求）', () => {
  const saved = process.env.MINERU_TOKEN
  const savedSecret = process.env.AML_MINERU_SECRET
  delete process.env.MINERU_TOKEN
  process.env.AML_MINERU_SECRET = '/nonexistent/secrets.json'
  try {
    assert.throws(() => resolveToken({ token: null }), (e) => {
      assert.equal(e.code, 'NO_TOKEN')
      assert.match(e.message, /mineru\.net\/apiManage\/token/, '错误里要给申请地址（原则 9）')
      return true
    })
  } finally {
    if (saved === undefined) delete process.env.MINERU_TOKEN
    else process.env.MINERU_TOKEN = saved
    if (savedSecret === undefined) delete process.env.AML_MINERU_SECRET
    else process.env.AML_MINERU_SECRET = savedSecret
  }
})

/* ---------------- 导出（dsh/export.js） ---------------- */

test('⑨ 导出 private 过滤：shared 感受带上否定语境抬头，private 原文绝不出现', () => {
  const db = openSeeded()
  const full = getProfile(db, 'demo1', { includePrivate: true })
  const md = renderPrepMarkdown(full, { version: '0.3.0', excludedPrivate: true })
  assert.match(md, /不是医生结论/)
  assert.match(md, /半夜醒来会想|盯着输液泵/, 'shared 原文要在导出里（否则等于整段没导出）')
  assert.equal(/后事都想了一遍|停车场坐了半小时/.test(md), false, 'private 原文零出现')
  assert.match(md, /有意排除/)
  close(db)
})

test('⑩ 导出无判读词，且两条 MRD 警示与零推荐/不判依赖常驻', async () => {
  const db = openSeeded()
  const full = getProfile(db, 'demo1', { includePrivate: true })
  const md = renderPrepMarkdown(full, {})
  assert.doesNotMatch(md, /建议调整|可以停药|结果正常|结果异常|不必担心/)
  assert.match(md, /转阴 ≠ 治愈/)
  assert.match(md, /阳性 ≠ 一定复发/)
  assert.match(md, /零推荐/)
  assert.match(md, /不判依赖/)
  assert.equal(exportFilename({ name: '张强（演示）' }).startsWith('就诊准备-张强（演示）-'), true, '文件名带人名与日期，便于门诊找')
  close(db)
  /* check-wording 脚本本体也跑一遍（作为测试内的第二道闸）。 */
  const { execFileSync } = await import('node:child_process')
  execFileSync('node', ['scripts/check-wording.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' })
})
