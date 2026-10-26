# 交互设计（AML）· v1 全量（28 号 IP1 判据）

> 版本：v1.0 · 2026-10-25 · 随 M2 原型（prototypes/v0.2）签认稿定稿。
> 原则：AI 协助默认/**34 号一键发送**（`aml:agent-draft` + `send:true`，嵌入式直接发送，双守卫在壳层）；手工收敛；候选核对闭环；参考实现七仓；判据 28 号 IP1–IP10、HVT X1–X4。
> **诱导日历按天（K1）与粒缺发热轨道（K2）是 AML 首创交互**（家族首次的小时级时间轴）。
> 页面树唯一权威：research-notes/family-landscape.md §6.2/§6.3（10 一级 / 27 二级）。

## 〇、三种时间粒度互不混轴（16 号合同 AML 补充断言）

| 粒度 | 组件 | 页签 | 规则 |
| --- | --- | --- | --- |
| 月 | 一图秀 chartSVG（monthTicks） | 病情一图秀 | 小时级体温只以"粒缺发作"期带出现；曲线留在轨道页 |
| 天 | **dayGrid**（7 列日格） | 诱导日历（按天） | D1–D42 逐日行；`day_index = floor((d−anchor)/DAY)+1` 读模型派生；允许"仅知月份"灰格 |
| 小时 | **hourLane**（HH:mm 体温曲线） | 粒缺发热轨道 | 参考线 38.3/38.0 标注"定义原文口径"；抗生素/血培养只画节点 |

**Day+N**（移植页）复用 day_index 原语换锚点：锚从"疗程 D1"换成"Day 0 回输日"；Day 0 未定时轴上灰格占位不造数。

## 一、场景路径（S01–S13，HVT X2 逐字走通 = 看板 chip → 落地页（data-product）→ 页内 data-step → 各站 data-product → 一步回看板）

| # | 患者的话 | 落地页 | 关键步骤（data-step → 站点） |
| --- | --- | --- | --- |
| S01 | 确诊与开始 7+3 | 诱导与疗程 · 诱导日历（按天） | to-tx-path→治疗路径；to-neu-fever2→粒缺发热轨道 |
| S02 | 粒缺期发烧了 | 粒缺血象与支持 · 粒缺发热轨道 | to-neu-inf→感染档案；to-neu-cbc→血象趋势 |
| S03 | MRD 转阴了是不是就好了 | MRD 与随访 · 双口径趋势 | to-mrd-bm→骨穿记录；to-chart2→一图秀 |
| S04 | 要不要移植/供者怎么选 | 移植 · 评估档案 | to-tp-donor→供者配型；to-tp-day→Day+N |
| S05 | 又输血了 | 输注记录与反应 | to-neu-cbc2→血象趋势 |
| S06 | 复诊准备 | 就诊准备与导出 | to-docs-trial→试验线索 |
| S07 | 口腔溃疡疼得吃不下 | 黏膜炎与症状 | to-care-safe→食物安全与出入量 |
| S08 | 家属代记体温 | 粒缺发热轨道 | to-mind-burden2→家庭负担与照护者 |
| S09 | 影像/复查怎么排 | 复查节奏与影像并列 | to-chart3→一图秀 |
| S10 | 营养与体重 | 食量与体重 | to-care-safe2→食物安全 |
| S11 | 我在想什么不敢说 | 对死亡的准备（私密） | to-mind-feel→当下感受 |
| S12 | 有没有我能参加的研究 | 试验线索 | to-docs-prep2→就诊准备 |
| S13 | 报告怎么进工作台 | 资料库与导入 | to-docs-cand→整理草稿与核对 |

## 二、CRUD 矩阵（每页显式编辑入口 ≤1；每表单 ≤6 字段；X3 已实测 max=1）

| 页签 | 读 | 增/改（唯一显式入口） | 删 | 不做 |
| --- | --- | --- | --- | --- |
| 诱导日历（按天） | 日格网格（day_index 派生） | —（日历由用药医嘱派生） | — | 不做"疗程"聚合（K1）；不评依从 |
| 治疗路径 | 32 折叠卡（默认收起） | — | — | 不推荐方案；打印 beforeprint 全展开 |
| 巩固与维持 | HiDAC / ven+aza 分列 | — | — | 不排下一程；不评疗效 |
| 粒缺发热轨道 | 小时级曲线+事件节点 | **temp-add**（时间/体温/部位/记录人；≥38.0 即触发急症提示，不可忽略关闭） | — | 不指导用药；不出"吃点退烧药/观察看看"（K2） |
| 输注记录 | 成分分列表 | **txf-add**（日期/成分/量/反应） | — | 禁"总输注"合成；不判依赖（K5） |
| 黏膜炎 | WHO 分级呈现 | **oral-add**（日期/分级/进食能力/措施） | — | 不画曲线；不荐护理方案 |
| 血象趋势 | 四项卡+谷值对照 | — | — | 本台不分级（CTCAE 归医生） |
| MRD 双口径 | 两列分图+警示卡×2 | — | — | 跨方法不连线不换算；不判复发（K3） |
| 骨穿记录 | 表（原文+数值） | **bm-add**（日期/部位/原始细胞/结论原文） | — | 判读归医生 |
| 移植评估/供者 | 状态机+原文 | — | — | **零推荐**（K4）；供者四类只记录 |
| Day+N | 相对天数轴 | — | — | Day 0 未定灰格，不造数 |
| 食量/出入量 | 行列表 | **meal-add / io-add** | — | 不给食谱；粒缺期能不能出门→只留医护答复原文 |
| 当下感受/死亡准备/家庭负担 | 双主体并列 | **feel-add / death-add / burden-add**（含记录人+visibility） | — | 不平均；不承诺不判读；死亡准备默认 private（K6） |
| 资料库 | 表 | **doc-add**（入解析队列→产候选） | — | 解析失败不产候选 |
| 草稿核对 | 候选卡 | cand-ok / cand-fix / cand-reject（闭环三步，X4） | — | accept 前不进正式数据 |
| 就诊准备 | 疑问清单+两区导出 | **q-add**；export-shared / export-full | — | private 默认过滤（sharedOnly，K6 三出口） |

## 三、原型落地清单（v0.2.0 实测数字）

- 页面树：10 一级 + 27 二级 = 37 路由（两档案独立数据）。
- 三新组件断言：dayGrid 45 格（demo1 诱导 42 天+3 lead）/ 32 格（demo2 C3 28 天+4 lead，VEN 打勾 28）；hourLane demo2×2 / demo1×1，参考线每条 2（38.3/38.0）；Day+N 轴×1（Day 0 灰格锚点 + Day+14/+100 里程碑）。
- 一图秀：SVG 根 `class="chart"` + Fritsch–Carlson（自 thyroid v0.2 复制）+ **computed fill=none**（probe 实测）。
- 32 折叠卡：5 卡 · 默认 `[open]`=0 · 展开区 pd-block=5（顺序固定）· **printToPDF 实测打印时 5 卡全展开、打印后恢复**（beforeprint JS，非 CSS）。
- AI 一键发送（34 号）：协议链接 `aml:agent-draft?prompt=…`（10 条一级线每线 ≥1，看板 2）；嵌入式 `parent.postMessage({type:'aml:agent-draft', prompt, send:true})`；独立打开走演示面板不假装发送；壳层双守卫（phase==='plain' 且草稿非空才 submit）在 lib/client.js 侧（装机阶段接线，M6）。
- 窄宽（30 号）：`#main` 容器查询（1100/860 双档）+ 断点 1180/900/600；**probe:resp 8 档宽度 × 13 页（含 dayGrid/hourLane 两页）竖排 0 / 溢出 0 / 裁切 0**；940=AI 面板展开态。
- HVT：X1 覆盖 29 路由孤儿 0；X2 走通 34 步 × 2 档案 = 68（0 失败）；X3 max=1；X4 候选闭环 + AI 链接全覆盖。
- 词表：禁词 0（出门指导/移植推荐/MRD=治愈/用药指导 8 规则）；必现句 12/12（≥38.3℃ 定义原文、未检测≠阴性、急症+按铃、双源、零推荐、线索不是推荐、转阴≠治愈、阳性≠复发、解释不是判断、不判依赖）。

## 四、AI 协助（34 号契约逐段对照）

| 段 | AML 落地 |
| --- | --- |
| 1 入口 | `aiBtn(key)` → `<a class="chip ai-link" href="aml:agent-draft?prompt=…">`；prompt = 预写提示词 + 已确认上下文（private 不进，sharedOnly 同源） |
| 2 发送 | 嵌入式 → `parent.postMessage({type:'aml:agent-draft', prompt, send:true}, origin)`；file:// → 演示面板 + 明示"不假装发送" |
| 3 送达 | 壳层监听（lib/client.js，M6 装机接线）：`event.source === iframe.contentWindow` 且同源；prompt 截断 ≤8000；rememberDraft 持久队列 |
| 4 填发 | `setDraft` → 双守卫（重取 snapshot，`phase==='plain'` 且非空）→ `input.submit()`；失败草稿保留 |

红线不变：AI 回复是候选（核对才入事实层）；不代替患者发言；草稿不带本机路径。

## 五、私密三出口（K6）

`sharedOnly()` 全台唯一一份，贯穿：① 看板摘要卡计数；② docs-prep 两区导出（给医生的摘要默认过滤，自存全量显式选择）；③ AI 上下文（aiCtx 只带 shared 记录数，不带内容）。死亡准备页逐项 vis-toggle 授权（private ↔ shared）。

## 六、验收命令

```bash
npm run probe:resp        # 窄宽 8 档 × 13 页
npm run probe:m2          # 37 路由 × 2 档案截图 + 三新组件 + fill=none + 打印卡断言
npm run check:hvt         # X1–X4
npm run check:wording     # 禁词 0 + 必现句 12
node demo/build-demo-data.mjs   # 演示数据唯一源 → prototypes/v0.2 + public
```
