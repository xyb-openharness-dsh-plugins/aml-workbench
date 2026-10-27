/* 六部件接线（MinerU）与宿主入口（dsh/index.js）的离线自检。
 *
 * 六部件按 docs/18-MINERU-PARSING.md v2：
 *   ① dsh/mineru.js（API v4 四步 + 错误分类）
 *   ② dsh/settings.js（Token 唯一实现，文件优先，原子写）
 *   ③ dsh/amlparse.js（表格转管道 + 位置对齐 + 不抽 MRD）
 *   ④ dsh/parse.js（候选 → 待核对，FAILED 如实）
 *   ⑤ dsh/routes.js 的 /settings/mineru 与 /import（4xx/5xx 分类）
 *   ⑥ lib/zip.js（零依赖 ZIP 读取）
 *
 * 这一套专测"部件之间的接缝"：单测各自绿了但接缝错位，症状是"设置页显示已保存、
 * 解析照样 401"（v1 的真实事故）。所以这里对着**调用链**断言，而不是对着单个函数。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { deflateRawSync } from 'node:zlib'

import { MineruClient, MineruError, MINERU_MODEL_DEFAULT, MINERU_MODEL_FALLBACK, modelFallbackWorthy, resolveToken } from '../dsh/mineru.js'
import { maskToken, saveMineruToken, clearMineruToken, mineruSettingsStatus, readMineruToken, validateMineruToken, secretFile } from '../dsh/settings.js'
import { readZip, ZipError } from '../lib/zip.js'
import { createApiHandler, API_PREFIX } from '../dsh/routes.js'
import { servePublic } from '../dsh/server.js'
import { openDatabase, migrate, close } from '../dsh/store.js'
import { seedDemo } from '../dsh/demo.js'
import { readDemoJson } from '../demo/build-demo-data.mjs'
import { bootstrap, getProfile } from '../dsh/readmodels.js'

const tmp = mkdtempSync(join(tmpdir(), 'amlpal-mineru-test-'))
after(() => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ } })

/* ---------------- ⑥ lib/zip.js：造一个真 ZIP 读回来 ---------------- */

/** 造一个最小 ZIP（store 与 deflate 各一条），不给第三方库。 */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.from(content, 'utf8')
    const deflated = deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

test('① 六部件之一：lib/zip.js 能读出 full.md 与 content_list（store + deflate 两种压缩）', () => {
  const zip = makeZip({
    'full.md': '# 血常规\n| 项目 | 结果 |\n| --- | --- |\n| 血红蛋白 | 68 |\n',
    'x_content_list.json': JSON.stringify([{ page_idx: 0 }, { page_idx: 1 }]),
    'tiny.txt': 'a',
  })
  const z = readZip(zip)
  assert.ok(z.has('full.md'))
  assert.match(z.text('full.md'), /血红蛋白/)
  assert.deepEqual(JSON.parse(z.text('x_content_list.json')).length, 2)
  assert.equal(z.text('tiny.txt'), 'a', '退化用 store 的条目也要能读')
  assert.throws(() => readZip(Buffer.from('not a zip at all')), ZipError)
})

/* ---------------- ② settings.js：唯一实现 + 原子写 + 掩码 ---------------- */

test('② 六部件之二：Token 保存/读取/清除走同一文件，状态只给掩码与路径', () => {
  const file = join(tmp, 'secrets', 'mineru.json')
  const saved = saveMineruToken('sk-abcdef0123456789', { file, env: {} })
  assert.equal(saved.configured, true)
  assert.equal(saved.source, 'file')
  assert.equal(saved.masked, 'sk-****6789', '掩码只留前 3 后 4')
  assert.equal('token' in saved, false, '状态里不许有 token 原文')
  assert.equal(statSync(file).mode & 0o777, 0o600, '密钥文件权限 600')
  assert.equal(readMineruToken({ file }), 'sk-abcdef0123456789')

  /* 环境变量存在时，文件仍然优先（v2 定稿：换了新 Token 还是 401 的根因就是这条反了）。 */
  const withEnv = mineruSettingsStatus({ file, env: { MINERU_TOKEN: 'sk-env-old-000000' } })
  assert.equal(withEnv.source, 'file', '文件优先于 env')

  const cleared = clearMineruToken({ file, env: {} })
  assert.equal(cleared.configured, false)
  assert.equal(cleared.fileExists, false, '只剩 token 键时清除后文件应删除')
})

test('②b 坏文件不覆盖：非法 JSON 的密钥文件在保存时报错并原样保留', () => {
  const file = join(tmp, 'broken', 'mineru.json')
  const { mkdirSync, writeFileSync } = require_fs()
  mkdirSync(join(tmp, 'broken'), { recursive: true })
  writeFileSync(file, '{ not json')
  try {
    assert.throws(() => saveMineruToken('sk-abcdef0123456789', { file, env: {} }), /不是合法 JSON/)
    assert.equal(readFileSync(file, 'utf8'), '{ not json', '坏文件必须原样保留（销毁现场等于让人查不出原因）')
    assert.throws(() => readMineruToken({ file }), /不是合法 JSON/, '读不出要报错，不能当成"没配"')
    const status = mineruSettingsStatus({ file, env: {} })
    assert.ok(status.error, '状态里要如实带错误')
  } finally {
    rmSync(join(tmp, 'broken'), { recursive: true, force: true })
  }
})

function require_fs() {
  return { mkdirSync: (p, o) => fsMkdir(p, o), writeFileSync: (p, c) => fsWrite(p, c) }
}
import { mkdirSync as fsMkdir, writeFileSync as fsWrite } from 'node:fs'

test('②c Token 格式校验：空白/超长/意外字符都是用户输入问题（有具体修法）', () => {
  assert.throws(() => validateMineruToken(''), /请先填写/)
  assert.throws(() => validateMineruToken('short'), /太短/)
  assert.throws(() => validateMineruToken('sk-abc def ghi'), /不能有空格/)
  assert.throws(() => validateMineruToken('sk-abc$def'), /意外字符/)
  assert.throws(() => validateMineruToken('x'.repeat(2048)), /过长/)
  assert.equal(validateMineruToken('  sk-abcdef0123456789  '), 'sk-abcdef0123456789', '首尾空白要吃掉')
  assert.equal(maskToken(''), '')
  assert.equal(maskToken('abc'), 'a****')
})

/* ---------------- ① mineru.js：四步协议 + 错误分类（注入 fetch，不联网） ---------------- */

test('① 六部件之一：四步链路跑通（申请→上传→轮询→下载→取 full.md）', async () => {
  const zip = makeZip({ 'full.md': '| 项目 | 结果 |\n| --- | --- |\n| 血红蛋白 | 68 |', 'x_content_list.json': JSON.stringify([{ page_idx: 0 }, { page_idx: 1 }, { page_idx: 2 }]) })
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', hasContentType: Boolean(init.headers?.['Content-Type']) })
    if (url.endsWith('/file-urls/batch')) {
      const body = JSON.parse(init.body)
      return { status: 200, ok: true, json: async () => ({ code: 0, data: { batch_id: 'b1', file_urls: ['https://upload/x'] } }), _body: body }
    }
    if (url === 'https://upload/x') return { status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
    if (url.includes('/extract-results/batch/b1')) {
      return { status: 200, ok: true, json: async () => ({ code: 0, data: { extract_result: [{ file_name: 'a.pdf', state: 'done', full_zip_url: 'https://cdn/z.zip' }] } }) }
    }
    if (url === 'https://cdn/z.zip') return { status: 200, ok: true, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }
    throw new Error(`未预期的请求：${url}`)
  }
  const client = new MineruClient({ token: 'sk-test-abcdef123456', fetchImpl, timeoutMs: 1000 })
  const out = await client.parse({ bytes: Buffer.from('%PDF'), filename: 'a.pdf', intervalMs: 1 })
  assert.match(out.markdown, /血红蛋白/, '必须拿到 full.md 的内容')
  assert.equal(out.pages, 3, '页数从 content_list 的 page_idx 上限推')
  assert.equal(out.batch.model, MINERU_MODEL_DEFAULT, '默认模型 pipeline（跨工作台统一）')
  /* 上传那一步不能带 Content-Type（MinerU 会拒）。 */
  const upload = calls.find((c) => c.method === 'PUT')
  assert.equal(upload.hasContentType, false, '上传原件不许设 Content-Type')
})

test('①b 错误分类：401 → UNAUTHORIZED（带来源与掩码）；state=failed → TASK_FAILED', async () => {
  const unauth = new MineruClient({
    token: 'sk-test-abcdef123456',
    fetchImpl: async () => ({ status: 401, ok: false, json: async () => ({}) }),
  })
  await assert.rejects(() => unauth.createUploadBatch({ files: [{ name: 'a.pdf' }] }), (e) => {
    assert.equal(e.code, 'UNAUTHORIZED')
    assert.match(e.message, /sk-\*\*\*\*3456/, '只给掩码，不给原文')
    assert.match(e.message, /secret|explicit|env/, '要说清 Token 来源')
    assert.match(e.message, /apiManage\/token/, '要给申请/重置地址')
    return true
  })

  const zipOk = makeZip({ 'full.md': 'x' })
  const failed = new MineruClient({
    token: 'sk-test-abcdef123456',
    fetchImpl: async (url) => {
      if (url.endsWith('/file-urls/batch')) return { status: 200, ok: true, json: async () => ({ code: 0, data: { batch_id: 'b', file_urls: ['https://u/x'] } }) }
      if (url === 'https://u/x') return { status: 200, ok: true }
      if (url.includes('/extract-results/')) return { status: 200, ok: true, json: async () => ({ code: 0, data: { extract_result: [{ state: 'failed', err_msg: '解析引擎崩了' }] } }) }
      return { status: 200, ok: true, arrayBuffer: async () => zipOk.buffer.slice(zipOk.byteOffset, zipOk.byteOffset + zipOk.byteLength) }
    },
  })
  await assert.rejects(() => failed.parse({ bytes: Buffer.from('x'), filename: 'a.pdf', intervalMs: 1 }), (e) => {
    assert.equal(e.code, 'TASK_FAILED')
    assert.match(e.message, /解析引擎崩了/, '云端给的错因要透传')
    return true
  })
})

test('①c 没有 full.md 就是失败：不返回半份数据当成功', async () => {
  const noMd = makeZip({ 'other.txt': 'hello' })
  const client = new MineruClient({
    token: 'sk-test-abcdef123456',
    fetchImpl: async (url) => {
      if (url.endsWith('/file-urls/batch')) return { status: 200, ok: true, json: async () => ({ code: 0, data: { batch_id: 'b', file_urls: ['https://u/x'] } }) }
      if (url === 'https://u/x') return { status: 200, ok: true }
      if (url.includes('/extract-results/')) return { status: 200, ok: true, json: async () => ({ code: 0, data: { extract_result: [{ state: 'done', full_zip_url: 'https://cdn/z.zip' }] } }) }
      return { status: 200, ok: true, arrayBuffer: async () => noMd.buffer.slice(noMd.byteOffset, noMd.byteOffset + noMd.byteLength) }
    },
  })
  await assert.rejects(() => client.parse({ bytes: Buffer.from('x'), filename: 'a.pdf', intervalMs: 1 }), (e) => e.code === 'NO_MARKDOWN')
})

test('①d 模型回退只对"接口拒收 model_version"生效，其它错误不换模型', () => {
  assert.equal(modelFallbackWorthy(new MineruError('API_ERROR', 'model_version not support')), true)
  assert.equal(modelFallbackWorthy(new MineruError('API_ERROR', '余额不足')), false)
  assert.equal(modelFallbackWorthy(new MineruError('TIMEOUT', 'model_version 超时')), false)
  assert.equal(MINERU_MODEL_FALLBACK, 'vlm')
})

/* ---------------- ⑤ 路由接缝：/settings/mineru 与 /import ---------------- */

test('⑤ 六部件之五：设置接口与解析接口都走同一张路由表，4xx/5xx 分类清楚', async () => {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDemo(db, readDemoJson())
  const api = createApiHandler({
    source: {
      db,
      bootstrap: () => bootstrap(db, { version: '0.3.0', build: 'test' }),
      profile: (k, o) => getProfile(db, k, o),
    },
    version: '0.3.0',
    build: 'test',
    serveUi: (req, res, p) => servePublic(req, res, p),
  })
  const server = createServer((req, res) => { void api(req, res) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}${API_PREFIX}`
  try {
    /* 设置：GET 状态里没有 token 原文 */
    const status = await (await fetch(`${base}/settings/mineru`)).json()
    assert.equal('token' in status, false)
    assert.ok(status.tokenUrl.includes('mineru.net'))

    /* 设置：非法 token 是 400（用户输入问题，不该 500） */
    const bad = await fetch(`${base}/settings/mineru`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x' }),
    })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error, 'invalid_token')

    /* 解析：空体 400，且不碰事实层 */
    const empty = await fetch(`${base}/import?name=a.pdf`, { method: 'POST', body: '' })
    assert.equal(empty.status, 400)
    assert.equal((await empty.json()).error, 'empty_body')

    /* 未见过的路径：JSON 404（不是 HTML） */
    const nope = await fetch(`${base}/settings/other`)
    assert.equal(nope.status, 404)
    assert.match(nope.headers.get('content-type'), /application\/json/)
  } finally {
    await new Promise((r) => server.close(r))
    close(db)
  }
})

/* ---------------- 宿主入口 dsh/index.js：Config.root 真的被读到 ---------------- */

test('③ 宿主入口：Config 声明 root，apply 真的把 config.root 用起来（否则装机后每次重启回内存库）', () => {
  const src = readFileSync(new URL('../dsh/index.js', import.meta.url), 'utf8')
  assert.match(src, /export const Config = Schema\.object\(\{\s*\n?\s*root: Schema\.string\(\)/, 'Config 必须声明 root（Schemastery schema）')
  assert.match(src, /openDataSource\(config\?\.root\)|openDataSource\(config\.root\)/, 'apply 必须把 config.root 传进数据源')
  /* 0.6.0：真实资料目录不播种（否则永远进不了三步初始化）；只有内存演示态播种。 */
  assert.match(src, /if \(!dir && !hasDemoData\(db\)\) seedDemo/, '只有内存演示态才播种；真实资料目录从空开始（三步初始化可达）')
  assert.match(src, /migrate\(db\)/, '打开即迁移')
  assert.match(src, /ctx\.connection\?\.requestRejection/, '宿主鉴权走 requestRejection，不自建登录')
  assert.match(src, /kind: 'prefix', path: API_PREFIX/, '注册方式必须是前缀（路由表在 routes.js）')
  assert.match(src, /source\?\.close\(\)|source\.close\(\)/, '卸载时要关库')
  assert.equal(/TOKEN|SECRET|sk-[A-Za-z0-9]{8,}/.test(src), false, '入口文件不许出现任何凭据')
})

test('④ secretFile 落点：显式 env > 包内已存在文件 > 用户目录（装机后写在用户目录）', () => {
  const explicit = secretFile({ env: { AML_MINERU_SECRET: '/tmp/explicit.json' }, home: '/home/x', exists: () => true })
  assert.equal(explicit, '/tmp/explicit.json')
  /* 包内文件不存在时落用户目录（这条保证"包目录随升级整份替换"不会让 Token 消失）。 */
  const userDir = secretFile({ env: {}, home: '/home/x', exists: () => false })
  assert.equal(userDir, '/home/x/.orangeaml/secrets/mineru.json')
})
