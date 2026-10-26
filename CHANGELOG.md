# 变更记录

只增不删；每条写清"改了什么 + 为什么 + 用户可见结果"。版本号与 VERSION、package.json 三处必须一致。

## 0.3.0 — 2026-10-26

M5 七步移植（开发版可用，**装机未验证**）。包版本 0.3.0（VERSION / package.json / lib/version.js / 页面 ver-chip 同源）。

七步与落点：

1. **数据层 `dsh/store.js`**：开库/关库/迁移（执行 `schema/0001_initial.sql`，`schema_migrations` 幂等台账，旧版重启不重跑、用户资料不归零）；异常族 `StoreError` 派生 5 类各带 `code`；**更正链按表自适应**——带 `revision` 列的 13 张事实表走「旧行 `in_use=0` + 插入 `revision+1` 新行」，没有该列的事件流（`temperature_reading` / `fever_event` / `feeling_note` / `document`）返回 `NOT_VERSIONED` 并说明「更正＝新记一条」，不偷偷 UPDATE。另加 `appendTemperature`（**只写事实，不写判定**，K2）。
2. **读模型 `dsh/readmodels.js`**（10 线各一读法）：tx 按 `day_index` 逐日（无疗程聚合判定）；neu 只给事实 + 定义原文，**响应里没有 `isEmergency`/`level` 之类字段**；mrd FLOW/PCR 分列不混；tp 全原文列；血象趋势只取 `metric_def.category='cbc'`（体重 `body` 单独；铁蛋白 `inflammation` 不进趋势）；mind 按 kind 分节 + private 默认过滤 + `privateCount`；docs 的 trials 只登记（字段里没有 eligible / suitability / 匹配度）。
3. **路由与服务**：`/api/aml` 统一前缀，`dsh/routes.js` 一张表供「独立启动」与「宿主鉴权」两形态共用；交界守卫——请求校验失败一律 4xx JSON（400/404/405/413），上游 MinerU 失败按码 503/502，兜底也回 JSON；`settings.js`（Token 唯一实现、文件优先于 env、原子写 600、坏文件不覆盖）、`export.js`（private 剔除 + 写明有意排除 + 两条 MRD 警示常驻）、`parse.js`/`amlparse.js`/`mineru.js`（MinerU 六部件按 docs/18 v2，FAILED 落 `parse_failed` 不产候选）、`server.js`（路径穿越拦截 + 工作区路径校验）、`workbench.js`、`index.js`（Config 声明 root 且**真的读到**）。
4. **客户端**：`src/client.js`（AML 品牌 #E8722C 橙系，`aml:agent-draft` 监听 + `event.source` 校验 + plain 相 submit 双守卫）→ `scripts/build-client.mjs` → `lib/client.js`（占位符 0 个）。`scripts/sync-public.mjs` 改为**逐字符同步**：数据层写进原型 `app.js`（先 `/api/aml/bootstrap`，拿不到才回退 `DEMO_DATA`），构建期不再打补丁，两份渲染代码不分叉。
5. **演示数据**：`demo/build-demo-data.mjs` 扩展为落三份产物——原型 / public / `demo/demo-data.json` + `demo/demo-data.sqlite`；`dsh/demo.js` 把同一份纯数据拆进 30 张冻结表（其余叙述层进 `workspace.dataset_state.presentation`，按 profile id 分键）。
6. **测试**：7 套 82 个用例——`store`（9）/ `demo-parity`（10，含 K2/K3/K4/K5/K6 红线断言）/ `server`（13，含双形态与体温落盘）/ `client`（5）/ `import-export`（14）/ `schema-freeze`（10）/ `mineru-wiring`（11）/ `pack-contents`（10）。`npm test` 全过。
7. **宿主接线件**：`cordis.patch.yml`（`config.root: !!js dshHomePath('aml-workbench')`，`dsh/index.js` 实际读取）；`package.json` 的 `files` 白名单扩到 `dsh/lib/assets/public/demo/schema/cordis.patch.yml`；`npm run probe:m5` 21 条实测（health 带版本 / bootstrap 六件齐 / 写体温回读+磁盘直查 / private 三出口 / UI 数据层 / 交界守卫）。

修掉的三个真缺陷（都是 M5 自己发现、自己修的）：
- `correctRecord` 的占位符多了一个 `?`（`11 values for 10 columns`）——更正链在任何表上都跑不通，store 测试当场抓住。
- 候选确认时 `Hb` 被大写化成 `HB`，与种子里的 `metric_def.code='Hb'` 变成两行、趋势各画一条线——改为按不区分大小写先找已有 `code`。
- 用户在「没有进行中的发热期」时连录的体温会读不出来——读模型单列 `未归属发热期的体温记录` 一组（不塞进旧发热期，那是编造时间线）；演示数据里没有这类记录，所以不影响 parity。

## 0.2.0 — 2026-10-26

M2 交互原型（设计态，未接入 DSH / AI）。包版本 0.2.0。

- **三新组件**（AML 与家族其它工作台的差异点）：诱导日历按天 `dayGrid`（D1–D42 每天一格、谷值期带、骨穿窗口、灰格=无记录）、粒缺发热小时级轨道 `hourLane`（体温精确到小时 + 38.3/38.0 定义口径参考线 + 血培养/抗生素节点）、移植 Day+N 相对天数轴（Day 0 锚点未定则灰格占位、不造数）。
- **疾病概要（36 号）**：顶栏「?」打开**整页**视图（四段：定义 / 医学资料与指南情况 / 治疗全景 / 发展趋势），数据在 `primer-data.js`，与 README `## 疾病概要` 同源。**修正 M2 初版把「?」做成弹窗的错**——四段内容必然超过 1.5 屏，弹窗装不下。
- **AI 协助（34 号）**：页面「AI 协助 ↗」为 `aml:agent-draft` 协议链接，嵌入式形态 `send:true` 直接发送。**修正面板唯一性缺陷**：`setAgent()` 原无嵌入式门控，装机后会出现「AI 对话 · 演示」与原生会话双面板并存。
- **治疗路径折叠卡（32 号）**：默认只显「阶段 · 日期 · 一句话概要」，展开五块；打印走 `beforeprint` 全展开（`@media print` 对收起 `<details>` 无效）。
- **检查链补强**：新增 `check-probe-coverage`（同时认数组式与对象式 ROUTES，区分全量/抽样探针）、`check-agent-draft-bridge`（含 A4 面板唯一性、壳层按阶段判定）、`check-choice-limit --self-test`（上限回写 false / 下限回写 true / 非控件三形态）、`build-version --check`（渠道随环境变量一致）。`check-choice-limit` 修正两处误判：只认 `checked=false` 会漏掉「至少留一个」的 `checked=true` 回写；把路径构造的 `length===1` 误当选择上限。
- **M2 独立评审修正（3 P0 + 1 P1 + 1 P2，详见 `docs/M2-REVIEW-2026-10-26.md`）**：
  · P0 骨穿复核带标在 D21–D28，但标签写「停化疗后 7–14 天」应为 D15–D22，且 D15 真有骨穿记录 → 改 D15–D22，新增 `check-calendar-consistency`（C1–C5）。
  · P0 粒缺发热判定 `v>=38.3||v>=38.0` 等价于 `v>=38.0`，丢掉「持续>1h」条件，单次 38.1℃ 就弹急症 → 抽出 `classifyTemp` 三档判定，新增 `check-fever-rule`（9 用例 + 元断言）。
  · P0 同一次体温被 push 两遍（曲线重复点 + 双主体计数翻倍）→ 入列统一由调用方负责。
  · P1 primer/README 承诺「APL 单列成一条线」但未实现 → 改为如实写「APL 线尚未建立」。
  · P2 供者页把「半相合已非常成熟」写成台方口吻 → 改为标明文献出处、只转述。
- **新增 `check-private-exits`（隐私红线，10 条断言 + 反向对照）**：实测两个档案的私密正文在 AI 提示词 / 看板 / 给医生的摘要里均 0 泄漏；自存全量里必须能看到私密，否则「没泄漏」可能是假通过。
- **README 截图脚本化**：`npm run shots:readme` 生成 9 张 1440 宽实渲截图（含 dayGrid / hourLane / Day+N / 一图秀 fill=none / 折叠卡收展 / 疾病概要整页），14 条断言随截图一起跑，不靠手截。

## 0.1.0 — 2026-10-25

- 由社区脚手架 dsh-wb-cli@1.7.0 (8d7df5f) 初始化，仅有注册骨架与健康接口，无业务功能。

## 0.3.0 — 2026-10-26

M5 七步移植（V1 通过：check 全绿 + 83/83 测试 + audit 43/43 独立复跑 + 23 条探针）。

- 数据层 dsh/store.js：0001 迁移（30 表幂等台账）、更正链按表自适应（13 张带 revision 的表旧行 in_use=0 + 新行 revision+1；无该列的事件流返回 NOT_VERSIONED）。
- 读模型 dsh/readmodels.js：10 线各一读法；K2 严格不入库——temperature_reading 只有读数与时间戳，读模型无 isEmergency/level 字段（测试+schema 双守卫）；MRD FLOW/PCR 分列；血象趋势只取 category='cbc'；private 默认过滤 + privateCount。
- 服务 dsh/{routes,server,index,settings,workbench,export,parse,amlparse,mineru}.js + lib/zip.js：apiBase=/api/aml；4xx JSON 交界守卫；双形态共用路由表；导出过滤 private 并写"有意排除"；MinerU 六部件（FAILED 如实落 parse_failed）。
- 客户端 src/client.js → build-client.mjs → lib/client.js（486 行，占位 0），AML 品牌 + aml:agent-draft + 34 号 EMBEDDED 门控。
- public/ 与原型逐字符一致（数据层写进原型 app.js，构建期不再打补丁，避免两份渲染代码分叉）。
- 测试 8 套 83 用例：store / demo-parity / server / client / import-export / schema-freeze / mineru-wiring / pack-contents。
- 自修 4 个真缺陷：correctRecord 占位符多一个 ?；Hb→HB 大写化致趋势分叉；未归属发热期的体温读不出（改单列一组）；apiBase 双前缀致 404 静默退回演示数据。
