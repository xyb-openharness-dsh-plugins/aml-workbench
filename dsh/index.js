/**
 * 包的入口：DSH 插件的服务端侧。宿主加载的就是这个文件，需要
 * name / inject / Config / apply 四样（workbench-standard §3.4）。
 *
 * 这一层只做四件事：
 * 1. 打开数据：配了 root（cordis.patch.yml 已注入 config.root = dshHomePath('aml-workbench')）
 *    就用那个资料目录；没配就退到内存演示库，保证装上去能看见东西；
 * 2. 过宿主鉴权（connection.requestRejection），不自己造登录；
 * 3. 把请求交给 dsh/routes.js 那张两条链路共用的路由表（dev-server 用同一份）；
 * 4. 卸载时按序关库。
 *
 * **config.root 必须真的被读到**（家族回收的装机坑：Config 声明了 root 但 apply 里没用，
 * 装机能打开、每次重启回到内存库，用户资料一条不剩）。所以这里把 config.root 透传进
 * openDataSource，并在 bootstrap 的 source 字段里回报实际数据源形态
 * （memory / workspace），装机探针据此一眼看出"到底落在哪"。
 *
 * UI 走 iframe：业务界面（public/，由 scripts/sync-public.mjs 从 prototypes/v0.2 同步）
 * 指向 /api/aml/ui/，页面里的接口基址按自身路径推出来（public/app.js 的 apiBase()），
 * 所以「本地 dev-server 打开」与「装进 Desktop」用同一份前端。
 */
import Schema from '@deepseek-ai/schemastery'
import { readFileSync } from 'node:fs'
import { appendSavedTrial, appendTemperature, close, insertRecord, listRecords, listSavedTrials, migrate, openDatabase, readTrialSnapshot, RECORD_KINDS } from './store.js'
import { seedDemo, hasDemoData } from './demo.js'
import { bootstrap, getProfile, listProfiles } from './readmodels.js'
import { servePublic } from './server.js'
import { createApiHandler, API_PREFIX, UI_PREFIX } from './routes.js'
import { version, build } from '../lib/version.js'

export const name = 'aml-workbench-main'
export const inject = ['webServer', 'connection']

/** 接口前缀与 UI 前缀：真身在 routes.js；这里再导出一次给包检查与前端文档。 */
export { API_PREFIX, UI_PREFIX }

/** Config 必须是 Schemastery schema；root 可选——不给就用内存演示库（只读演示，不落盘）。 */
export const Config = Schema.object({
  root: Schema.string(),
})

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' })
  res.end(buf)
}

/** 读体温（按 measured_at 排序，小时级轨道；K2 不判定）。 */
function listTemperatures(db, key, opts) {
  const p = getProfile(db, key, opts)
  if (!p) return null
  const readings = (p.neu?.fever?.episodes ?? [])
    .flatMap((ep) => (ep.temps ?? []).map((t) => ({ ...t, episodeId: ep.id, label: ep.label })))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  return { profile: key, readings }
}

/** 打开数据源。返回 { db, mode, root, bootstrap(), profile(), close() }。 */
function openDataSource(root) {
  const dir = root ? String(root).replace(/\/+$/, '') : null
  const file = dir ? `${dir}/amlpal.sqlite` : ':memory:'
  const db = openDatabase(file)
  migrate(db)
  if (!hasDemoData(db)) seedDemo(db, JSON.parse(readFileSync(new URL('../demo/demo-data.json', import.meta.url), 'utf8')))
  const mode = dir ? 'workspace' : 'memory'
  return {
    db,
    mode,
    root: dir,
    bootstrap: () => ({
      ...bootstrap(db, { version, build }),
      capabilities: [
        'bootstrap', 'profile', 'temperature', 'export', 'import', 'candidate', 'parse', 'mineru-settings',
        'trials.read', 'saved-trials.write', 'records.write', 'records.read',
        ...Object.keys(RECORD_KINDS).map((k) => `records.${k}`),
      ],
      source: { mode, root: dir },
    }),
    profile: (key, opts) => getProfile(db, key, opts),
    listProfiles: () => listProfiles(db),
    addTemperature: (input) => appendTemperature(db, input),
    listTemperatures: (key, opts) => listTemperatures(db, key, opts),
    listTrials: (params) => readTrialSnapshot(params),
    addSavedTrial: (input) => appendSavedTrial(db, input),
    listSavedTrials: (key) => listSavedTrials(db, key),
    addRecord: (kind, input) => insertRecord(db, kind, input),
    listRecords: (kind, key, opts) => ({ kind, profile: key, items: listRecords(db, kind, key, opts) }),
    close: () => close(db),
  }
}

export function apply(ctx, config = {}) {
  if (!ctx.webServer?.register) throw new Error('Desktop webServer.register is unavailable')

  let source = null
  let failure = null
  try {
    source = openDataSource(config?.root)
  } catch (error) {
    failure = error.message
  }

  const api = createApiHandler({
    source: source ?? {
      db: null,
      bootstrap: () => { throw new Error(failure) },
      profile: () => null,
    },
    version,
    build,
    serveUi: (req, res, urlPath) => servePublic(req, res, urlPath),
    failure,
  })

  const handler = (req, res) => {
    /* 鉴权：宿主不给结论就不放行，不自建登录态。 */
    if (typeof ctx.connection?.requestRejection !== 'function') {
      return sendJson(res, 503, { error: 'connection authentication capability unavailable' })
    }
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return sendJson(res, rejection, { error: 'Authentication required' })

    /* 数据源打不开时只有 /health 能回（带错误原因），其余走各自分支的 503。 */
    return api(req, res)
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
    return () => {
      try { dispose && dispose() } catch { /* 宿主卸载时的清理失败不该盖住原错误 */ }
      if (source) { try { source.close() } catch { /* 同上 */ } }
    }
  }, 'aml-workbench ui + api')

  /* 数据源形态只通过 bootstrap 的 source 字段回报（见 routes.js）——
     不要挂到 ctx 上：宿主 0.2.0-rc.2 要求 ctx 上的每个键都必须先在 provide 里声明，
     否则 apply 抛 `cannot set property "amlWorkbench" without provide`，整个插件不激活。
     （2026-10-26 真机回收：桩件烟测不校验 provide，所以本地全绿、装上去加载不起来。） */
}
