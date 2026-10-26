/**
 * 文档解析设置：MinerU Token 的读取、保存与状态（六部件之一，docs/18-MINERU-PARSING.md v2）。
 *
 * 三条硬边界（§1 原则 3/4/7/8）：
 * 1. Token 只有一份实现、一个文件：设置页（写）、解析（读）、状态接口（报）全走这里；
 * 2. 原文永不回给界面：状态里只有掩码与路径，接口不返回 token；
 * 3. 保存要原子写（tmp + rename）、600、目录 700；坏文件不覆盖。
 *
 * 文件位置（v2 §4.2）：
 * 1. AML_MINERU_SECRET 环境变量显式指定文件（测试与排障）；
 * 2. 仓库内 .secrets/mineru.json（已存在就沿用——开发与自用时的既有约定）；
 * 3. 用户目录 ~/.orangeaml/secrets/mineru.json（装机后的落点；包目录随插件升级整份替换，
 *    写在包里的 Token 会静默消失）。
 *
 * Token 优先级（v2 定稿）：显式 > 密钥文件 > 环境变量。v1 写反过：
 * env 里残留一把过期 Key 会盖住界面刚存的新 Token，表现为"换了 Token 还是 401"。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MINERU_TOKEN_URL = 'https://mineru.net/apiManage/token'
export const MINERU_SECRET_ENV = 'AML_MINERU_SECRET'
export const PACKAGE_SECRET_FILE = fileURLToPath(new URL('../.secrets/mineru.json', import.meta.url))

/** 装机后实际使用的文件：用户目录，不随插件升级被删除。 */
export function userSecretFile(home = homedir()) {
  return join(home, '.orangeaml', 'secrets', 'mineru.json')
}

/** 当前生效的密钥文件：显式 env > 已存在的包内文件 > 用户目录。 */
export function secretFile({ env = process.env, home = homedir(), exists = existsSync } = {}) {
  const explicit = String(env[MINERU_SECRET_ENV] || '').trim()
  if (explicit) return explicit
  if (exists(PACKAGE_SECRET_FILE)) return PACKAGE_SECRET_FILE
  return userSecretFile(home)
}

/** 显示用路径：主目录缩成 ~。 */
export function displayPath(file) {
  const home = homedir()
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file
}

/** 掩码：只留前 3 后 4，长度不足时进一步收窄。原文永不整段出现。 */
export function maskToken(token) {
  const t = String(token ?? '')
  if (!t) return ''
  if (t.length <= 8) return `${t.slice(0, 1)}****`
  return `${t.slice(0, 3)}****${t.slice(-4)}`
}

/** 读密钥文件里的 token；文件坏了要报错（读不出 ≠ 没配）。 */
export function readMineruToken({ file = secretFile() } = {}) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${displayPath(file)} 不是合法 JSON，未覆盖。请先修正或删除该文件。`)
  }
  const token = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
  return token
}

/** Token 格式：只拦明显的空白与超长，不猜上游规则。 */
export function validateMineruToken(raw) {
  const token = String(raw ?? '').trim()
  if (!token) throw new Error('请先填写 MinerU Token；留空请用「清除」。')
  if (token.length < 8) throw new Error('Token 太短了，请确认已完整复制（MinerU 的 Token 以 sk- 开头）。')
  if (token.length > 1024) throw new Error('Token 过长（超过 1024 字符），请确认粘贴的内容只有 Token 本身。')
  if (/\s/.test(token)) throw new Error('Token 里不能有空格或换行，请重新复制一次。')
  if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error('Token 含有意外字符，请确认粘贴的是 MinerU 的 API Token。')
  return token
}

function writeSecretFile(file, payload) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  try { chmodSync(file, 0o600) } catch { /* 某些文件系统不支持改权限；已写入就够了 */ }
}

/** 读已有内容（保留用户自己加的其它键），坏文件不覆盖。 */
function readExisting(file) {
  if (!existsSync(file)) return {}
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`无法读取 ${displayPath(file)}：${error?.code || error.message}`)
  }
  if (!text.trim()) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${displayPath(file)} 不是合法 JSON，未覆盖。请先修正或删除该文件。`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${displayPath(file)} 的内容不是对象，未覆盖。`)
  }
  return parsed
}

/** 保存 Token：原子写文件（600）并返回最新状态。原文不会回给调用方。 */
export function saveMineruToken(raw, options = {}) {
  const file = options.file || secretFile(options)
  const token = validateMineruToken(raw)
  const next = { ...readExisting(file), token }
  writeSecretFile(file, next)
  return mineruSettingsStatus({ ...options, file })
}

/** 清除 Token：只删 token 键；文件因此变空就删掉。 */
export function clearMineruToken(options = {}) {
  const file = options.file || secretFile(options)
  if (!existsSync(file)) return mineruSettingsStatus({ ...options, file })
  const next = { ...readExisting(file) }
  delete next.token
  if (Object.keys(next).length === 0) rmSync(file, { force: true })
  else writeSecretFile(file, next)
  return mineruSettingsStatus({ ...options, file })
}

/** 设置页状态。不含 token 原文；source 与 dsh/mineru.js 的取值顺序一致（文件优先，env 兜底）。 */
export function mineruSettingsStatus({ file = secretFile(), env = process.env } = {}) {
  let fileToken = ''
  let error = ''
  try {
    fileToken = readMineruToken({ file })
  } catch (problem) {
    error = problem.message
  }
  const envToken = String(env.MINERU_TOKEN || '').trim()
  const source = fileToken ? 'file' : envToken ? 'env' : 'none'
  const effective = fileToken || envToken
  return {
    configured: Boolean(effective),
    source,
    sourceLabel: source === 'file'
      ? '已保存到本机密钥文件'
      : source === 'env'
        ? '临时使用环境变量 MINERU_TOKEN（未写入文件）'
        : '尚未配置',
    masked: effective ? maskToken(effective) : '',
    file: displayPath(file),
    fileExists: existsSync(file),
    tokenUrl: MINERU_TOKEN_URL,
    error: error || undefined,
    permissions: fileMode(file),
  }
}

function fileMode(file) {
  try {
    return (statSync(file).mode & 0o777).toString(8)
  } catch {
    return undefined
  }
}
