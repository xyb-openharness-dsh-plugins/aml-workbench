/* 通用记录写读（0.4.0 反馈 4）：POST /api/aml/records/:kind ↔ GET 回读 ↔ private 过滤 ↔ 非法 kind 400。
 *
 * 覆盖：
 *   1. 每个 kind POST 一条 → GET 回读，断言列值与列名（schema/0001 逐列一致）；
 *   2. kind=feeling：DEATH_PREP 默认 private（K6），列表默认过滤，?private=1 才给；
 *   3. 默认值按 K6：author_role 缺省 CAREGIVER（家属代记为主）；
 *   4. 非法 kind 400 JSON（BAD_KIND）、缺必填列 400、坏枚举 400、档案不存在 400；
 *   5. 白名单 kind 与 health capabilities 一致（AI 写入契约面）。
 */

import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Workbench } from '../dsh/workbench.js'
import { startWorkbenchServer } from '../dsh/server.js'

const tmp = mkdtempSync(join(homedir(), '.amlpal-records-test-'))
after(() => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ } })

async function withServer(fn) {
  const workbench = await Workbench.open(join(tmp, 'workspace'))
  const { server, url } = await startWorkbenchServer({ port: 0, host: '127.0.0.1', workbench })
  try {
    await fn({ url, workbench })
  } finally {
    await new Promise((r) => server.close(r))
    workbench.close()
  }
}

const post = (url, kind, body) => fetch(`${url}api/aml/records/${kind}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const list = (url, kind, query = '') => fetch(`${url}api/aml/records/${kind}?profile=demo1${query}`)

test('① 每个 kind：POST 一条 → GET 回读，列值与列名一致（schema/0001）', async () => {
  await withServer(async ({ url }) => {
    const cases = [
      ['transfusion', { event_date: '2026-10-21', component: 'RBC', units_text: '2u', reaction: '无', irradiated: 1, leukoreduced: 1 }, (x) => {
        assert.equal(x.component, 'RBC'); assert.equal(x.units_text, '2u'); assert.equal(x.author_role, 'CAREGIVER', 'K6 家属代记为主')
      }],
      ['mucositis', { logged_at: '2026-10-21T09:00', grade_text: 'II 级（红斑+溃疡，能进固体）', site: '口腔', symptom_text: '疼' }, (x) => {
        assert.equal(x.grade_text, 'II 级（红斑+溃疡，能进固体）'); assert.equal(x.author_role, 'CAREGIVER')
      }],
      ['marrow-procedure', { done_on: '2026-10-21', purpose_text: 'MRD 复核', result_text: '原始细胞 2%' }, (x) => {
        assert.equal(x.result_text, '原始细胞 2%')
      }],
      ['feeling', { logged_at: '2026-10-21T10:00', kind_in: 'FEEL', content: '今天能喝下粥了', visibility: 'public' }, (x) => {
        assert.equal(x.kind, 'FEEL', 'kind_in 落库列名是 kind'); assert.equal(x.content, '今天能喝下粥了')
      }],
      ['question', { kind_in: 'fact', content: '巩固 2 之后还要做几程？', created_at: '2026-10-21', from_scenario: '测试' }, (x) => {
        assert.equal(x.kind, 'fact'); assert.equal(x.content, '巩固 2 之后还要做几程？')
      }],
      ['intake', { logged_at: '2026-10-21T08:00', intake_level: 'REDUCED', weight_kg: 61.5, note: '半碗粥' }, (x) => {
        assert.equal(x.intake_level, 'REDUCED'); assert.equal(x.weight_kg, 61.5)
      }],
      ['tx-day', { cycle_label: '诱导 1（7+3）', day_index: 8, plan_date: '2026-05-21', done: 1, delay_reason: '' }, (x) => {
        assert.equal(x.day_index, 8); assert.equal(x.done, 1, '疗程按天勾选落 tx_calendar_day.done')
      }],
      ['document', { file_name: '出院小结.pdf', sha256: 'deadbeef', imported_at: '2026-10-21T12:00' }, (x) => {
        assert.equal(x.file_name, '出院小结.pdf'); assert.equal(x.status, 'pending', '默认状态是候选/待核对语义的 pending')
      }],
    ]
    for (const [kind, body, check] of cases) {
      const r = await post(url, kind, { profileId: 'demo1', ...body })
      assert.equal(r.status, 200, `${kind} POST 应 200`)
      const saved = await r.json()
      assert.ok(saved.id > 0, `${kind} 返回 id`)
      const g = await list(url, kind)
      assert.equal(g.status, 200)
      const { items } = await g.json()
      const hit = items.find((x) => x.id === saved.id)
      assert.ok(hit, `${kind} 回读能找到刚写的行`)
      check(hit)
    }
  })
})

test('② feeling：DEATH_PREP 默认 private（K6），列表默认过滤，?private=1 才给', async () => {
  await withServer(async ({ url }) => {
    const r = await post(url, 'feeling', { profileId: 'demo1', logged_at: '2026-10-21T22:00', kind_in: 'DEATH_PREP', content: '测试私密：把门牌号抄给妹妹' })
    assert.equal(r.status, 200)
    const saved = await r.json()
    assert.equal(saved.visibility, 'private', '对死亡的准备默认私密（K6）')

    const def = await (await list(url, 'feeling')).json()
    assert.ok(!(def.items ?? []).some((x) => x.id === saved.id), '默认列表不含 private')
    const full = await (await list(url, 'feeling', '&private=1')).json()
    assert.ok((full.items ?? []).some((x) => x.id === saved.id), '?private=1 才给原文')
  })
})

test('③ 错误分支：非法 kind / 缺必填 / 坏枚举 / 档案不存在 → 全部 400 JSON', async () => {
  await withServer(async ({ url }) => {
    const cases = [
      ['nope', { profileId: 'demo1' }, 'BAD_KIND', 'POST'],
      ['question', { profileId: 'demo1', kind_in: 'fact' }, 'FIELD_REQUIRED', 'POST'],
      ['feeling', { profileId: 'demo1', logged_at: '2026-10-21T10:00', kind_in: 'NOT_A_KIND', content: 'x' }, 'BAD_VALUE', 'POST'],
      ['transfusion', { profileId: 'nobody', event_date: '2026-10-21', component: 'RBC', units_text: '1u' }, 'PROFILE_NOT_FOUND', 'POST'],
      ['transfusion', { profileId: 'demo1', event_date: '2026-10-21', component: 'OXYGEN', units_text: '1u' }, 'BAD_VALUE', 'POST'],
    ]
    for (const [kind, body, code, method] of cases) {
      const r = await post(url, kind, body)
      assert.equal(r.status, 400, `${kind} ${JSON.stringify(body).slice(0, 40)} 应 400`)
      const j = await r.json()
      assert.equal(j.error, code, `${kind} 错误码应 ${code}`)
    }
    const badGet = await fetch(`${url}api/aml/records/nope?profile=demo1`)
    assert.equal(badGet.status, 400, 'GET 非法 kind 也 400')
    const noProfile = await fetch(`${url}api/aml/records/intake`)
    assert.equal(noProfile.status, 400, 'GET 缺 ?profile 400')
    const badMethod = await fetch(`${url}api/aml/records/intake?profile=demo1`, { method: 'DELETE' })
    assert.equal(badMethod.status, 405, '错方法 405')
  })
})

test('④ capabilities 与 kind 白名单一致（AI 写入契约面）', async () => {
  await withServer(async ({ url, workbench }) => {
    const health = await (await fetch(`${url}api/aml/health`)).json()
    for (const cap of ['trials.read', 'saved-trials.write', 'records.write', 'records.read']) {
      assert.ok(health.capabilities.includes(cap), `health capabilities 缺 ${cap}`)
    }
    for (const kind of ['transfusion', 'mucositis', 'marrow-procedure', 'feeling', 'question', 'intake', 'tx-day', 'document']) {
      assert.ok(health.capabilities.includes(`records.${kind}`), `health capabilities 缺 records.${kind}`)
    }
    const boot = await (await fetch(`${url}api/aml/bootstrap`)).json()
    assert.ok(Array.isArray(boot.capabilities) && boot.capabilities.includes('records.feeling'), 'bootstrap 也下发同一契约面')
    /* 直接调用实例方法核对白名单（避免依赖 HTTP 注入路径）。 */
    assert.throws(() => workbench.addRecord('nope', { profileId: 'demo1' }), /BAD_KIND|不认识的记录类型/)
  })
})

test('⑤ trials 快照与收藏（35 号）：keyword 过滤 / snapshotDate / 收藏回读', async () => {
  await withServer(async ({ url }) => {
    const trials = await (await fetch(`${url}api/aml/trials?keyword=FLT3&limit=3`)).json()
    assert.equal(trials.source, 'snapshot')
    assert.match(String(trials.snapshotDate ?? ''), /^\d{4}-\d{2}-\d{2}/)
    assert.ok(trials.items.length > 0, 'FLT3 关键词应命中快照条目')
    for (const it of trials.items) {
      assert.ok(it.key && it.title, '每条带 key 与标题')
      assert.equal(it.status, 'other', '快照无核验状态 → 归"其他（含未核实）"')
      assert.ok(String(it.statusNote).includes('未核实'), '状态语义必须是"登记状态，未核实"')
    }
    const none = await (await fetch(`${url}api/aml/trials?keyword=ZZZNOTHINGZZZ`)).json()
    assert.equal(none.items.length, 0)
    assert.ok(Array.isArray(none.sources) && none.sources.length > 0, '零命中也带来源终态摘要')

    const saved = await (await fetch(`${url}api/aml/saved-trials`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'demo2', trialKey: trials.items[0].key }),
    })).json()
    assert.equal(saved.trialKey, trials.items[0].key)
    const again = await (await fetch(`${url}api/aml/saved-trials`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'demo2', trialKey: trials.items[0].key }),
    })).json()
    assert.equal(again.duplicate, true, '重复收藏幂等')
    const listBack = await (await fetch(`${url}api/aml/saved-trials?profile=demo2`)).json()
    assert.ok((listBack.items ?? []).some((s) => s.trialKey === trials.items[0].key))
  })
})
