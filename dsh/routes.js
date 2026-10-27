/**
 * 路由表：独立启动（dev-server）与 DSH 宿主两条链路共用这一份。
 *
 * apiBase 定稿契约：所有路由挂在统一 API_PREFIX=/api/aml 下，
 * UI 在 /api/aml/ui/（public/ 由 scripts/sync-public.mjs 从 prototypes/v0.2 逐字符同步）。
 *
 * 交界守卫（本文件最重要的纪律）：
 * - 请求校验失败一律 4xx JSON（400/404/405/413），**不裸 throw 变 500**；
 * - 上游（MinerU）失败按错误码分类 502/503，错误码原样透出（前端据此给三个动作）；
 * - 未知路径回 JSON 404，不回 HTML——前端按 JSON 解析，回 HTML 会变成
 *   `Unexpected token '<'`（LESSONS 第 10 类）。
 *
 * 双形态回归：同一张路由表在「独立启动（无宿主鉴权）」与「DSH 宿主（先过
 * connection.requestRejection）」两形态下由同一 handler 服务——test/server.test.mjs 两条链路都打。
 *
 * 鉴权不在这里：宿主链路由 dsh/index.js 先过 requestRejection；
 * 独立启动只有本机回环访问，不需要登录态。这里不许 import Schemastery。
 *
 * K2 特别约定：体温接口只写入/读出**事实**，响应里没有"是否急症"这类判定字段。
 */

export const API_PREFIX = '/api/aml'
export const UI_PREFIX = `${API_PREFIX}/ui`

/** 能力契约面（0.4.0）：通用记录写读按 kind 逐个声明——这就是 AI 写入能力的白名单。
 *  0.6.0：补 profiles.write（空 workspace 建档，三步闭环第 0 步）。 */
export const CAPABILITIES = Object.freeze([
  'bootstrap', 'profile', 'temperature', 'export', 'import', 'candidate', 'parse', 'mineru-settings',
  'trials.read', 'saved-trials.write', 'records.write', 'records.read', 'profiles.write',
  'records.transfusion', 'records.mucositis', 'records.marrow-procedure', 'records.feeling',
  'records.question', 'records.intake', 'records.tx-day', 'records.document',
])

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
const MAX_JSON_BYTES = 64 * 1024

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function sendMarkdown(res, status, text, headers = {}) {
  const buf = Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(buf)
}

/** 错误 → {status, body}。MinerU 的错因直接透传，但不带 token。 */
function errorBody(error) {
  const code = error?.code
  if (code === 'NOT_FOUND') return { status: 404, body: { error: 'not_found', message: error.message } }
  if (code === 'BAD_INPUT' || code === 'BAD_TIME' || code === 'BAD_VALUE' || code === 'BAD_AUTHOR'
    || code === 'BAD_SITE' || code === 'BAD_VISIBILITY' || code === 'PROFILE_NOT_FOUND'
    || code === 'PROFILE_REQUIRED' || code === 'IMMUTABLE_FIELD' || code === 'NOT_VERSIONED'
    || code === 'BAD_KIND' || code === 'FIELD_REQUIRED') {
    return { status: 400, body: { error: code, message: error.message } }
  }
  if (code === 'NO_TOKEN' || code === 'UNAUTHORIZED' || code === 'BAD_SECRET_FILE') {
    return { status: 503, body: { error: code, message: error.message } }
  }
  if (code && typeof code === 'string' && /^[A-Z_]+$/.test(code)) {
    return { status: 502, body: { error: code, message: error.message } }
  }
  if (error?.status === 413) return { status: 413, body: { error: 'too_large', message: error.message } }
  return { status: 500, body: { error: 'internal_error', message: error?.message ?? 'internal error' } }
}

function readBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error(`请求体超过 ${Math.round(limit / 1024 / 1024) || 0.06} MB`), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 读小 JSON 体：空体给 {}，坏 JSON 给 400 语义错误（不抛成 500）。 */
async function readJson(req) {
  let raw
  try {
    raw = await readBody(req, MAX_JSON_BYTES)
  } catch (error) {
    const e = new Error(error.message)
    e.status = 413
    throw e
  }
  if (!raw.length) return {}
  try {
    const parsed = JSON.parse(raw.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const e = new Error('请求体必须是 JSON 对象')
      e.code = 'BAD_INPUT'
      throw e
    }
    return parsed
  } catch (error) {
    if (error.code === 'BAD_INPUT') throw error
    const e = new Error('请求体不是合法 JSON')
    e.code = 'BAD_INPUT'
    throw e
  }
}

/**
 * @param {object} opts
 * @param {{bootstrap():object, profile(key:string, opts?:object):object|null, db:object,
 *          saveExport?:(key:string)=>object, addTemperature?:(input:object)=>object,
 *          listTemperatures?:(key:string, opts?:object)=>object}} opts.source
 * @param {string} opts.version
 * @param {string} opts.build
 * @param {(req:object,res:object,path:string)=>boolean} opts.serveUi 静态文件出口
 * @param {string|null} [opts.failure] 数据源打不开的原因；非空时除 /health 外一律 503
 */
export function createApiHandler({ source, version, build, serveUi, failure = null }) {
  return async function handle(req, res) {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      return sendJson(res, 400, { error: 'bad_url', message: '请求地址解析失败' })
    }
    const path = url.pathname

    if (path === `${API_PREFIX}/health`) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
      return sendJson(res, 200, {
        ok: !failure,
        version,
        build,
        apiVersion: 'v1',
        ui: UI_PREFIX,
        capabilities: [...CAPABILITIES],
        error: failure || undefined,
      })
    }

    if (failure && !(path === UI_PREFIX || path.startsWith(`${UI_PREFIX}/`))) {
      return sendJson(res, 503, { error: 'bootstrap_unavailable', message: failure })
    }

    try {
      if (path === `${API_PREFIX}/bootstrap`) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        return sendJson(res, 200, source.bootstrap())
      }

      /* 建档（0.6.0 三步闭环第 0 步）：只在空 workspace 里允许；已有档案幂等返回 existing。 */
      if (path === `${API_PREFIX}/profiles`) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        if (typeof source.addProfile !== 'function') return sendJson(res, 501, { error: 'profiles_write_unavailable' })
        const body = await readJson(req)
        const saved = source.addProfile({
          name: body?.name,
          age: body?.age ?? null,
          gender: body?.gender ?? null,
          caregiver: body?.caregiver ?? null,
          newProfile: body?.newProfile === true,
        })
        const all = typeof source.listProfiles === 'function' ? source.listProfiles() : []
        const hit = all.find((p) => p.id === saved.id) ?? all[0] ?? null
        return sendJson(res, 200, {
          existing: Boolean(saved.existing),
          profile: hit ?? { id: saved.id, name: saved.name },
          profileId: saved.id,
        })
      }

      /* 单档案：private 看法默认不给，只有显式 ?private=1 才返回原文（三出口口径统一）。 */
      const profileMatch = path.match(new RegExp(`^${API_PREFIX}/profile/([^/]+)$`))
      if (profileMatch) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        const key = decodeURIComponent(profileMatch[1])
        const profile = source.profile(key, { includePrivate: url.searchParams.get('private') === '1' })
        if (!profile) return sendJson(res, 404, { error: 'profile_not_found', key })
        return sendJson(res, 200, { profile })
      }

      /* 体温：只写事实（K2 判定在前端；响应里没有 level/isEmergency 这类字段）。 */
      if (path === `${API_PREFIX}/temperature`) {
        if (req.method === 'POST') {
          if (typeof source.addTemperature !== 'function') return sendJson(res, 501, { error: 'temperature_write_unavailable' })
          const body = await readJson(req)
          const saved = source.addTemperature({
            profileId: body.profileId,
            measuredAt: body.measuredAt ?? body.ts,
            valueC: body.valueC ?? body.v,
            site: body.site ?? null,
            authorRole: body.authorRole ?? body.author ?? 'PATIENT',
            visibility: body.visibility ?? 'public',
            episodeId: body.episodeId ?? null,
          })
          return sendJson(res, 200, { reading: saved })
        }
        if (req.method === 'GET') {
          if (typeof source.listTemperatures !== 'function') return sendJson(res, 501, { error: 'temperature_read_unavailable' })
          const key = url.searchParams.get('profile') || null
          if (!key) return sendJson(res, 400, { error: 'profile_required', message: '需要 ?profile=<档案 id>' })
          return sendJson(res, 200, source.listTemperatures(key, { includePrivate: url.searchParams.get('private') === '1' }))
        }
        return sendJson(res, 405, { error: 'method_not_allowed' })
      }

      /* 导出：private 记录一律不进导出（export.js 约束 1，调用方传 private=1 也不带出去）。 */
      const exportMatch = path.match(new RegExp(`^${API_PREFIX}/export/([^/]+)\\.md$`))
      if (exportMatch) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        const key = decodeURIComponent(exportMatch[1])
        const full = source.profile(key, { includePrivate: true })
        if (!full) return sendJson(res, 404, { error: 'profile_not_found', key })
        const excludedPrivate = full.privateCount > 0
        const { renderPrepMarkdown, exportFilename } = await import('./export.js')
        const md = renderPrepMarkdown(full, {
          generatedAt: new Date().toISOString().slice(0, 10),
          version,
          excludedPrivate,
        })
        return sendMarkdown(res, 200, md, {
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exportFilename(full))}`,
        })
      }

      /* 把导出写进资料目录 exports/（宿主/独立启动；无 workspace 的形态返回 501）。 */
      const saveMatch = path.match(new RegExp(`^${API_PREFIX}/export/([^/]+)\\.md/save$`))
      if (saveMatch) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        if (typeof source.saveExport !== 'function') return sendJson(res, 501, { error: 'export_save_unavailable' })
        return sendJson(res, 200, source.saveExport(decodeURIComponent(saveMatch[1])))
      }

      /* 导入（解析候选→待核对）：原始字节 + 查询串。只写候选不写事实层。 */
      if (path === `${API_PREFIX}/import`) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        const filename = url.searchParams.get('name') || 'document.pdf'
        const profileId = url.searchParams.get('profile') || 'demo1'
        /* 白名单先拦：不认识的文件类型是用户输入问题（400），不该先去找 Token 再报 503——
           那会让用户以为"是 Token 没配"，去设置页白折腾一趟（docs/18 §1 原则 6 的同一类错）。 */
        if (!/\.(pdf|jpg|jpeg|png|zip|docx|xlsx)$/i.test(filename)) {
          return sendJson(res, 400, {
            error: 'BAD_INPUT',
            message: `不支持的文件类型：${filename}（.html 上游必拒；.txt/.md/.csv 不走云端解析）`,
          })
        }
        const { parseAndRecord, listCandidates, recordDocumentFailure } = await import('./parse.js')
        const { createMineruClient } = await import('./mineru.js')
        const bytes = await readBody(req)
        if (!bytes.length) return sendJson(res, 400, { error: 'empty_body', message: '请求体是空的' })
        let client = null
        let tokenError = null
        try { client = createMineruClient() } catch (e) { tokenError = e }
        if (!client) {
          /* 0.6.0：无 Token/客户端不可用时也落 parse_failed 行（审计链 + 第 2 步如实显示失败原因）。 */
          const failed = recordDocumentFailure(source.db, { bytes, filename, profileId })
          return sendJson(res, 503, {
            error: 'NO_TOKEN',
            message: tokenError?.message || '没有可用的 MinerU 客户端（缺 token？）',
            documentId: failed.documentId,
            status: 'parse_failed',
          })
        }
        const result = await parseAndRecord(source.db, { bytes, filename, profileId, client })
        return sendJson(res, 200, {
          documentId: result.documentId,
          status: result.status,
          candidates: listCandidates(source.db, { documentId: result.documentId }),
          skipped: result.skipped,
          pages: result.pages ?? null,
        })
      }

      /* 候选清单 / 确认 / 拒收。 */
      if (path === `${API_PREFIX}/candidates`) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        const { listCandidates } = await import('./parse.js')
        return sendJson(res, 200, { candidates: listCandidates(source.db) })
      }
      const acceptMatch = path.match(new RegExp(`^${API_PREFIX}/candidate/([^/]+)/(accept|reject)$`))
      if (acceptMatch) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        const parse = await import('./parse.js')
        const id = decodeURIComponent(acceptMatch[1])
        /* 0.6.0：治疗候选确认必须带 D1 起始日期（body {d1:'YYYY-MM-DD'}），这里透传给 acceptCandidate；
           其它 kind 忽略该字段。缺 d1 → 400 FIELD_REQUIRED（前端先弹日期框再 accept）。 */
        const body = await readJson(req)
        const result = acceptMatch[2] === 'accept'
          ? parse.acceptCandidate(source.db, id, { d1: body?.d1 ?? null })
          : parse.rejectCandidate(source.db, id)
        return sendJson(res, 200, result)
      }

      /* 文档解析设置：GET 状态（掩码+路径，无原文）/ POST 存或清。 */
      if (path === `${API_PREFIX}/settings/mineru`) {
        const settings = await import('./settings.js')
        if (req.method === 'GET') {
          try {
            return sendJson(res, 200, settings.mineruSettingsStatus())
          } catch (error) {
            return sendJson(res, 500, { error: 'settings_unavailable', message: error.message })
          }
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        const body = await readJson(req)
        try {
          const status = body?.action === 'clear'
            ? settings.clearMineruToken()
            : settings.saveMineruToken(body?.token)
          return sendJson(res, 200, status)
        } catch (error) {
          const bad = /请先填写|太短|过长|不能有空格|意外字符|不合法 JSON|不是对象/.test(error.message)
          return sendJson(res, bad ? 400 : 500, {
            error: bad ? 'invalid_token' : 'settings_write_failed',
            message: error.message,
          })
        }
      }

      /* 临床试验检索（35 号）：本机登记快照（只读），keyword/status/limit；
         快照文件缺失返回 source:'missing' + 空列表，不抛错不编数据。 */
      if (path === `${API_PREFIX}/trials`) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        if (typeof source.listTrials !== 'function') return sendJson(res, 501, { error: 'trials_read_unavailable' })
        return sendJson(res, 200, source.listTrials({
          keyword: url.searchParams.get('keyword') || '',
          status: url.searchParams.get('status') || '',
          limit: url.searchParams.get('limit') || 50,
        }))
      }

      /* 试验收藏（35 号 §四：只落 saved_trial，不新增打分列）。 */
      if (path === `${API_PREFIX}/saved-trials`) {
        if (req.method === 'POST') {
          if (typeof source.addSavedTrial !== 'function') return sendJson(res, 501, { error: 'saved_trials_write_unavailable' })
          const body = await readJson(req)
          return sendJson(res, 200, source.addSavedTrial({ profileId: body.profileId, trialKey: body.trialKey ?? body.key }))
        }
        if (req.method === 'GET') {
          if (typeof source.listSavedTrials !== 'function') return sendJson(res, 501, { error: 'saved_trials_read_unavailable' })
          const key = url.searchParams.get('profile') || null
          if (!key) return sendJson(res, 400, { error: 'profile_required', message: '需要 ?profile=<档案 id>' })
          return sendJson(res, 200, { profile: key, items: source.listSavedTrials(key) })
        }
        return sendJson(res, 405, { error: 'method_not_allowed' })
      }

      /* 通用记录写读（0.4.0）：kind 白名单在 store.js RECORD_KINDS（schema/0001 逐列）。
         原生 Agent/会话与手工表单同一条写路径；非法 kind 是用户输入问题 → 400 JSON。 */
      const recordsMatch = path.match(new RegExp(`^${API_PREFIX}/records/([a-z-]+)$`))
      if (recordsMatch) {
        const kind = recordsMatch[1]
        if (req.method === 'POST') {
          if (typeof source.addRecord !== 'function') return sendJson(res, 501, { error: 'records_write_unavailable' })
          const body = await readJson(req)
          return sendJson(res, 200, source.addRecord(kind, body))
        }
        if (req.method === 'GET') {
          if (typeof source.listRecords !== 'function') return sendJson(res, 501, { error: 'records_read_unavailable' })
          const key = url.searchParams.get('profile') || null
          if (!key) return sendJson(res, 400, { error: 'profile_required', message: '需要 ?profile=<档案 id>' })
          return sendJson(res, 200, source.listRecords(kind, key, { includePrivate: url.searchParams.get('private') === '1' }))
        }
        return sendJson(res, 405, { error: 'method_not_allowed' })
      }

      if (path === UI_PREFIX || path.startsWith(`${UI_PREFIX}/`)) {
        return void serveUi(req, res, path.slice(UI_PREFIX.length) || '/')
      }
      return sendJson(res, 404, { error: 'not_found', path })
    } catch (error) {
      /* 兜底也返回 JSON：任何一条分支抛错都不许变成 HTML 500。 */
      const { status, body } = errorBody(error)
      return sendJson(res, status, body)
    }
  }
}
