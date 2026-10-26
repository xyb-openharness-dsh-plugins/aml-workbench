#!/usr/bin/env node
/**
 * AML M5 探针：对着**真实起的 dev-server**（不是静态文件）走一遍验收清单。
 *
 * 为什么不能只跑 file:// 探针：M2 探针打的是 prototypes/v0.2/index.html，
 * 那条路径上根本没有 HTTP 服务。M5 之后用户实际打开的是 /api/aml/ui/，
 * 中间多了「静态层剥前缀」「bootstrap 换成库里的数据」「写体温落盘」三处接缝——
 * 这三处任何一处断了，file:// 探针都照样全绿（LESSONS 第 10 类）。
 *
 * 断言（任一失败即非零退出）：
 *   H1 /api/aml/health 200 且带版本号
 *   H2 /api/aml/bootstrap 六件齐（meta/profiles/version/build/agent/layout）
 *   H3 写一条体温 → 回读有数 → 直接查 sqlite 磁盘库也有数
 *   H4 private 三出口：bootstrap / profile / 导出 都不含私密正文；?private=1 才给
 *   H5 UI 前缀能取到 index.html，且页面里的数据层真的走 bootstrap（不是死数据）
 *   H6 未知路径回 JSON 404（不是 HTML —— 否则前端报 Unexpected token '<'）
 *   H7 临床试验（35 号）：capabilities 契约面 / trials 快照可读（snapshotDate+来源终态）
 *      / 收藏落 saved_trial 并回读 / 缺 profile 400
 *   H8 通用记录写读：8 kind 的契约面抽查（写→回读→private 默认过滤→非法 kind 400→缺必填 400）
 *
 * 用法：
 *   node scripts/probe-aml-m5.mjs               起临时工作区（系统分配的端口），跑完清理
 *   node scripts/probe-aml-m5.mjs --port 4199   对着已跑的 dev-server 打（不清理）
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../dsh/workbench.js'
import { startWorkbenchServer } from '../dsh/server.js'
import { openDatabase, close } from '../dsh/store.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const portArg = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : null

const results = []
const fails = []
const oks = []
let base = null
let server = null
let workbench = null
let tmp = null

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (ok) oks.push(name)
  else fails.push(`${name}：${detail}`)
}

async function probe() {
  /* H1 健康检查 */
  const health = await fetch(`${base}/api/aml/health`)
  const h = await health.json()
  record('H1 health 200 且带版本', health.status === 200 && /^\d+\.\d+\.\d+/.test(h.version ?? ''), `status=${health.status} version=${h.version}`)
  record('H1b health 声明 UI 前缀', h.ui === '/api/aml/ui', `ui=${h.ui}`)

  /* H2 bootstrap 六件齐 */
  const boot = await (await fetch(`${base}/api/aml/bootstrap`)).json()
  const missing = ['meta', 'profiles', 'version', 'build', 'agent', 'layout'].filter((k) => !(k in boot))
  record('H2 bootstrap 六件齐', missing.length === 0, `缺 ${missing.join(',') || '无'}`)
  record('H2b bootstrap 带两个档案', Array.isArray(boot.profiles) && boot.profiles.length === 2, `profiles=${boot.profiles?.length}`)
  record('H2c bootstrap 带粒缺发热定义原文', String(boot.meta?.feverDef ?? '').includes('38.3'), 'K2 定义原文必须随 bootstrap 下发')

  /* H3 写一条体温 → 回读 → 磁盘库 */
  const writeRes = await fetch(`${base}/api/aml/temperature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'demo1', measuredAt: '2026-10-26T07:45', valueC: 38.6, site: 'ORAL', authorRole: 'CAREGIVER' }),
  })
  const written = await writeRes.json()
  record('H3 写体温 200', writeRes.status === 200 && written.reading?.value_c === 38.6, `status=${writeRes.status} ${JSON.stringify(written).slice(0, 120)}`)
  record('H3b 写体温响应不含判定字段（K2）',
    ['level', 'isEmergency', 'emergency', 'isFebrileNeutropenia'].every((k) => !(k in (written.reading ?? {}))),
    `字段：${Object.keys(written.reading ?? {}).join(',')}`)

  const readBack = await (await fetch(`${base}/api/aml/temperature?profile=demo1`)).json()
  const hit = (readBack.readings ?? []).find((x) => x.ts === '2026-10-26T07:45')
  record('H3c 回读有新写的体温', Boolean(hit) && hit.v === 38.6, `readings=${readBack.readings?.length}`)

  if (workbench?.workspace) {
    const dbFile = join(workbench.workspace, 'amlpal.sqlite')
    const disk = openDatabase(dbFile)
    try {
      const row = disk.prepare("SELECT value_c, author_role FROM temperature_reading WHERE measured_at = '2026-10-26T07:45'").get()
      record('H3d 磁盘库有这条体温', Boolean(row) && row.value_c === 38.6, row ? JSON.stringify(row) : '磁盘库里没有')
    } finally {
      close(disk)
    }
  } else {
    record('H3d 磁盘库检查', true, '（对着已在跑的服务，跳过磁盘直查）')
  }

  /* H4 private 三出口 */
  const privy = boot.profiles.map((p) => [p.id, p.privateCount, (p.mind?.death?.items ?? []).length])
  record('H4 bootstrap 不含 private 原文', privy.every(([, , n]) => n === 0), JSON.stringify(privy))
  record('H4b bootstrap 给了 privateCount', privy.every(([, c]) => c > 0), JSON.stringify(privy))
  const openProfile = await (await fetch(`${base}/api/aml/profile/demo1`)).json()
  const fullProfile = await (await fetch(`${base}/api/aml/profile/demo1?private=1`)).json()
  record('H4c profile 默认过滤', (openProfile.profile?.mind?.death?.items ?? []).length === 0,
    `items=${openProfile.profile?.mind?.death?.items?.length}`)
  record('H4d ?private=1 才给原文', (fullProfile.profile?.mind?.death?.items ?? []).length > 0,
    `items=${fullProfile.profile?.mind?.death?.items?.length}`)

  const md = await (await fetch(`${base}/api/aml/export/demo1.md`)).text()
  record('H4e 导出不含 private 原文', !/后事都想了一遍|停车场坐了半小时/.test(md), '导出里出现了私密正文')
  record('H4f 导出写明有意排除', /私密记录（对死亡的准备）按设置不进本摘要/.test(md), '没写"有意排除"，用户会以为数据丢了')

  /* H5 UI 与数据层 */
  const ui = await fetch(`${base}/api/aml/ui/`)
  const html = await ui.text()
  record('H5 UI 前缀 200', ui.status === 200 && /小橙宝/.test(html), `status=${ui.status}`)
  const appRes = await fetch(`${base}/api/aml/ui/app.js`)
  const appJs = await appRes.text()
  record('H5b app.js 带 bootstrap 数据层', /loadBootstrap/.test(appJs) && /\/bootstrap/.test(appJs), '页面没有去要本机数据')
  record('H5c public 与原型逐字符一致', readFileSync(join(ROOT, 'public', 'app.js'), 'utf8') === readFileSync(join(ROOT, 'prototypes', 'v0.2', 'app.js'), 'utf8'),
    'public/app.js 与原型分叉了（同步脚本没跑？）')
  /* H5d 前缀不许拼两遍：apiBase() 已经返回 /api/aml，调用方只能接 /bootstrap。
     2026-10-26 实测踩过：拼成 /api/aml/api/aml/bootstrap → 404 → 页面静默退回演示数据，
     bootstrap 明明 200，界面却写"离线演示数据"。静态断言 + 下面那条真请求一起守。 */
  record('H5d 前缀不重复拼接', !/base\s*\+\s*['"]\/api\/aml\//.test(appJs) && !/apiBase\(\)\s*\+\s*['"]\/api\//.test(appJs),
    'app.js 把 /api/aml 又拼了一遍（会 404 后静默退回演示数据）')
  /* 真打一次页面会打的 URL：页面在 /api/aml/ui/ 上，apiBase() 推出 /api/aml，再接 /bootstrap。
     这里照同样的规则从 UI 路径反推，而不是硬写地址——硬写就测不出"推导错了"。 */
  const uiPath = '/api/aml/ui/'
  const uiPrefix = uiPath.match(/^(.*)\/ui(?:\/|$)/)?.[1] ?? ''
  const derivedUrl = `${base}${uiPrefix}/bootstrap`
  const derived = await fetch(derivedUrl)
  const derivedJson = await derived.json().catch(() => null)
  record('H5e 页面推导出的 bootstrap 地址可用', derived.status === 200 && Array.isArray(derivedJson?.profiles),
    `${derivedUrl} → status=${derived.status}`)

  /* H6 交界守卫 */
  const nope = await fetch(`${base}/api/aml/nope`)
  const nopeJson = await nope.json().catch(() => null)
  record('H6 未知路径 JSON 404', nope.status === 404 && nopeJson?.error === 'not_found', `status=${nope.status}`)
  const badMethod = await fetch(`${base}/api/aml/bootstrap`, { method: 'POST' })
  record('H6b 错方法 405', badMethod.status === 405, `status=${badMethod.status}`)
  const badTemp = await fetch(`${base}/api/aml/temperature`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
  })
  record('H6c 坏 JSON 400（不裸 500）', badTemp.status === 400, `status=${badTemp.status}`)

  /* H7 临床试验检索（35 号）：快照可读 / keyword 过滤 / 收藏落 saved_trial */
  const healthCaps = (await (await fetch(`${base}/api/aml/health`)).json()).capabilities ?? []
  record('H7 health capabilities 带 0.4.0 契约面',
    ['trials.read', 'saved-trials.write', 'records.write', 'records.feeling'].every((c) => healthCaps.includes(c)),
    `缺 ${['trials.read', 'saved-trials.write', 'records.write', 'records.feeling'].filter((c) => !healthCaps.includes(c)).join(',') || '无'}`)
  const trials = await (await fetch(`${base}/api/aml/trials?keyword=FLT3&limit=5`)).json()
  record('H7b trials 快照可读', trials.source === 'snapshot' && Array.isArray(trials.items) && trials.items.length > 0,
    `source=${trials.source} items=${trials.items?.length} snapshotDate=${trials.snapshotDate}`)
  record('H7c 快照带 snapshotDate 与未核实语义',
    /^\d{4}-\d{2}-\d{2}/.test(trials.snapshotDate ?? '') && (trials.items?.[0]?.statusNote ?? '').includes('未核实'),
    `snapshotDate=${trials.snapshotDate} statusNote=${trials.items?.[0]?.statusNote}`)
  record('H7d 来源终态摘要在场', Array.isArray(trials.sources) && trials.sources.length > 0
    && trials.sources.some((s) => s.state === 'FAILED' || s.state === 'SUCCESS'),
    `sources=${(trials.sources ?? []).map((s) => `${s.sourceId}:${s.state}`).join(',')}`)
  const trialsNoHit = await (await fetch(`${base}/api/aml/trials?keyword=ZZZ无此词ZZZ`)).json()
  record('H7e 零命中也是 200 空列表', trialsNoHit.source === 'snapshot' && trialsNoHit.items.length === 0,
    `items=${trialsNoHit.items?.length}`)
  const savedPost = await fetch(`${base}/api/aml/saved-trials`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'demo1', trialKey: trials.items?.[0]?.key ?? 'CTR-TEST' }),
  })
  const savedBody = await savedPost.json().catch(() => null)
  record('H7f 收藏 200 且落库', savedPost.status === 200 && savedBody?.trialKey, JSON.stringify(savedBody).slice(0, 120))
  const savedList = await (await fetch(`${base}/api/aml/saved-trials?profile=demo1`)).json()
  record('H7g 收藏回读', (savedList.items ?? []).some((s) => s.trialKey === (trials.items?.[0]?.key ?? 'CTR-TEST')),
    `items=${savedList.items?.length}`)
  const noProfileSaved = await fetch(`${base}/api/aml/saved-trials`)
  record('H7h 收藏缺 profile 400', noProfileSaved.status === 400, `status=${noProfileSaved.status}`)

  /* H8 通用记录写读（AI 写入契约面）：写 → 回读 → private 过滤 → 非法 kind 400 */
  const recPost = await fetch(`${base}/api/aml/records/transfusion`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'demo1', event_date: '2026-10-25', component: 'PLATELET', units_text: '1 治疗量', reaction: '无' }),
  })
  const recBody = await recPost.json().catch(() => null)
  record('H8 写 transfusion 200', recPost.status === 200 && recBody?.id > 0, JSON.stringify(recBody).slice(0, 140))
  const recGet = await (await fetch(`${base}/api/aml/records/transfusion?profile=demo1`)).json()
  record('H8b 回读有新写的输注', (recGet.items ?? []).some((x) => x.event_date === '2026-10-25' && x.component === 'PLATELET'),
    `items=${recGet.items?.length}`)
  const feelPost = await fetch(`${base}/api/aml/records/feeling`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'demo1', logged_at: '2026-10-26T21:30', kind_in: 'DEATH_PREP', content: 'M5 探针私密句：试着安排好家里的相册' }),
  })
  const feelBody = await feelPost.json().catch(() => null)
  record('H8c 写 feeling 200 且默认 private（K6）', feelPost.status === 200 && feelBody?.visibility === 'private',
    JSON.stringify(feelBody).slice(0, 140))
  const feelGet = await (await fetch(`${base}/api/aml/records/feeling?profile=demo1`)).json()
  record('H8d feeling 默认过滤 private', !(feelGet.items ?? []).some((x) => x.content?.includes('相册')),
    `items=${feelGet.items?.length}`)
  const feelFull = await (await fetch(`${base}/api/aml/records/feeling?profile=demo1&private=1`)).json()
  record('H8e ?private=1 才给原文', (feelFull.items ?? []).some((x) => x.content?.includes('相册')),
    `items=${feelFull.items?.length}`)
  const badKind = await fetch(`${base}/api/aml/records/nope`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'demo1' }),
  })
  const badKindBody = await badKind.json().catch(() => null)
  record('H8f 非法 kind 400 JSON', badKind.status === 400 && badKindBody?.error === 'BAD_KIND', `status=${badKind.status}`)
  const badKindGet = await fetch(`${base}/api/aml/records/nope?profile=demo1`)
  record('H8g 非法 kind GET 也 400', badKindGet.status === 400, `status=${badKindGet.status}`)
  const missField = await fetch(`${base}/api/aml/records/question`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'demo1', kind_in: 'fact' }),
  })
  record('H8h 缺必填列 400', missField.status === 400, `status=${missField.status}`)
}

try {
  if (portArg) {
    base = `http://127.0.0.1:${portArg}`
    console.log(`· 对着已在运行的服务 ${base} 探针`)
  } else {
    tmp = mkdtempSync(join(homedir(), '.amlpal-m5-probe-'))
    const dir = join(tmp, 'workspace')
    workbench = await Workbench.open(dir)
    const started = await startWorkbenchServer({ port: 0, host: '127.0.0.1', workbench })
    server = started.server
    base = started.url.replace(/\/$/, '')
    console.log(`· 临时工作区 ${dir}`)
  }
  await probe()
} catch (error) {
  fails.push(`运行异常：${error?.message ?? error}`)
} finally {
  if (server) await new Promise((r) => server.close(r))
  if (workbench) workbench.close()
  if (tmp) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ } }
}

const report = { pass: fails.length === 0, oks, fails, probes: results.length, base }
console.log(JSON.stringify(report, null, 2))
if (fails.length) process.exit(1)
