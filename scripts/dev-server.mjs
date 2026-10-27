#!/usr/bin/env node
/**
 * 独立启动（开发版）：node scripts/dev-server.mjs [--workspace <目录>] [--port 4173] [--demo-file]
 *
 * 不给 --workspace 时用内存库 + 演示数据（**不落盘**，只在本次进程里活着）；
 * 给 --workspace 就打开 <目录>/amlpal.sqlite（空库会播种演示数据，之后沿用你自己的资料）。
 *
 * 路由与 DSH 宿主共用 dsh/routes.js——本地能开的路径，装进 Desktop 也一定在。
 * 探针默认跑这个服务器（npm run probe:*），所以两件事必须在这里成立：
 * 1. /api/aml/health 回版本；
 * 2. /api/aml/bootstrap 六件齐（meta / profiles / version / build / agent / layout）。
 */
import { argv, exit } from 'node:process'
import { readFileSync } from 'node:fs'
import { Workbench, validateWorkspacePath } from '../dsh/workbench.js'
import { startWorkbenchServer } from '../dsh/server.js'
import { appendSavedTrial, close, createProfile, insertRecord, listRecords, listSavedTrials, migrate, openDatabase, readTrialSnapshot } from '../dsh/store.js'
import { hasDemoData, seedDemo } from '../dsh/demo.js'
import { bootstrap, getProfile, listProfiles } from '../dsh/readmodels.js'
import { appendTemperature } from '../dsh/store.js'
import { version, build } from '../lib/version.js'

const args = argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}

const port = Number(flag('port') || process.env.AML_PORT || 4173)
const workspace = flag('workspace')

function describeReadings(db, key, opts) {
  const p = getProfile(db, key, opts)
  if (!p) return null
  const readings = (p.neu?.fever?.episodes ?? [])
    .flatMap((ep) => (ep.temps ?? []).map((t) => ({ ...t, episodeId: ep.id, label: ep.label })))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  return { profile: key, readings }
}

async function main() {
  if (workspace) {
    const problems = validateWorkspacePath(workspace)
    if (problems.length) {
      console.error(`✗ 资料目录不可用：${problems.join('；')}`)
      exit(1)
    }
    /* 0.6.0：--no-demo（或 AMLPAL_NO_DEMO=1）跳过演示播种——空 workspace 保持空，
       「三步开始」向导可达可测；默认仍播种（既有行为不变）。 */
    /* 0.6.0：workspace 默认**不播种**（走三步初始化的真实起点）；--demo / AMLPAL_DEMO=1 才播种。 */
    const wantDemo = args.includes('--demo') || process.env.AMLPAL_DEMO === '1'
    const workbench = await Workbench.open(workspace, { seedDemo: wantDemo })
    const started = await startWorkbenchServer({ port, workbench })
    console.log(`✓ 小橙宝开发版 v${version}（build ${build}）${wantDemo ? ' · 已播种演示数据（--demo）' : ' · 空库（未播种，走三步初始化）'}`)
    console.log(`  资料目录：${workbench.workspace}`)
    console.log(`  UI：${started.url}api/aml/ui/`)
    console.log(`  健康检查：${started.url}api/aml/health`)
    return
  }

  /* 内存库 + 演示数据：不写用户磁盘，探针与本地联调都打这条。 */
  const db = openDatabase(':memory:')
  migrate(db)
  if (!hasDemoData(db)) seedDemo(db, JSON.parse(readFileSync(new URL('../demo/demo-data.json', import.meta.url), 'utf8')))
  const workbench = {
    db,
    version,
    build,
    workspace: null,
    bootstrap: () => bootstrap(db, { version, build }),
    getProfile: (key, opts) => getProfile(db, key, opts),
    /* 0.6.0：建档（空 workspace 才生效；内存演示库已有档案 → 幂等 existing）。 */
    listProfiles: () => listProfiles(db),
    addProfile: (input) => createProfile(db, input),
    saveExport: () => { throw new Error('内存演示库没有资料目录：用 --workspace 指定目录后再导出落盘') },
    addTemperature: (input) => appendTemperature(db, input),
    listTemperatures: (key, opts) => describeReadings(db, key, opts),
    /* 0.4.0 反馈 3/4：检索快照、收藏、通用写——内存库与 workspace 两条形态能力一致，
       否则独立启动的联调/探针与装进 Desktop 行为分叉（0.4.0 轮真实踩过：500 records_write）。 */
    listTrials: (params = {}) => readTrialSnapshot(params),
    addSavedTrial: (input) => appendSavedTrial(db, input),
    listSavedTrials: (key) => listSavedTrials(db, key),
    addRecord: (kind, input) => insertRecord(db, kind, input),
    listRecords: (kind, key, opts = {}) => ({ kind, profile: key, items: listRecords(db, kind, key, opts) }),
    close: () => close(db),
  }
  const started = await startWorkbenchServer({ port, workbench })
  console.log(`✓ 小橙宝开发版（内存演示库）v${version}`)
  console.log(`  UI：${started.url}api/aml/ui/`)
  console.log(`  健康检查：${started.url}api/aml/health`)
}

main().catch((error) => {
  console.error(`✗ 启动失败：${error.message}`)
  exit(1)
})
