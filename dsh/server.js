/**
 * HTTP 层：一个 /api/aml 前缀的 JSON 接口 + public/ 静态文件。
 * 零依赖，只用 node:http / node:fs。
 *
 * 三件事这里说了算：
 * 1. 静态文件只在 public/ 目录内解析；`..` 一律拦掉（路径穿越）；
 * 2. 未知 /api/* 返回 JSON 404，不返回 HTML（前端按 JSON 解析）；
 * 3. workspaceProblems：资料目录必须由用户选定——主目录 / 桌面 / 下载 / 文稿根、/tmp、/var
 *    都在拒绝清单里；父目录不存在不静默创建，把可读错误交回调用方。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler, API_PREFIX, UI_PREFIX } from './routes.js'

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/* ---------------- 工作区路径校验 ---------------- */

/** 返回人类可读的问题；空数组＝可以用。 */
export function workspaceProblems(p) {
  if (typeof p !== 'string' || !p.trim()) return ['资料目录不能为空：需要你明确选择一个目录']
  const target = resolve(p)
  const home = resolve(homedir())
  const problems = []
  if (target === home) problems.push('不能用主目录当资料目录（会和个人文件混在一起）')
  if (target === '/tmp' || target.startsWith('/tmp' + sep) || target === '/var' || target.startsWith('/var' + sep)) {
    problems.push('不能用 /tmp 或 /var：系统可能会清理，资料会丢')
  }
  for (const name of ['Desktop', 'Downloads', 'Documents']) {
    const d = join(home, name)
    if (target === d) problems.push(`不能用「${name}」根目录当资料目录：请在它下面新建一个目录`)
  }
  if (!existsSync(dirname(target))) problems.push(`上级目录不存在：${dirname(target)}（不自动创建，请确认你选的位置）`)
  return problems
}

export function assertWorkspacePath(p) {
  const problems = workspaceProblems(p)
  if (problems.length) throw new Error(problems.join('；'))
  return resolve(p)
}

/* ---------------- 静态文件 ---------------- */

function safeJoin(root, urlPath) {
  let clean
  try {
    clean = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0])
  } catch {
    return null /* 非法百分号编码：拒绝，不猜 */
  }
  const rel = clean.replace(/^\/+/, '')
  const full = resolve(root, rel || 'index.html')
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

function sendFile(res, file) {
  try {
    const st = statSync(file)
    if (!st.isFile()) return false
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    })
    if (res.req?.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(file).pipe(res)
    return true
  } catch {
    return false
  }
}

/**
 * 把 public/ 下的文件按 urlPath 回出去（只读 GET/HEAD，路径穿越已拦）。
 * 独立启动与 DSH 宿主两条链路共用这一份。
 * @returns {boolean} 是否已经写完响应
 */
export function servePublic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return true
  }
  const file = safeJoin(PUBLIC_DIR, urlPath)
  if (file && sendFile(res, file)) return true
  return sendFile(res, join(PUBLIC_DIR, 'index.html'))
}

export function createHandler({ workbench }) {
  /* 路由表与 DSH 宿主共用 dsh/routes.js：本地能开的路径，装进 Desktop 也一定在。
     独立启动没有宿主鉴权（只有本机回环访问），所以不传 connection。 */
  const api = createApiHandler({
    source: {
      db: workbench.db,
      bootstrap: () => workbench.bootstrap(),
      profile: (key, opts) => workbench.getProfile(key, opts),
      saveExport: (key) => workbench.saveExport(key),
      addTemperature: (input) => workbench.addTemperature(input),
      listTemperatures: (key, opts) => workbench.listTemperatures(key, opts),
      listTrials: (params) => workbench.listTrials(params),
      addSavedTrial: (input) => workbench.addSavedTrial(input),
      listSavedTrials: (key) => workbench.listSavedTrials(key),
      addRecord: (kind, input) => workbench.addRecord(kind, input),
      listRecords: (kind, key, opts) => workbench.listRecords(kind, key, opts),
    },
    version: workbench.version,
    build: workbench.build,
    serveUi: (req, res, urlPath) => servePublic(req, res, urlPath),
  })

  return function handle(req, res) {
    let path
    try {
      path = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).pathname
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'bad_url' }))
      return
    }
    if (path.startsWith('/api/') || path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
      void api(req, res)
      return
    }
    void servePublic(req, res, path)
  }
}

/** 起服务。port=0 时由系统分配（测试用），返回实际端口。 */
export function startWorkbenchServer({ port = 4173, host = '127.0.0.1', workbench }) {
  if (!workbench) throw new Error('startWorkbenchServer 需要一个 workbench 实例')
  const server = createServer(createHandler({ workbench }))
  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, host, () => {
      const actual = server.address().port
      res({ server, port: actual, host, url: `http://${host}:${actual}/` })
    })
  })
}

export { API_PREFIX, UI_PREFIX }
