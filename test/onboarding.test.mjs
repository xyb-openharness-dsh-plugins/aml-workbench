/* 0.6.0 零治疗初始化三步闭环：建档 → 导入解析（候选：化验/诊断/治疗）→ 核对确认 → 事实层。
 *
 * 链路口径：
 * - 建档只在空 workspace 允许（已有档案幂等 existing，不新建）；bootstrap 带 needsOnboarding。
 * - import 只收 pdf/jpg/png/zip/docx/xlsx（.md/.txt 白名单不放开）——测试在 parse 层注入假
 *   MinerU 客户端（不联网），候选确认/拒收走真实 HTTP 路由。
 * - accept 按 kind 分流：化验→metric_point（既有语义不动）；diagnosis→diagnosis_record（原文）；
 *   treatment→必须带 {d1} → tx_phase 1 行 + tx_calendar_day 42 行（D1–7 药物，D8+ 谷值期）。
 * - reject 零副作用。schema/0001 不改（diagnosis_record/tx_phase/tx_calendar_day 原列）。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { openDatabase, migrate, close } from '../dsh/store.js'
import { parseAndRecord, listCandidates } from '../dsh/parse.js'
import { extractDiagnosisCandidates, extractTreatmentCandidates, extractLabCandidates } from '../dsh/amlparse.js'
import { createApiHandler, API_PREFIX } from '../dsh/routes.js'
import { servePublic } from '../dsh/server.js'
import { bootstrap, getProfile } from '../dsh/readmodels.js'
import { MineruError } from '../dsh/mineru.js'

const tmp = mkdtempSync(join(homedir(), '.amlpal-onboard-test-'))
after(() => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ } })

/* 空库（不播种演示数据）：三步闭环的真实起点。 */
function openEmpty() {
  const db = openDatabase(':memory:')
  migrate(db)
  return db
}

const DX_TX_MD = [
  '# 出院记录',
  '患者因乏力就诊，2026-10-13 入院。',
  '出院诊断：急性髓系白血病（AML，M5a）。',
  '治疗经过：予 DA 方案（柔红霉素 60mg d1-3 + 阿糖胞苷 100mg d1-7）诱导化疗。',
  '| 项目 | 结果 | 单位 |',
  '| --- | --- | --- |',
  '| 中性粒细胞绝对值 | 0.42 | ×10⁹/L |',
].join('\n')

const fakeClient = (markdown) => ({ parse: async () => ({ markdown, pages: 2 }) })

/* 与 routes.js 同源的最小 source：独立 HTTP 链路（建档/候选确认都打真路由）。 */
import { createProfile } from '../dsh/store.js'
function handlerSource(db) {
  return {
    db,
    bootstrap: () => bootstrap(db, { version: 'test', build: 'test' }),
    profile: (key, opts) => getProfile(db, key, opts),
    listProfiles: () => db.prepare('SELECT id, name FROM profile ORDER BY rowid').all().map((r) => ({ ...r })),
    addProfile: (input) => createProfile(db, input),
  }
}

async function withServer(db, fn) {
  const api = createApiHandler({
    source: handlerSource(db),
    version: '0.0.0-test',
    build: 'test',
    serveUi: (req, res, p) => servePublic(req, res, p),
  })
  const server = createServer((req, res) => void api(req, res))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}${API_PREFIX}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

const labOnlyMd = '| 项目 | 结果 | 单位 |\n| --- | --- | --- |\n| 血红蛋白 | 68 | g/L |'

test('① 抽取层：AML 出院记录抽到 diagnosis + treatment 候选（带原文与药物清单）；纯化验单两类都不产', () => {
  const dx = extractDiagnosisCandidates(DX_TX_MD)
  assert.equal(dx.length, 1)
  assert.equal(dx[0].kind, 'diagnosis')
  assert.equal(dx[0].field, '出院诊断（原文）')
  assert.match(dx[0].quote, /出院诊断：急性髓系白血病/)
  assert.ok(dx[0].quote.length <= 200, '原文候选裁到 ≤200 字')

  const tx = extractTreatmentCandidates(DX_TX_MD)
  assert.equal(tx.length, 1)
  assert.equal(tx[0].kind, 'treatment')
  assert.equal(tx[0].field, '诱导方案（原文）')
  assert.equal(tx[0].plan.name, 'DA')
  assert.ok(tx[0].plan.drugs.includes('阿糖胞苷') && tx[0].plan.drugs.includes('柔红霉素'), '药物清单含两药')

  /* 纯化验单（无诊断/方案语境）：只有 metric 候选，两类新候选都是空（如实不编）。 */
  const labOnly = extractLabCandidates(labOnlyMd)
  assert.equal(extractDiagnosisCandidates(labOnlyMd).length, 0)
  assert.equal(extractTreatmentCandidates(labOnlyMd).length, 0)
  assert.equal(labOnly.candidates.length, 1)
})

test('② 建档：空库 200 建档（id=p+36进制、primary_role=PATIENT、age/照护者进叙述层）；缺 name 400；已有档案幂等 existing', async () => {
  const db = openEmpty()
  await withServer(db, async (base) => {
    const bad = await fetch(`${base}/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error, 'FIELD_REQUIRED')

    const r = await fetch(`${base}/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '林晓', age: 47, caregiver: '女儿' }) })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.existing, false)
    assert.match(j.profileId, /^p[0-9a-z]+$/)
    const row = db.prepare('SELECT id, name, primary_role FROM profile WHERE id = ?').get(j.profileId)
    assert.equal(row.primary_role, 'PATIENT')
    const pres = JSON.parse(db.prepare('SELECT dataset_state FROM workspace WHERE id = 1').get().dataset_state)
    assert.equal(pres.presentation[j.profileId].age, 47)
    assert.equal(pres.presentation[j.profileId].caregiverLabel, '女儿')

    /* 已有档案：幂等 200 existing，不新建。 */
    const again = await fetch(`${base}/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '另一个人' }) })
    assert.equal(again.status, 200)
    const j2 = await again.json()
    assert.equal(j2.existing, true)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM profile').get().n, 1)
  })
  close(db)
})

test('③ bootstrap：空库 needsOnboarding:true；建档后 false（health 能力清单带 profiles.write）', async () => {
  const db = openEmpty()
  await withServer(db, async (base) => {
    const before = await (await fetch(`${base}/bootstrap`)).json()
    assert.equal(before.needsOnboarding, true)
    assert.equal(before.profiles.length, 0)

    await fetch(`${base}/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '林晓' }) })
    const afterBoot = await (await fetch(`${base}/bootstrap`)).json()
    assert.equal(afterBoot.needsOnboarding, false)
    assert.equal(afterBoot.profiles.length, 1)

    const health = await (await fetch(`${base}/health`)).json()
    assert.ok(health.capabilities.includes('profiles.write'), '能力契约面要声明 profiles.write')
  })
  close(db)
})

test('④ 导入解析（parse 层注入假 MinerU）：document=parsed，候选三类齐（化验/诊断/治疗），src 带文件名', async () => {
  const db = openEmpty()
  const p = createProfile(db, { name: '林晓' })
  const r = await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '出院记录2026-10-13.pdf', profileId: p.id, client: fakeClient(DX_TX_MD) })
  assert.equal(r.status, 'parsed')
  assert.equal(r.candidates.length, 3, '化验 1 条 + 诊断 1 条 + 治疗 1 条')
  const pending = listCandidates(db)
  const kinds = pending.map((c) => c.kind ?? 'metric').sort()
  assert.deepEqual(kinds, ['diagnosis', 'metric', 'treatment'])
  const dx = pending.find((c) => c.kind === 'diagnosis')
  assert.match(dx.quote, /急性髓系白血病/)
  assert.equal(dx.profileId, p.id)
  const tx = pending.find((c) => c.kind === 'treatment')
  assert.equal(tx.plan.name, 'DA')
  assert.match(tx.src, /出院记录2026-10-13\.pdf/)
  /* GET /records/document（前端第 2 步的数据源）能看到这份已解析材料。 */
  const doc = db.prepare('SELECT file_name, status FROM document WHERE profile_id = ?').get(p.id)
  assert.equal(doc.status, 'parsed')
  close(db)
})

test('⑤ 确认诊断候选：diagnosis_record 落原文（subtype_text=quote、confirmed_on 取出处日期）', async () => {
  const db = openEmpty()
  const p = createProfile(db, { name: '林晓' })
  await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '出院记录2026-10-13.pdf', profileId: p.id, client: fakeClient(DX_TX_MD) })
  const dx = listCandidates(db).find((c) => c.kind === 'diagnosis')
  await withServer(db, async (base) => {
    const r = await fetch(`${base}/candidate/${encodeURIComponent(dx.id)}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.kind, 'diagnosis')
    const row = db.prepare('SELECT subtype_text, confirmed_on, report_doc_id FROM diagnosis_record WHERE profile_id = ?').get(p.id)
    assert.equal(row.subtype_text, dx.quote, '原文照抄进 diagnosis_record')
    assert.equal(row.confirmed_on, '2026-10-13', 'confirmed_on 取候选出处里的报告日期')
    assert.ok(Number.isInteger(row.report_doc_id), 'report_doc_id 关联 document 行')
    /* 读模型：诊断原文进 dx.subtype.who（前端「诊断与基因」页直接可见）。 */
    assert.equal(getProfile(db, p.id).dx.subtype.who, dx.quote)
  })
  close(db)
})

test('⑥ 确认治疗候选：必须带 D1；带 D1 → tx_phase 1 行 + tx_calendar_day 42 行（D1–7 药物、D8+ 谷值期）', async () => {
  const db = openEmpty()
  const p = createProfile(db, { name: '林晓' })
  await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '出院记录2026-10-13.pdf', profileId: p.id, client: fakeClient(DX_TX_MD) })
  const tx = listCandidates(db).find((c) => c.kind === 'treatment')
  await withServer(db, async (base) => {
    /* 缺 D1：400 FIELD_REQUIRED（前端先弹日期框）。 */
    const noD1 = await fetch(`${base}/candidate/${encodeURIComponent(tx.id)}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    assert.equal(noD1.status, 400)
    assert.equal((await noD1.json()).error, 'FIELD_REQUIRED')

    const r = await fetch(`${base}/candidate/${encodeURIComponent(tx.id)}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ d1: '2026-10-13' }) })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.kind, 'treatment')
    assert.equal(j.calendarDays, 42)

    const phase = db.prepare('SELECT cycle_label, phase, start_date, end_date, plan_text FROM tx_phase WHERE profile_id = ?').get(p.id)
    assert.equal(phase.phase, 'INDUCTION')
    assert.equal(phase.start_date, '2026-10-13')
    assert.match(phase.plan_text, /DA 方案/)
    const rows = db.prepare('SELECT day_index, plan_date, drugs_text, done FROM tx_calendar_day WHERE profile_id = ? ORDER BY day_index').all(p.id)
    assert.equal(rows.length, 42)
    assert.ok(rows.every((x) => Number(x.done) === 0), '生成的日历格默认未完成')
    assert.equal(rows[0].plan_date, '2026-10-13')
    assert.equal(rows[41].plan_date, '2026-11-23', 'D42 = D1 + 41 天')
    for (const k of [1, 3, 7]) {
      assert.match(rows[k - 1].drugs_text, /阿糖胞苷/, `D${k} 药物清单含阿糖胞苷`)
      assert.match(rows[k - 1].drugs_text, /柔红霉素/, `D${k} 药物清单含柔红霉素`)
    }
    assert.equal(rows[7].drugs_text, '谷值期（停化疗观察）', 'D8 起写谷值期')
    assert.equal(rows[41].drugs_text, '谷值期（停化疗观察）')
    /* 读模型：诱导日历页 42 天逐日可见。 */
    assert.equal(getProfile(db, p.id).tx.calendar.daily.length, 42)
    assert.equal(getProfile(db, p.id).tx.cycles.length, 1)
  })
  close(db)
})

test('⑦ 拒收一条候选：不落任何事实层，候选从清单移除；schema/0001 未动', async () => {
  const db = openEmpty()
  const p = createProfile(db, { name: '林晓' })
  await parseAndRecord(db, { bytes: Buffer.from('fake'), filename: '出院记录2026-10-13.pdf', profileId: p.id, client: fakeClient(DX_TX_MD) })
  const metric = listCandidates(db).find((c) => !c.kind)
  await withServer(db, async (base) => {
    const r = await fetch(`${base}/candidate/${encodeURIComponent(metric.id)}/reject`, { method: 'POST' })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).rejected, metric.id)
  })
  assert.equal(listCandidates(db).some((c) => c.id === metric.id), false, '候选被移除')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM metric_point').get().n, 0, '拒收不落 metric_point')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_phase').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM diagnosis_record').get().n, 0)
  /* schema 冻结：0001 的 sha256 与 freeze-contract 一致（三步闭环没有改表）。 */
  const { createHash } = await import('node:crypto')
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../schema/0001_initial.sql', import.meta.url), 'utf8')
  const contract = readFileSync(new URL('../schema/freeze-contract.md', import.meta.url), 'utf8')
  assert.ok(contract.includes(createHash('sha256').update(sql).digest('hex').slice(0, 16)), 'freeze-contract 里能对上 0001 的指纹')
  close(db)
})
