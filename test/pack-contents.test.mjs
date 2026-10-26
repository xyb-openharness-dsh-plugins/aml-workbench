#!/usr/bin/env node
/**
 * 真打一次包，断言 tgz 里到底有什么。
 *
 * ## 为什么要有这条测试
 * `check-workbench-package` 的规则查 import 落点与 public/，都是**看源码树**。
 * 源码树里那些目录永远在，所以本地跑得通**完全不能说明**装进去跑得通。
 * 只有以 `npm pack` 的真实清单为对象断言，才知道用户装到的是什么。
 *
 * 这一类故障的症状是「装了能开、进去是空的」：服务照常启动、`/health` 照常 200、
 * 界面照常打开，只是所有列表空着，看起来像「还没有数据」。静默空库比白屏难查十倍。
 *
 * ## 本台特有的一条
 * `schema/` 下就是 0001 冻结 SQL（没有 migrations/ 子目录），它必须随包发出。
 * 漏了它，装进去 `readdirSync(schema/)` 读不到 .sql → **一张表都不建** →
 * `/health` 照常 200、界面照常开、所有列表空着。所以这条不是"建议"，是硬判据。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** `npm pack --dry-run --json` 的清单：不落盘、不留临时 tgz。 */
function packEntries() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'], // stderr 是 npm 的 warning，别污染 JSON
  })
  return (JSON.parse(out)[0]?.files ?? []).map((f) => f.path)
}

const entries = packEntries()
const has = (path) => entries.includes(path)
const summary = () => `实际条目（${entries.length}）：${entries.slice(0, 60).join(', ')}${entries.length > 60 ? ' …' : ''}`

test('① tgz 里必须有 cordis.patch.yml（否则宿主不会加载本插件）', () => {
  assert.ok(has('cordis.patch.yml'), `缺 cordis.patch.yml；${summary()}`)
})

test('② dsh/ 全部服务端件都在（漏一个 = 装机 import 失败）', () => {
  for (const f of ['dsh/index.js', 'dsh/server.js', 'dsh/routes.js', 'dsh/store.js', 'dsh/readmodels.js',
    'dsh/demo.js', 'dsh/settings.js', 'dsh/workbench.js', 'dsh/export.js', 'dsh/parse.js',
    'dsh/amlparse.js', 'dsh/mineru.js']) {
    assert.ok(has(f), `缺 ${f}；${summary()}`)
  }
})

test('③ lib/ 四件齐（client 是宿主入口，version 与 layout 是唯一来源）', () => {
  for (const f of ['lib/client.js', 'lib/layout.js', 'lib/version.js', 'lib/zip.js']) {
    assert.ok(has(f), `缺 ${f}；${summary()}`)
  }
})

test('④ public/ 四件套 + primer 三件套随包发出（漏了它装机后业务区空白或「?」点开空白）', () => {
  for (const f of ['public/index.html', 'public/app.js', 'public/style.css', 'public/demo-data.js',
    'public/primer-data.js', 'public/primer.js', 'public/primer.css']) {
    assert.ok(has(f), `缺 ${f}；${summary()}`)
  }
})

test('⑤ schema/0001_initial.sql 与冻结合同随包发出（漏了它装进去是空库）', () => {
  assert.ok(has('schema/0001_initial.sql'), `缺 schema/0001_initial.sql —— 装进去会静默空库；${summary()}`)
  assert.ok(has('schema/freeze-contract.md'), '冻结合同也要随包（装机后 self-check 靠它比对 sha256）')
})

test('⑥ 演示数据随包发出：demo/demo-data.json 与 demo/build-demo-data.mjs', () => {
  assert.ok(has('demo/demo-data.json'), `缺 demo/demo-data.json（启动播种要用）；${summary()}`)
  assert.ok(has('demo/build-demo-data.mjs'), '重建演示数据是随包工具，漏了用户改不了演示数据')
})

test('⑦ files 白名单里声明的每个路径都真实存在于仓库', () => {
  const pkg = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: root, encoding: 'utf8' }))
  for (const entry of pkg.files ?? []) {
    if (entry.includes('*')) continue // 通配符交给 npm 自己展开
    assert.ok(existsSync(join(root, entry)), `files 里写了不存在的路径：${entry}`)
  }
})

test('⑧ 不该发的别发：prototypes/ 与 docs/ 不进包（它们不是运行期依赖）', () => {
  /* prototypes 是视觉基准、docs 是文档：随包发会让包体积翻倍，而且装机后改它们没有意义。
     但注意：public/ 是**同步产物**（可运行），必须发——两者不可混淆。 */
  assert.equal(entries.some((p) => p.startsWith('prototypes/')), false, 'prototypes/ 不该进包')
  assert.equal(entries.some((p) => p.startsWith('docs/')), false, 'docs/ 不该进包')
  assert.equal(entries.some((p) => p.startsWith('test/')), false, 'test/ 不该进包')
})

test('⑨ 运行时读盘的目录都被 files 覆盖：schema/ 与 demo/ 与 public/', () => {
  /* 这三处是"运行期按拼出来的路径读目录"的现场：
     store.js 读 schema/*.sql、workbench/index 读 demo/demo-data.json、server 读 public/*。
     它们不进包的症状都是"服务能起、界面能开、数据全空"。 */
  for (const dir of ['schema/', 'demo/', 'public/', 'dsh/', 'lib/']) {
    assert.ok(entries.some((p) => p.startsWith(dir)), `files 白名单没覆盖 ${dir}`);
  }
})

test('⑩ package.json 里 main/exports 指向真实文件', () => {
  const pkg = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: root, encoding: 'utf8' }))
  assert.equal(pkg.main, pkg.exports['.'], 'main 必须等于 exports["."]')
  assert.ok(existsSync(join(root, pkg.main)), `main 指向不存在的文件：${pkg.main}`)
  assert.ok(existsSync(join(root, pkg.exports['./client'])), 'exports["./client"] 指向不存在的文件')
})
