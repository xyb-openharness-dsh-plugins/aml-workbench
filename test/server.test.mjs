/* HTTP 层：健康检查 / bootstrap 六件齐 / 体温写读 / private 三出口 / 导出（含落盘）/
 * 静态文件 / JSON 404 / 路径穿越 / 资料目录校验 / 交界守卫（4xx 不裸 throw 500）/
 * 双形态（独立启动 vs 模拟宿主鉴权）。
 *
 * 起真实服务（port:0 系统分配），只用内置 fetch。测完必须关 server 与 db。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Workbench, validateWorkspacePath } from '../dsh/workbench.js'
import { startWorkbenchServer, servePublic } from '../dsh/server.js'
import { createApiHandler, API_PREFIX, UI_PREFIX } from '../dsh/routes.js'

const tmp = mkdtempSync(join(homedir(), '.amlpal-server-test-'))
after(() => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ } })

async function withServer(fn) {
  const workbench = await Workbench.open(join(tmp, 'workspace'))
  const { server, port, url } = await startWorkbenchServer({ port: 0, host: '127.0.0.1', workbench })
  try {
    await fn({ url, port, workbench })
  } finally {
    await new Promise((r) => server.close(r))
    workbench.close()
  }
}

test('① /api/aml/health 返回 ok 与版本、能力清单、UI 前缀', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/health`)
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.ok, true)
    assert.match(j.version, /^\d+\.\d+\.\d+/)
    assert.equal(j.ui, '/api/aml/ui')
    for (const cap of ['bootstrap', 'profile', 'temperature', 'export', 'import', 'mineru-settings']) {
      assert.ok(j.capabilities.includes(cap), `能力清单缺 ${cap}`)
    }
  })
})

test('② bootstrap 六件齐：meta / profiles / version / build / agent / layout', async () => {
  await withServer(async ({ url }) => {
    const j = await (await fetch(`${url}api/aml/bootstrap`)).json()
    for (const key of ['meta', 'profiles', 'version', 'build', 'agent', 'layout']) {
      assert.ok(key in j, `bootstrap 缺 ${key}`)
    }
    assert.equal(j.profiles.length, 2)
    assert.ok(j.meta.feverDef.includes('38.3'), 'K2 定义原文随 bootstrap 下发')
    assert.equal(j.layout.agentPane.def, 0.35)
    /* 内存库形态下 source 要说清（宿主侧诊断靠它区分 memory / workspace）。 */
    assert.equal(j.source?.mode ?? 'workspace', 'workspace', 'Workbench.open 走的是真实资料目录')
  })
})

test('③ 写一条体温 → 回读磁盘库有数（K2：响应里只有读数，没有判定）', async () => {
  await withServer(async ({ url, workbench }) => {
    const before = await (await fetch(`${url}api/aml/temperature?profile=demo1`)).json()
    const r = await fetch(`${url}api/aml/temperature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 38.4, site: 'ORAL', authorRole: 'CAREGIVER' }),
    })
    assert.equal(r.status, 200)
    const saved = await r.json()
    assert.equal(saved.reading.value_c, 38.4)
    for (const banned of ['level', 'isEmergency', 'emergency', 'isFebrileNeutropenia']) {
      assert.equal(banned in saved.reading, false, `K2：写体温的响应不许带判定字段 ${banned}`)
    }

    const after1 = await (await fetch(`${url}api/aml/temperature?profile=demo1`)).json()
    assert.equal(after1.readings.length, before.readings.length + 1, '回读应多一条')
    const hit = after1.readings.find((x) => x.ts === '2026-10-26T08:10')
    assert.ok(hit, '新写的体温必须出现在回读里')
    assert.equal(hit.v, 38.4)
    assert.equal(hit.author, 'caregiver', 'author_role 要还原成原型的 author 取值')

    /* 真的落盘了：绕开服务直接查库。 */
    const direct = workbench.db.prepare("SELECT value_c, author_role FROM temperature_reading WHERE measured_at = '2026-10-26T08:10'").get()
    assert.equal(direct.value_c, 38.4)
    assert.equal(direct.author_role, 'CAREGIVER')
  })
})

test('③b 体温写入的参数错误走 4xx（不裸 throw 500）', async () => {
  await withServer(async ({ url }) => {
    const cases = [
      [{ profileId: 'demo1', measuredAt: '2026-10-26 08:10', valueC: 38 }, 400, 'BAD_TIME'],
      [{ profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 99 }, 400, 'BAD_VALUE'],
      [{ profileId: 'nope', measuredAt: '2026-10-26T08:10', valueC: 38 }, 400, 'PROFILE_NOT_FOUND'],
      [{ profileId: 'demo1', measuredAt: '2026-10-26T08:10', valueC: 38, authorRole: 'NURSE' }, 400, 'BAD_AUTHOR'],
    ]
    for (const [body, status, code] of cases) {
      const r = await fetch(`${url}api/aml/temperature`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      assert.equal(r.status, status, `${code} 的状态码`)
      assert.equal((await r.json()).error, code)
    }
    const bad = await fetch(`${url}api/aml/temperature`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
    assert.equal(bad.status, 400, '坏 JSON 是用户输入问题，回 400 不回 500')
  })
})

test('④ private 三出口：bootstrap / profile 默认不含 private 原文，?private=1 才给', async () => {
  await withServer(async ({ url }) => {
    const boot = await (await fetch(`${url}api/aml/bootstrap`)).json()
    for (const p of boot.profiles) {
      assert.equal(p.mind.death.items.length, 0, '默认不给私密原文')
      assert.ok(p.privateCount > 0, '但要给条数（界面据此提示"还有 N 条"）')
    }

    const one = await (await fetch(`${url}api/aml/profile/demo1`)).json()
    assert.equal(one.profile.mind.death.items.length, 0)
    const privy = await (await fetch(`${url}api/aml/profile/demo1?private=1`)).json()
    assert.equal(privy.profile.mind.death.items.length, 2, '显式 private=1 才返回私密原文')
    assert.equal(privy.profile.mind.death.items.every((x) => x.visibility === 'private'), true)
  })
})

test('⑤ 导出：markdown 可下载、private 原文不进导出、写明有意排除、两条 MRD 警示常驻', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/export/demo1.md`)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/markdown/)
    assert.match(r.headers.get('content-disposition'), /attachment/)
    const md = await r.text()
    assert.match(md, /就诊准备/)
    assert.match(md, /不是医生结论/, '感受区必须带否定语境的抬头')
    assert.equal(/后事都想了一遍|在停车场坐了半小时/.test(md), false, 'private 原文不许进导出')
    assert.match(md, /私密记录（对死亡的准备）按设置不进本摘要/, '要说清"有意排除"')
    assert.match(md, /转阴 ≠ 治愈/, 'K3 警示一常驻')
    assert.match(md, /阳性 ≠ 一定复发/, 'K3 警示二常驻')
    assert.match(md, /零推荐/, 'K4 零推荐常驻')
    assert.match(md, /不判依赖/, 'K5 不判依赖常驻')
    assert.match(md, /流式（LAIP）/, 'K3 双口径分列呈现')
    assert.equal(/是否急症|急症信号/.test(md), false, 'K2：导出里也不写判定结论')
  })
})

test('⑤b 保存导出：写进 <资料目录>/exports/，落盘文件同样不含 private 原文', async () => {
  await withServer(async ({ url, workbench }) => {
    const r = await fetch(`${url}api/aml/export/demo1.md/save`, { method: 'POST' })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.ok(j.file.includes(`${workbench.workspace}/exports/`), `导出要落进资料目录：${j.file}`)
    assert.ok(j.bytes > 500)
    assert.equal(j.excludedPrivate, true)
    const md = readFileSync(j.file, 'utf8')
    assert.equal(/后事都想了一遍/.test(md), false, '落盘文件同样不许带 private 原文')
  })
})

test('⑥ 静态文件：UI 前缀能取到 index.html 与 app.js，路径穿越被拦', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/ui/index.html`)
    assert.equal(r.status, 200)
    assert.match(await r.text(), /小橙宝/)
    assert.match(await (await fetch(`${url}api/aml/ui/app.js`)).text(), /loadBootstrap/, '开发版 app.js 带数据层')

    const evil = await fetch(`${url}api/aml/ui/..%2f..%2fpackage.json`)
    assert.equal((await evil.text()).includes('"private": true'), false, '不许把仓库文件读出去')
  })
})

test('⑦ 未知接口回 JSON 404；错方法回 405（交界守卫：4xx JSON，不裸 throw 500）', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/nope`)
    assert.equal(r.status, 404)
    assert.match(r.headers.get('content-type'), /application\/json/)
    assert.equal((await r.json()).error, 'not_found')

    const post = await fetch(`${url}api/aml/bootstrap`, { method: 'POST' })
    assert.equal(post.status, 405)
    assert.equal((await post.json()).error, 'method_not_allowed')

    const badProfile = await fetch(`${url}api/aml/profile/不存在`)
    assert.equal(badProfile.status, 404)
    assert.equal((await badProfile.json()).error, 'profile_not_found')

    const noProfile = await fetch(`${url}api/aml/temperature`)
    assert.equal(noProfile.status, 400)
    assert.equal((await noProfile.json()).error, 'profile_required')
  })
})

test('⑧ 双形态回归：同一张路由表在「无宿主鉴权」与「模拟宿主鉴权」下行为一致', async () => {
  await withServer(async ({ url, workbench }) => {
    /* 形态 A：独立启动（无 connection）。 */
    const direct = await fetch(`${url}api/aml/health`)
    assert.equal(direct.status, 200)
    assert.equal((await direct.json()).ok, true)

    /* 形态 B：宿主链路——dsh/index.js 的 handler 先过 requestRejection 再进同一张路由表。
       起一个模拟宿主：前缀注册 + 先鉴权后放行/拒答，两种结论都必须回 JSON。 */
    const api = createApiHandler({
      source: {
        db: workbench.db,
        bootstrap: () => workbench.bootstrap(),
        profile: (k, o) => workbench.getProfile(k, o),
        addTemperature: (input) => workbench.addTemperature(input),
        listTemperatures: (k, o) => workbench.listTemperatures(k, o),
      },
      version: workbench.version,
      build: workbench.build,
      serveUi: (req, res, p) => servePublic(req, res, p),
    })
    const host = createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname
      if (!path.startsWith(`${API_PREFIX}/`)) { res.writeHead(404); res.end(); return }
      if (req.headers['x-test-auth'] === 'reject') {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }
      void api(req, res)
    })
    await new Promise((r) => host.listen(0, '127.0.0.1', r))
    const hport = host.address().port
    try {
      const allowed = await fetch(`http://127.0.0.1:${hport}${API_PREFIX}/health`)
      assert.equal(allowed.status, 200, '放行形态与独立启动同一行为')
      assert.equal((await allowed.json()).ok, true)

      const boot = await fetch(`http://127.0.0.1:${hport}${API_PREFIX}/bootstrap`)
      assert.equal(boot.status, 200, '宿主形态也能拿到 bootstrap')

      const rejected = await fetch(`http://127.0.0.1:${hport}${API_PREFIX}/health`, { headers: { 'x-test-auth': 'reject' } })
      assert.equal(rejected.status, 401)
      assert.match(rejected.headers.get('content-type'), /application\/json/, '拒答也必须是 JSON')
      assert.equal((await rejected.json()).error, 'Authentication required')
    } finally {
      await new Promise((r) => host.close(r))
    }
  })
})

test('⑨ 导入接口：无 Token 时如实报 NO_TOKEN（503），不产候选', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/import?name=test.pdf`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('%PDF-1.4 fake'),
    })
    const j = await r.json()
    /* 本机没配 Token 时是 NO_TOKEN/503；配了会是 401/503/502 一类。断言"失败要说清"，不要求成功。 */
    assert.ok([200, 502, 503].includes(r.status), `状态码不该是 ${r.status}`)
    if (r.status !== 200) {
      assert.ok(['NO_TOKEN', 'UNAUTHORIZED', 'NETWORK', 'TIMEOUT', 'API_ERROR', 'BAD_INPUT', 'TASK_FAILED', 'NO_MARKDOWN', 'BAD_ZIP', 'BAD_SECRET_FILE']
        .includes(j.error), `失败原因不在已知枚举里：${j.error}`)
      assert.equal(Array.isArray(j.candidates), false, '解析失败不许返回候选')
    }

    /* 白名单之外的文件类型：入口侧拦，不烧云端额度。 */
    const html = await fetch(`${url}api/aml/import?name=x.html`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('<html>'),
    })
    assert.equal(html.status, 400)
    assert.equal((await html.json()).error, 'BAD_INPUT')
  })
})

test('⑩ 设置接口：GET 给三态状态且无 token 原文；坏 JSON 的 POST 回 400', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/aml/settings/mineru`)
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.ok(['none', 'file', 'env'].includes(j.source))
    assert.equal('token' in j, false, '响应体不许出现 token 原文字段')
    assert.match(j.tokenUrl, /mineru\.net\/apiManage\/token/, 'Token 故障要能给出申请地址')

    const bad = await fetch(`${url}api/aml/settings/mineru`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error, 'BAD_INPUT')

    const invalid = await fetch(`${url}api/aml/settings/mineru`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x' }),
    })
    assert.equal(invalid.status, 400, '太短的 Token 是用户输入问题，回 400 不回 500')
    assert.equal((await invalid.json()).error, 'invalid_token')
  })
})

test('⑪ 资料目录校验：主目录 / 桌面 / /tmp 一律拒绝，API 前缀是定稿契约', () => {
  assert.ok(validateWorkspacePath(homedir()).length > 0)
  assert.ok(validateWorkspacePath(join(homedir(), 'Desktop')).length > 0)
  assert.ok(validateWorkspacePath('/tmp/x').length > 0)
  assert.deepEqual(validateWorkspacePath(join(tmp, 'ok')), [], '自己新建的目录应当可用')
  assert.equal(API_PREFIX, '/api/aml', 'apiBase 定稿契约')
  assert.equal(UI_PREFIX, '/api/aml/ui')
})

test('⑫ 前端接口基址推导：`/api/aml/ui/` 只推出一次 `/api/aml`（拼接两遍就 404 后静默退回演示数据）', () => {
  /* 2026-10-26 M5 实测踩过：apiBase() 返回 /api/aml，调用方又接了 '/api/aml/bootstrap'，
     请求打到 /api/aml/api/aml/bootstrap → 404 → 页面顶部写"离线演示数据"。
     这个 bug 的可怕之处是 bootstrap 本身 200、所有后端测试全绿——只有真在浏览器里
     看顶部那条横幅才看得出来。所以把推导规则抽出来在 Node 里跑一遍。 */
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const fnSrc = appJs.match(/function apiBase\(\)\s*\{[\s\S]*?\n\}/)?.[0]
  assert.ok(fnSrc, 'app.js 里找不到 apiBase()：数据层被改写过？')
  /* 隔离执行：把 location 换成三种形态，逐个验推导结果。 */
  const run = (location) => new Function('location', `${fnSrc}\nreturn apiBase();`)(location)
  assert.equal(run({ protocol: 'http:', pathname: '/api/aml/ui/' }), '/api/aml')
  assert.equal(run({ protocol: 'http:', pathname: '/api/aml/ui' }), '/api/aml')
  assert.equal(run({ protocol: 'http:', pathname: '/api/aml/ui/index.html' }), '/api/aml')
  assert.equal(run({ protocol: 'file:', pathname: '/x/index.html' }), null, 'file:// 不发请求，直接读 DEMO_DATA')

  /* 调用方只许接后缀，不许再把前缀拼一遍。 */
  assert.equal(/base\s*\+\s*['"]\/api\/aml\//.test(appJs), false, 'bootstrap 地址把 /api/aml 拼了两遍')
  assert.match(appJs, /base\s*\+\s*['"]\/bootstrap['"]/, 'loadBootstrap 应只接 /bootstrap 后缀')
})
