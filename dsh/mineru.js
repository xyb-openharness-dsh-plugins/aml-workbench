/**
 * MinerU 云端解析客户端（六部件之一；API v4 四步协议 + 错误分类）。
 *
 *   ① POST /file-urls/batch 申请上传链接 → ② PUT 上传原件（不设 Content-Type）
 *   → ③ 轮询 GET /extract-results/batch/{id} → ④ 下载 full_zip_url 并取出 full.md。
 *
 * 边界（docs/18-MINERU-PARSING.md v2）：
 * 1. Token 优先级：显式 > 密钥文件 > 环境变量（文件必须排在 env 前面，v1 写反过）；
 * 2. Token 只从 dsh/settings.js 来（唯一实现），错误里只给来源与掩码；
 * 3. 不猜解析结果：拿不到 full.md 就是失败，不返回半份数据当成功；
 * 4. 默认模型 pipeline（家族统一），显式传 modelVersion 可覆盖；只有接口明确拒收时才回退 vlm；
 * 5. .html 不在文件白名单（上游 -10002 拒收），入口侧拦掉而不是留给云端报错。
 */
import { readZip } from '../lib/zip.js'
import { MINERU_TOKEN_URL, maskToken, readMineruToken, secretFile as currentSecretFile } from './settings.js'

export const MINERU_BASE_URL = 'https://mineru.net/api/v4'
export const MINERU_MODEL_DEFAULT = 'pipeline'
/** 云端明确拒收 pipeline 时的回退模型（只此一种回退，不做其它静默降级）。 */
export const MINERU_MODEL_FALLBACK = 'vlm'

/** 接口拒绝 model_version 参数（或该模型）时的业务码，才允许回退；其它错误不换模型。 */
export function modelFallbackWorthy(err) {
  return Boolean(err && (err.code === 'API_ERROR' || err.code === 'BAD_RESPONSE')
    && /model_version|cannot process|not support/i.test(String(err.message)))
}

export { maskToken }

export class MineruError extends Error {
  constructor(code, message, detail = null) {
    super(message)
    this.name = 'MineruError'
    this.code = code
    this.detail = detail
  }
}

/** Token 解析优先级：显式 > 密钥文件 > env。三处都没有就报 NO_TOKEN，不静默匿名请求。 */
export function resolveToken({ token = null, env = process.env, secretFile = currentSecretFile({ env }) } = {}) {
  if (token?.trim()) return { token: token.trim(), source: 'explicit' }
  let fileToken = ''
  try {
    fileToken = readMineruToken({ file: secretFile })
  } catch (error) {
    throw new MineruError('BAD_SECRET_FILE', error.message)
  }
  if (fileToken) return { token: fileToken, source: 'secret-file' }
  if (env?.MINERU_TOKEN?.trim()) return { token: env.MINERU_TOKEN.trim(), source: 'env:MINERU_TOKEN' }
  throw new MineruError(
    'NO_TOKEN',
    `没有 MinerU Token：在工作台「设置 → 文档解析」里填入，或设置环境变量 MINERU_TOKEN。申请地址：${MINERU_TOKEN_URL}`,
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class MineruClient {
  /**
   * @param {object} opts
   * @param {string} [opts.token] 不给就按 resolveToken 的顺序找
   * @param {string} [opts.baseUrl]
   * @param {Function} [opts.fetchImpl] 注入用（单测不联网）
   * @param {number} [opts.requestTimeoutMs]
   */
  constructor({
    token = null, baseUrl = MINERU_BASE_URL, fetchImpl = null,
    requestTimeoutMs = 60000, env = process.env, secretFile = currentSecretFile({ env }),
  } = {}) {
    const resolved = resolveToken({ token, env, secretFile })
    this.token = resolved.token
    this.tokenSource = resolved.source
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl ?? globalThis.fetch
    this.requestTimeoutMs = requestTimeoutMs
  }

  get maskedToken() {
    return maskToken(this.token)
  }

  async #request(method, path, { body = null, raw = false } = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const headers = { Authorization: `Bearer ${this.token}`, Accept: '*/*' }
    if (body !== null && !raw) headers['Content-Type'] = 'application/json'

    const signal = AbortSignal.timeout(this.requestTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: raw ? body : body === null ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new MineruError('TIMEOUT', `MinerU 请求超时（${method} ${url}）`, { url })
      }
      const proxyHint = /HTTPS?_PROXY/i.test(Object.keys(process.env || {}).join(' '))
        ? '（注意：当前版本的内置请求不走系统代理）' : ''
      throw new MineruError('NETWORK', `请求 MinerU 失败：${error.message}${proxyHint}`, { url })
    }

    if (response.status === 401 || response.status === 403) {
      throw new MineruError(
        'UNAUTHORIZED',
        `MinerU 拒绝了这个 Token（HTTP ${response.status}，来源 ${this.tokenSource}，key=${this.maskedToken}）。请到设置里更新 Token。申请地址：${MINERU_TOKEN_URL}`,
        { status: response.status },
      )
    }

    if (raw) {
      if (!response.ok) throw new MineruError('UPLOAD_FAILED', `上传文件失败：HTTP ${response.status}`)
      return null
    }

    let json = null
    try {
      json = await response.json()
    } catch {
      throw new MineruError('BAD_RESPONSE', `MinerU 返回的不是 JSON（HTTP ${response.status}）`, { url })
    }
    if (json?.code !== 0) {
      const message = String(json?.msg ?? '未知错误')
      const code = /token|auth|权限|登录/i.test(message) ? 'UNAUTHORIZED' : 'API_ERROR'
      throw new MineruError(code, `MinerU 接口报错（code=${json?.code}）：${message}`, {
        apiCode: json?.code, traceId: json?.trace_id,
      })
    }
    return json
  }

  /** ① 申请上传链接。返回 batchId 与一一对应的 PUT 地址。 */
  async createUploadBatch({ files, enableFormula = true, enableTable = true, language = 'ch', modelVersion = null, pageRanges = null }) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new MineruError('BAD_INPUT', 'createUploadBatch 需要至少一个文件')
    }
    const body = {
      enable_formula: enableFormula,
      enable_table: enableTable,
      language,
      files: files.map((f) => ({ name: f.name, ...(f.dataId ? { data_id: f.dataId } : {}) })),
    }
    if (modelVersion) body.model_version = modelVersion
    if (pageRanges) body.page_ranges = pageRanges

    const json = await this.#request('POST', '/file-urls/batch', { body })
    const batchId = json?.data?.batch_id
    const urls = json?.data?.file_urls
    if (!batchId || !Array.isArray(urls) || urls.length !== files.length) {
      throw new MineruError('BAD_RESPONSE', '申请上传链接的返回不完整（缺 batch_id 或 file_urls 数量对不上）', { got: json?.data })
    }
    return { batchId, uploadUrls: urls }
  }

  /** ② 上传原件。MinerU 要求不设 Content-Type，所以走 raw。 */
  async uploadFile(uploadUrl, bytes) {
    await this.#request('PUT', uploadUrl, { body: bytes, raw: true })
    return { ok: true }
  }

  /** ③ 查一次批次结果。 */
  async getBatchResult(batchId) {
    const json = await this.#request('GET', `/extract-results/batch/${batchId}`)
    const results = json?.data?.extract_result
    if (!Array.isArray(results)) {
      throw new MineruError('BAD_RESPONSE', '批次结果里没有 extract_result 数组', { got: json?.data })
    }
    return results.map((r) => ({
      fileName: r.file_name ?? null,
      state: r.state ?? null,
      zipUrl: r.full_zip_url ?? null,
      errMsg: r.err_msg ?? null,
      dataId: r.data_id ?? null,
      progress: r.extract_progress ?? null,
    }))
  }

  /** ③ 轮询到全部结束（done / failed）或超时。 */
  async waitForBatch(batchId, { intervalMs = 3000, timeoutMs = 300000, onProgress = null } = {}) {
    const startedAt = Date.now()
    for (;;) {
      const results = await this.getBatchResult(batchId)
      if (onProgress) onProgress(results)
      const pending = results.filter((r) => r.state !== 'done' && r.state !== 'failed')
      if (pending.length === 0) return results
      if (Date.now() - startedAt > timeoutMs) {
        throw new MineruError(
          'TIMEOUT',
          `等了 ${Math.round(timeoutMs / 1000)} 秒还没解析完（batch=${batchId}，仍在 ${[...new Set(pending.map((p) => p.state))].join('/')}）`,
          { batchId, results },
        )
      }
      await sleep(intervalMs)
    }
  }

  /** ④ 下载结果压缩包（不落盘，直接读内存）。 */
  async downloadZip(zipUrl) {
    let response
    try {
      response = await this.fetchImpl(zipUrl, { signal: AbortSignal.timeout(this.requestTimeoutMs) })
    } catch (error) {
      throw new MineruError('NETWORK', `下载解析结果失败：${error.message}`, { zipUrl })
    }
    if (!response.ok) throw new MineruError('DOWNLOAD_FAILED', `下载解析结果失败：HTTP ${response.status}`, { zipUrl })
    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * 完整跑一遍：申请 → 上传 → 轮询 → 下载 → 取出 markdown 与 content_list。
   * 任一环节失败都抛异常，不返回半份结果。state=failed 如实抛 TASK_FAILED。
   */
  async parse({
    bytes, filename, dataId = null, intervalMs = 3000, timeoutMs = 300000,
    enableFormula = true, enableTable = true, language = 'ch', modelVersion = MINERU_MODEL_DEFAULT, pageRanges = null,
  }) {
    if (!bytes || bytes.length === 0) throw new MineruError('BAD_INPUT', '文件内容为空，不提交解析')
    if (!filename?.trim()) throw new MineruError('BAD_INPUT', '缺少文件名（MinerU 按扩展名判类型）')

    let model = modelVersion
    let results
    try {
      const batch = await this.createUploadBatch({
        files: [{ name: filename.trim(), dataId }],
        enableFormula, enableTable, language, modelVersion: model, pageRanges,
      })
      await this.uploadFile(batch.uploadUrls[0], bytes)
      results = await this.waitForBatch(batch.batchId, { intervalMs, timeoutMs })
    } catch (error) {
      if (model === MINERU_MODEL_DEFAULT && modelFallbackWorthy(error)) {
        model = MINERU_MODEL_FALLBACK
        const batch = await this.createUploadBatch({
          files: [{ name: filename.trim(), dataId }],
          enableFormula, enableTable, language, modelVersion: model, pageRanges,
        })
        await this.uploadFile(batch.uploadUrls[0], bytes)
        results = await this.waitForBatch(batch.batchId, { intervalMs, timeoutMs })
      } else {
        throw error
      }
    }
    const first = results[0]

    if (first.state !== 'done') {
      throw new MineruError('TASK_FAILED', `云端解析失败：${first.errMsg || first.state}`, { state: first.state, errMsg: first.errMsg })
    }
    if (!first.zipUrl) throw new MineruError('NO_MARKDOWN', '云端说解析完成，但没给结果压缩包地址', { result: first })

    const zipBytes = await this.downloadZip(first.zipUrl)
    let zip
    try {
      zip = readZip(zipBytes)
    } catch (error) {
      throw new MineruError('BAD_ZIP', `结果压缩包读不了：${error.message}`)
    }
    const mdName = zip.names.find((n) => /full\.md$/i.test(n))
    if (!mdName) throw new MineruError('NO_MARKDOWN', '结果压缩包里没有 full.md')
    const markdown = zip.text(mdName)
    let pages = null
    const clName = zip.names.find((n) => /_content_list\.json$/i.test(n))
    if (clName) {
      try {
        const list = JSON.parse(zip.text(clName))
        pages = list.reduce((a, x) => Math.max(a, Number(x?.page_idx ?? 0) + 1), 0) || null
      } catch { /* 页数推不出就给 null，不猜 */ }
    }
    return { markdown, pages, batch: { model } }
  }
}

/** 默认客户端：token 按 resolveToken 顺序找。 */
export function createMineruClient(options = {}) {
  return new MineruClient(options)
}
