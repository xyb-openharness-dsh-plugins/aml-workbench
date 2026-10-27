/**
 * 工作台实例：把「工作区目录 → 库 → 读模型」串起来。
 *
 * 与 DSH 插件入口（dsh/index.js）分开：入口必须 import 宿主给的 peer 依赖（Schemastery），
 * 本仓库装不上；可单测的那一层放这里，dev-server 与宿主 apply() 用的是同一个类。
 *
 * 规则：
 * - 资料目录由用户选定，不猜、不静默创建（workspaceProblems 已拒掉 home/Desktop/Downloads/Documents
 *   根与 /tmp；父目录不存在不自动建）；
 * - 打开即 migrate，只补未执行的迁移（幂等台账）；
 * - 库里没有档案时才播种演示数据（demo/demo-data.json，与原型同源），之后每次启动沿用用户资料。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendSavedTrial, appendTemperature, close, createProfile, insertRecord, listRecords, listSavedTrials, migrate, openDatabase, readTrialSnapshot, RECORD_KINDS } from './store.js'
import { hasDemoData, seedDemo } from './demo.js'
import { bootstrap, getProfile, listProfiles } from './readmodels.js'
import { renderPrepMarkdown, exportFilename } from './export.js'
import { workspaceProblems } from './server.js'
import { version, build, displayVersion } from '../lib/version.js'

export const DB_FILE = 'amlpal.sqlite'
/** 演示数据 JSON（由 demo/build-demo-data.mjs 从 prototypes/v0.2/demo-data.js 落成）。 */
const DEMO_JSON = new URL('../demo/demo-data.json', import.meta.url)

/** AI 写入能力契约面（与 routes.js CAPABILITIES 同源语义；bootstrap 一并下发）。
 *  0.6.0：补 profiles.write（空 workspace 建档，三步闭环第 0 步）。 */
const WORKBENCH_CAPABILITIES = [
  'bootstrap', 'profile', 'temperature', 'export', 'import', 'candidate', 'parse', 'mineru-settings',
  'trials.read', 'saved-trials.write', 'records.write', 'records.read', 'profiles.write',
  ...Object.keys(RECORD_KINDS).map((k) => `records.${k}`),
]

/** 校验资料目录：返回问题数组（空数组＝可用）。不抛错，方便 UI 一次列出所有问题。 */
export function validateWorkspacePath(p) {
  return workspaceProblems(p)
}

export class Workbench {
  #db = null
  #workspace = null

  /** 打开（必要时创建）工作区里的库。workspace 必须已通过 validateWorkspacePath。
   *  0.6.0：opts.seedDemo=false 跳过演示播种（dev-server --no-demo / AMLPAL_NO_DEMO=1 用，
   *  让「零治疗三步初始化」向导在空 workspace 上可达可测）；默认不传＝播种，既有行为不变。 */
  static async open(workspace, { seedDemo: wantSeed = true } = {}) {
    const problems = validateWorkspacePath(workspace)
    if (problems.length) throw new Error(problems.join('；'))

    let dir = workspace
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        throw new Error(`建不了资料目录 ${dir}：${error.message}`)
      }
    }

    const wb = new Workbench()
    wb.#workspace = dir
    wb.#db = openDatabase(join(dir, DB_FILE))
    try {
      migrate(wb.#db)
      if (wantSeed && !hasDemoData(wb.#db)) seedDemo(wb.#db, JSON.parse(readFileSync(DEMO_JSON, 'utf8')))
    } catch (error) {
      try { close(wb.#db) } catch { /* 关不掉也要把原始错误抛出去 */ }
      throw error
    }
    return wb
  }

  get version() { return version }
  get displayVersion() { return displayVersion }
  get build() { return build }
  get workspace() { return this.#workspace }
  get db() { return this.#db }

  bootstrap() {
    return { ...bootstrap(this.#db, { version, build }), capabilities: [...WORKBENCH_CAPABILITIES] }
  }
  listProfiles() { return listProfiles(this.#db) }

  /**
   * 建第一份档案（0.6.0 三步闭环第 0 步）：只允许空 workspace；已有档案幂等返回 existing。
   * @returns {{id:string, existing:boolean, name:string}}
   */
  addProfile(input) { return createProfile(this.#db, input) }
  /** @param {boolean} [includePrivate=false] private 看法默认不返回（三出口口径） */
  getProfile(key, { includePrivate = false } = {}) { return getProfile(this.#db, key, { includePrivate }) }

  /**
   * 追加一条体温事实（K2：不判定是否急症，只写入读数）。
   * @returns {{id:number, measured_at:string, value_c:number, episode_id:number|null}}
   */
  addTemperature(input) { return appendTemperature(this.#db, input) }

  /** 读体温（按 measured_at 排序，小时级轨道）。 */
  listTemperatures(key, { includePrivate = false } = {}) {
    const profile = getProfile(this.#db, key, { includePrivate })
    if (!profile) return null
    const list = (profile.neu?.fever?.episodes ?? [])
      .flatMap((ep) => (ep.temps ?? []).map((t) => ({ ...t, episodeId: ep.id, label: ep.label })))
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    return { profile: key, readings: list }
  }

  /** 登记快照检索（35 号）：只读，缺文件返回 source:'missing' 空列表（不抛错不编数据）。 */
  listTrials(params = {}) { return readTrialSnapshot(params) }

  /** 收藏一条试验（saved_trial）。 */
  addSavedTrial(input) { return appendSavedTrial(this.#db, input) }
  listSavedTrials(key) { return listSavedTrials(this.#db, key) }

  /**
   * 通用事实写入（0.4.0）：kind 白名单见 store.RECORD_KINDS（列名与 schema/0001 逐列一致）。
   * 手工表单与原生 Agent/会话走同一条路径；AI 产出一律先落候选，确认后才到这里写事实层。
   */
  addRecord(kind, input) { return insertRecord(this.#db, kind, input) }
  /** 通用记录列表：private 默认过滤（三出口口径），includePrivate=true 才返回。 */
  listRecords(kind, key, opts = {}) { return { kind, profile: key, items: listRecords(this.#db, kind, key, opts) } }

  /**
   * 把就诊准备写到 <资料目录>/exports/。private 看法一律剔除（导出是会被带出门诊的东西）。
   * @returns {{file:string, bytes:number, excludedPrivate:boolean}}
   */
  saveExport(key) {
    const full = getProfile(this.#db, key, { includePrivate: true })
    if (!full) throw new Error(`没有这个档案：${key}`)
    const excludedPrivate = full.privateCount > 0
    const md = renderPrepMarkdown(full, { version, excludedPrivate })
    const dir = join(this.#workspace, 'exports')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, exportFilename(full))
    writeFileSync(file, md, 'utf8')
    return { file, bytes: Buffer.byteLength(md, 'utf8'), excludedPrivate }
  }

  close() {
    if (this.#db) { close(this.#db); this.#db = null }
  }
}
