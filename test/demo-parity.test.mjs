/* demo-parity：库里读出的档案必须与 prototypes/v0.2/demo-data.js（唯一数据源）同形。
 *
 * 前端是照着原型的形状写的，差一个字段就是"某个卡片空白"这种很难定位的 bug。
 * 拆表（dsh/demo.js）→ 拼（dsh/readmodels.js）→ 与原型逐字段 deepStrictEqual。
 * 叙述层（治疗路径折叠卡、等待清单、各页口径说明、日历方案带）在
 * workspace.dataset_state 的 presentation JSON 里往返，也必须一字不差。
 *
 * 除逐字段比对外，这里还有三条**红线**断言（比 parity 更重要）：
 * - K2：读模型里不许出现"是否急症/是否粒缺发热"这类判定字段（判定在前端按定义原文做）；
 * - K3：MRD 双口径分列，跨方法不合并、不给复发结论；
 * - K4/K5：移植零推荐、输注不判依赖——字段命名里不许有 recommend/eligible/dependent 这类词。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase, migrate, close } from '../dsh/store.js'
import { seedDemo } from '../dsh/demo.js'
import { bootstrap, getProfile } from '../dsh/readmodels.js'
import { loadDemoData, readDemoJson } from '../demo/build-demo-data.mjs'

const DEMO = loadDemoData()
const PROFILES = DEMO.profiles
/** 服务端比原型多出的键（有文档、有用途）；其余任何差异都算 parity 破坏。 */
const SERVER_ONLY_TOP_KEYS = ['privateCount']

function openSeeded() {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDemo(db, readDemoJson())
  return db
}

/** 逐字段比较，返回差异清单（空数组＝一致）。用 JSON 相等做终极判据，逐键递归只为报出路径。 */
function diff(expected, actual, path = 'p', out = []) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return out
  const bothObj = expected && actual && typeof expected === 'object' && typeof actual === 'object'
  if (bothObj && Array.isArray(expected) === Array.isArray(actual)) {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      diff(expected[k], actual[k], `${path}.${k}`, out)
    }
    return out
  }
  out.push({ path, expected, actual })
  return out
}

test('① 数据源纪律：demo/demo-data.json 与原型 demo-data.js 同一份（求值后深比）', () => {
  assert.deepEqual(readDemoJson(), DEMO, '两个产物必须来自同一次求值，数值不许各说一套')
})

test('② 全档逐字段 parity：两个档案、includePrivate 全开时与原型一字不差', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const got = getProfile(db, src.id, { includePrivate: true })
    const expected = { ...src }
    for (const k of SERVER_ONLY_TOP_KEYS) delete got[k]
    assert.deepEqual(diff(expected, got), [], `${src.id} 与原型不一致（见上）`)
  }
  close(db)
})

test('③ K1 诱导日历按天：daily 按 day_index 递增连续，无"疗程"聚合判定字段', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const cal = getProfile(db, src.id).tx.calendar
    const days = cal.daily.map((r) => r.day)
    assert.ok(days.length >= 28, `${src.id}: 日历至少覆盖一个周期`)
    assert.deepEqual(days, days.map((_, i) => days[0] + i), `${src.id}: day_index 连续不跳号`)
    const keys = new Set(Object.keys(cal))
    for (const banned of ['cycleOutcome', 'efficacy', 'response', 'verdict']) {
      assert.equal(keys.has(banned), false, `K1: 日历不许出现疗程级判定字段 ${banned}`)
    }
  }
  close(db)
})

test('④ K2 发热轨道只给事实：读模型里没有任何"是否急症/是否粒缺发热"字段', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const neu = getProfile(db, src.id).neu
    const flat = JSON.stringify(neu)
    /* 判定字段名一律不许出现（值是布尔也不行）。 */
    assert.equal(/"(isEmergency|emergency|level|verdict|classify|isFebrileNeutropenia|neutropenicFever)"\s*:/.test(flat), false,
      `${src.id}: 读模型不许产出判定字段（K2：判定在前端按定义原文做）`)
    /* 体温必须是小时级时间戳（到分钟），不是"某天一次"。 */
    const temps = neu.fever.episodes.flatMap((e) => e.temps)
    assert.ok(temps.length > 0, `${src.id}: 必须有小时间级体温`)
    for (const t of temps) {
      assert.match(t.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${src.id}: 体温时间必须精确到分钟`)
    }
    /* 体温按 measured_at 升序（前端画曲线直接用这个序，不再排序）。 */
    for (const ep of neu.fever.episodes) {
      const sorted = [...ep.temps].map((t) => t.ts).sort()
      assert.deepEqual(ep.temps.map((t) => t.ts), sorted, `${src.id}: ${ep.label} 的体温未按时间排序`)
    }
    /* 定义原文必须随轨道下发（K2：前端按它分流）。 */
    assert.ok(DEMO.meta.feverDef.includes('38.3'), '定义原文由 meta 携带，前端按它分流')
  }
  close(db)
})

test('⑤ K3 MRD 双口径：FLOW/PCR 分列、条数与原型一致、跨方法不合并', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const mrd = getProfile(db, src.id).mrd
    assert.equal(mrd.flow.length, (src.mrd.flow ?? []).length, `${src.id}: 流式条数`)
    assert.equal(mrd.pcr.length, (src.mrd.pcr ?? []).length, `${src.id}: PCR 条数`)
    assert.equal(new Set(mrd.flow.map((x) => x.src)).size >= 1, true)
    /* 不许出现"合并后的单条序列"或复发判定。 */
    assert.equal('combined' in mrd, false, 'K3: 不许合并两口径')
    assert.equal(/relapse|recurrence/i.test(JSON.stringify(Object.keys(mrd))), false, 'K3: 无复发判定字段')
  }
  /* demo2 的 NPM1 是野生型 → PCR 列为空；这本身是"不适用"，不是"阴性"。 */
  assert.equal(getProfile(db, 'demo2').mrd.pcr.length, 0, 'demo2 不适用 PCR 监测，列必须为空而不是补一条阴性')
  close(db)
})

test('⑥ K4/K5 零推荐与不判依赖：字段命名里不许出现推荐/合格性/依赖', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const p = getProfile(db, src.id)
    const keys = JSON.stringify([Object.keys(p.tp), Object.keys(p.neu), Object.keys(p.neu.transfusions[0] ?? {})])
    assert.equal(/recommend|eligible|suitability|matchScore|dependent|dependence/i.test(keys), false,
      `${src.id}: K4/K5 的字段命名越界：${keys}`)
    /* 移植段必须有零推荐常驻文案（原文来自叙述层）。 */
    assert.match(p.tp.zeroRec ?? '', /零推荐/, `${src.id}: 移植段必须带零推荐常驻文案`)
    /* 输注成分必须分列成三种之一，不许有合并的"输血次数"。 */
    for (const t of p.neu.transfusions) {
      assert.ok(['红细胞', '血小板', '血浆'].includes(t.comp), `${src.id}: 输注成分必须分列，实得 ${t.comp}`)
    }
  }
  close(db)
})

test('⑦ K6 双主体与私密三出口口径：private 默认过滤、includePrivate 才给原文、privateCount 对得上', () => {
  const db = openSeeded()
  for (const src of PROFILES) {
    const open = getProfile(db, src.id)
    const full = getProfile(db, src.id, { includePrivate: true })
    const privSrc = (src.mind.death.items ?? []).filter((x) => x.visibility === 'private')
    assert.equal(full.mind.death.items.length, (src.mind.death.items ?? []).length, `${src.id}: 全量含私密`)
    assert.equal(open.mind.death.items.length, 0, `${src.id}: 默认把"对死亡的准备"整段过滤掉`)
    assert.equal(open.privateCount, privSrc.length, `${src.id}: privateCount 必须等于私密条数`)
    assert.equal(full.privateCount, privSrc.length, 'privateCount 不因 includePrivate 变化')
    /* 双主体：感受里本人与照护者都要有记录（并列不平均，但不许只剩一方）。 */
    const authors = new Set([...(open.mind.feels ?? []), ...(open.mind.burden ?? [])].map((x) => x.author))
    assert.ok(authors.has('caregiver'), `${src.id}: 照护者记录必须存在（双主体）`)
  }
  close(db)
})

test('⑧ 血象趋势只取 cbc：感染/黏膜炎/铁蛋白都不许混进 metrics.numeric', () => {
  const db = openSeeded()
  const p = getProfile(db, 'demo1')
  assert.deepEqual(Object.keys(p.metrics.numeric).sort(), ['ANC', 'Hb', 'PLT', 'WBC', 'WEIGHT'])
  /* 铁蛋白单独成列（category='inflammation'），不进趋势。 */
  assert.equal('SF' in p.metrics.numeric, false, '铁蛋白不进血象趋势')
  assert.equal(p.ferritin.length, 1)
  /* 黏膜炎分级是文字原文，不许被当成数值序列。 */
  assert.equal(/mucositis|oralGrade/i.test(JSON.stringify(Object.keys(p.metrics.numeric))), false)
  close(db)
})

test('⑨ bootstrap：meta 与原型一致、两档案、六件齐（含版本与布局常量）', () => {
  const db = openSeeded()
  const payload = bootstrap(db, { version: '0.3.0', build: 'test' })
  assert.deepEqual(payload.meta, DEMO.meta)
  assert.equal(payload.profiles.length, 2)
  assert.equal(payload.version, '0.3.0')
  assert.equal(payload.build, 'test')
  assert.ok(payload.agent?.available, '开发版自带挂载位演示')
  assert.ok(payload.layout?.agentPane, '布局常量随 bootstrap 下发')
  assert.equal(payload.layout.agentPane.def, 0.35, '会话区默认宽度取 lib/layout.js 的唯一来源')
  close(db)
})

test('⑩ 试验线只登记信息：条目字段里没有合格性/匹配度，且整条线带"线索不是推荐"口径', () => {
  const db = openSeeded()
  /* 口径逐条写 vs 整节写：原型里三条线索只有一条带全句，其余写的是"仅作了解"，
     所以断言落在**整条线**上（meta.trialNote 与至少一条条目 note），不要求每条重复同一句。 */
  assert.match(DEMO.meta.trialNote ?? '', /线索不是推荐/, '试验线的总口径必须写在 meta.trialNote（页面上常驻）')
  for (const src of PROFILES) {
    const trials = getProfile(db, src.id).docs.trials
    assert.ok(trials.length > 0, `${src.id}: 试验线索应登记若干条`)
    assert.ok(trials.some((t) => /线索不是推荐/.test(t.note ?? '')), `${src.id}: 至少一条线索要写明"线索不是推荐"`)
    for (const t of trials) {
      const keys = Object.keys(t)
      assert.deepEqual(keys.filter((k) => /eligible|suitability|match|score|fit/i.test(k)), [],
        `${src.id}: 试验条目不实现匹配，字段不许出现合格性/匹配度：${keys.join(',')}`)
    }
  }
  close(db)
})
