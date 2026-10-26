# 家族结构素材（family-landscape）· AML DIFF-MATRIX 全量化与 M2 原型准备

日期：2026-10-25。状态：调研笔记，供 `docs/DIFF-MATRIX.md` 全量行与 M2 原型 PAGES/SUBPAGES 设计引用；**不是签认产物**。

素材边界（先读）：

- **移植样板 = `/Users/qinxiaoqiang/Downloads/cervical-workbench`**（VERSION 0.1.1）。实测：`prototypes/v0.2/` 五件套（app.js 1393 行 / style.css / demo-data.js / primer.* / index.html），schema 两次迁移（0001 34 表 / 0002 1 表），`src/client.js` 482 行 → `scripts/build-client.mjs` 116 行 → `lib/client.js` 生成物。
- **成熟基准 = `/Users/qinxiaoqiang/Downloads/breast-cancer-workbench`**（VERSION 0.12.0）。实测 `prototypes/v0.3/app.js`：**8 个一级 / 27 个二级**，与 `docs/SPEC.md` §2/§3 一致。
- **AML 本仓现状（关键）**：VERSION 0.1.0；`dsh/` 只有 25 行 `index.js`（仅一条 `/api/aml-workbench/health`）；`lib/client.js` 是 **42 行占位骨架**（读 health + 大字开关，无 customFrame 外壳）；**无 `src/`、无 `schema/`、无 `prototypes/`、无 `demo/`**；`scripts/` 已有 17 个（含 check-version-literal / check-host-contract / probe-page-view / probe-disease-primer 等），但**缺 `build-client.mjs`、`build-version.mjs`、`check-schema.mjs`、`check-wording.mjs`、`check-demo-columns.mjs`、`dev-server.mjs`、`probe-responsive.mjs`**。`docs/DEV-PLAN.md` M2 明确"诱导日历按天+粒缺轨道+治疗线 32 折叠卡"是本轮原型核心。
- AML 已读：`docs/SCENARIOS.md`（S01–S13 骨架）、`docs/PATIENT-FLOW.md`（三流骨架）、`docs/DEV-REQUIREMENTS-2026-10-26.md`（**K1–K6**，已避开与 DEV-PLAN 里程碑 M1–M6 同号冲突）、`docs/BRIEF.md`、`docs/26-CANCER-FEATURE-LINES.md`、`27-TRACKS-AND-METRIC-CARDS.md`、`32-TREATMENT-PATHWAY-FOLDOUT.md`（家族模版，参考实现 = melanoma `pageTreatPathway()` + `.phase-fold`）、`34-AGENT-DRAFT-SEND.md`、`36-DISEASE-PRIMER.md`、`research-notes/medical-constraints.md`（十节，含 7+3 按天日历骨架与粒缺发热定义原文）。
- 格式参照 `/Users/qinxiaoqiang/Downloads/melanoma-workbench/research-notes/family-landscape.md`（七部分）；内容全部按 cervical + breast + AML 语境重做。
- 证据纪律：S01–S13 目前是**骨架行**（M1 回填证据），本笔记引用的患者句子全部视为**设计假设语料**，不是一手原话。

---

## 一、cervical 一级/二级导航全集 + L1–L10 映射

实测口径（`prototypes/v0.2/app.js` L54–72 常量）：**12 个一级 / 38 个二级**。SPEC §4 写 11 个一级，app.js 头注写"SPEC 的 11 个 +「资料库」（家族脚手架要求）"，PAGES 里该页实际命名为**病情整理**。设置不占一级（弹窗）。

| 一级 | 二级页签全集（SUBPAGES） | 职责一句 | 关键组件/口径 |
| --- | --- | --- | --- |
| 看板 dashboard | —（0） | 分期、路径、长期影响与随访放在一起 | 定调条→「现在可以做」→**放疗长期影响状态卡**→随访卡→接下来/最近变化 |
| 病情整理 records | 资料库 / 整理草稿·核对 / 病情档案 / 指标检测 / 病情汇总（5） | 上传→解析→确认指标→入库 | DOCS/CANDS 双轨；候选 accept 前不进正式数据 |
| 我的分期 stage | 分期档案 / 病理与分子 / 会诊与二次意见（3） | FIGO 2018 只记录不自算 | `stage_rows` 版本链留旧分期；molecular 四态 |
| 治疗历程 treatment | 治疗路径 / 手术记录 / 放疗疗程 / 系统治疗（4） | 路径三选一 | `pathway_rows` 改过留旧；`rt_rows` EBRT 与后装分列 |
| 性与生育 fertility | 生育档案 / 生育保留记录 / 卵巢与月经 / 性健康（私密）（4） | 生育是记录不是承诺 | `sexual_rows`/`vagina_rows` `is_private` 默认 1 |
| 放疗与长期影响 late | 放疗后事件 / 淋巴水肿 / 阴道与扩张 / 绝经与骨健康（4） | 放疗结束后的问题按时间记 | cervical 独有线 |
| 检查与指标 labs | 肿瘤标志物 / 细胞学与 HPV / 影像随访（3） | SCC-Ag 只对鳞癌有意义 | 细胞学只存原文 |
| 病情一图秀 timeline | 数值曲线 / 分类与事件 / 数据口径（3） | SCC-Ag、体重与阴道狭窄同轴 | `state.sel` 默认 2 数值 + 1 分类 |
| 营养支持 nutrition | 进食量记录 / 补充剂与医嘱（2） | 记"吃了多少" | 骨架 |
| 心理支持 mind | 当下感受 / 身体形象与亲密关系 / 母亲身份与家庭沟通（3） | 默认只属于你 | 换页收回私密展开 |
| 复诊准备 review | 复诊节奏 / 三类随访节点 / 筛查与预防 / 就诊准备（4） | 该带什么该问什么提前写下 | 导出 Markdown |
| 临床研究 trials | 2026 线索 / 已收藏 / 入组问题（3） | 线索不是推荐 | TRIALS 卡 + topic 筛选 |

合计校验：0+5+3+4+4+4+3+3+2+3+4+3 = **38**。

> **判据提醒**：cervical 的 12 一级 / 38 二级**双超** 26 号的 8–10 / 24–30 区间。它是"移植样板"（client 链路与口径底本），**不是结构基准**；AML 不得按 12 条照搬，结构数量以 §六 的 10/27 为准。

**与 26 号 L1–L10 的映射（cervical 实排）**：L1 看板→看板；L2 疾病本体→我的分期；L3 治疗与决策→治疗历程（后装独有字段）；L4 指标分析→检查与指标 + 病情整理·指标检测；L5 安全与症状→放疗与长期影响（独立整线）；L6 营养与体重→营养支持（骨架）；L7 心理与家庭→心理支持 + 性与生育·性健康（私密）；L8 复诊与随访→复诊准备；L9 资料与导出→病情整理（独立一级）+ 就诊准备；L10 试验与线索→临床研究；横切层→病情一图秀（带二级是 cervical 与 breast 的差别）。

cervical 对 AML 最有用的三条结构先例：**①私密是数据结构属性而非界面开关**（`is_private` 缺省 1 + 三出口过滤）——直接承接 K6；**②不可相加的量分列存**（EBRT/后装禁"总剂量"合成列）——对应 AML 的**流式 %/PCR 双口径禁合并**（K3）与**红细胞/血小板/血浆分列**（K5）；**③指标按病况条件显示**（SCC-Ag 只对鳞癌）——对应 AML 的"粒缺期模式"（ANC<0.5 时界面切换，medical-constraints 字段建议原文）。

cervical 的 V1–V8 特有场景全部是**确诊后**场景；没有覆盖"确诊当天即开始化疗、基因结果 3–7 天后才出"的窗口——这是 AML 必须新增"检查结果等待清单"结构位的原因，见 §六。

---

## 二、cervical schema 表分组与专属表清单

共 **35 张表**：`0001_initial.sql` 34 张 / 224 列（`freeze-contract.md` 实测）+ `0002_profile_meta.sql` 1 张。`schema/freeze-contract.md` 记 sha256，`scripts/check-schema.mjs` 拦改旧迁移；加结构只能新增迁移。

按 freeze-contract 的权威分组（四组，34 = 2+3+8+21）：

| 组 | 表 | 职责一句话 |
| --- | --- | --- |
| 档案级（2） | `subjects` | 患者档案标量 + histology（决定 SCC-Ag 显示）+ dash_keys/path |
| | `section_titles` | 分节标题表化（加一节=加一行），替代 subjects 平铺 `*_title` 列 |
| 指标（3，通用） | `metrics` / `metric_points` / `molecular` | kind: numeric/grade/qual；band 用 band_low/high 两列（NULL≠0）；分子四态 ok/na/warn/pending（**未检测≠阴性**） |
| 通用（8） | `events` / `rhythm` / `cycles` / `treatment_lines` / `viewpoints` / `trials` / `documents` / `candidate_fields` | 一图秀事件、随访节奏、周期、治疗线容器、看法（无 is_conclusion）、试验收藏、人工归档、解析候选 |
| 宫颈专属（21） | `stage_rows` / `pathology_rows` / `pathway_rows` / `surgery_rows` / `rt_rows` | FIGO 只抄、病理 row/gap、路径版本链、手术范围、EBRT+后装分列 |
| | `late_effect_rows` / `lymphedema_rows` / `vagina_rows` / `menopause_rows` / `hormone_rows` | 放疗长期影响五件套（`vagina_rows.is_private` 默认 1） |
| | `fertility_rows` / `fert_surgery_rows` / `ovary_rows` / `sexual_rows` | 生育四件（`sexual_rows.is_private` 默认 1） |
| | `cytology_rows` / `hpv_rows` / `imaging_rows` / `screening_rows` | 细胞学与 HPV **只存 result_text 原文**（无正常/异常枚举列） |
| | `nutrition_rows` / `supplement_rows` / `demo_meta` | 进食量、补充剂、演示元数据 |
| 迁移件（0002） | `profile_meta` | 零散标量 (profile_key, k, v)：加字段=加一行，不再 ALTER 补列 |

**cervical 五条独有口径**：A FIGO 只记录不自算；B EBRT 与后装分列禁总剂量；C 细胞学/HPV 只存原文；D 性与生育默认私密（三出口）；E SCC-Ag 只属鳞癌（生成器保证）。**四条家族契约**：看法恒不是结论；四点位 NULL≠0；更正只新增版本；事实四层不合并。

工程避坑（对 AML 直接可用）：`using` 是 SQLite 保留字，"当前在用"语义列一律叫 `in_use`；所有 INSERT 写显式列名；`demo/build-demo-data.mjs` 里的 CREATE TABLE 是 schema 镜像，改完跑 `check-demo-columns.mjs` 逐表比对。

对 AML 的直接映射：A→**ELN/医院分层只存医院结论（`risk_basis`），产品不做分层计算**（medical-constraints §2 明确）；B→**流式 %/PCR 分列禁合并成单一"MRD 状态"**（K3）；C→**影像/培养结果只存原文**；D→**对死亡的准备、家庭负担默认私密三出口**（K6）；E→条件显示改为 **ANC 驱动的粒缺期模式 + 移植状态驱动的 Day+N 视图**。

---

## 三、cervical 客户端链路结构（M5 移植底本）

链路：**`src/client.js`（482 行，手写唯一源）→ `scripts/build-client.mjs`（116 行，零依赖字符串替换）→ `lib/client.js`（生成物勿手改，`--check` 兜同步）**。AML 现在的 `lib/client.js` 正是 42 行占位骨架（读 health + 大字开关）——M5 第一优先修复项。

`src/client.js` 九段结构（customFrame 外壳，移植整段保留、只换品牌）：装载壳 `window.__ModuleLoader__.load`；常量段（TITLE/PANEL_TITLE/SUBTITLE/DESCRIPTION + 注入面板参数）；宽度记忆（clampWidth/snapWidth 对齐 ratioStep 0.02 → localStorage）；样式段（全部内联）；会话判定（currentSession/ownsSession，官方 dsh-site-selection 同款）；原生草稿桥（fillDraft 只填入不发送、pendingDraft 队列 500ms 轮询 flush）；onboardingPrompt 5 行；Panel 组件（`<header>` 顶栏避让 `--dsh-frame-leading-clearance` + iframe 业务区 8s broken 兜底 + `<aside>` 会话始终挂载 + splitter 键盘 25%–45% + 容器宽 ResizeObserver <760px 转抽屉 + postMessage 校验 source/origin 截 8000 字）；apply/register（title/icon/repository/audience/requirements/initialization:'empty'/embedded:true/version/layout/customFrame，`inject: ['desktopWorkbenches','sessions']`）。

**14 个构建注入 token（AML 逐项换源头）**：

| token | cervical 现值 | AML 应取 | 来源 |
| --- | --- | --- | --- |
| `__PKG_NAME__` | @xyb-community/cervical-workbench | @xyb-community/aml-workbench | package.json name |
| `__REPOSITORY__` | github.com/xyb-openharness-dsh-plugins/cervical-workbench | aml 同 owner/repo（强校验 canonical） | package.json repository |
| `__API_PREFIX__` / `__UI_ENTRY__` | /api/cervical、/api/cervical/ui | /api/aml（**与现有 `/api/aml-workbench/health` 需统一，见 §七**） | dsh/routes.js |
| `__VERSION__` | 0.1.1 | 0.1.0 起按 AML 版本簿记 | lib/version.js（← VERSION） |
| `__BUSINESS_SIDE__` / `__BUSINESS_WIDTH__` / `__CUSTOM_FRAME__` | left / 0.65 / true | 同值 | lib/layout.js PANEL |
| `__AGENT_DEFAULT__/MIN/MAX/STEP/NARROW_BELOW/DRAWER_MAX__` | 0.35 / 0.25 / 0.45 / 0.02 / 760 / 420 | 同值 | lib/layout.js AGENT_PANE |

**8 处手写品牌点（构建 token 之外，必须逐处改）**：

| # | 项 | cervical 现值 | AML 应取 |
| --- | --- | --- | --- |
| 1 | TITLE | 小莲宝 CerviPal | 小橙宝 OrangePal（DEV-REQUIREMENTS 占位，G1 可改） |
| 2 | PANEL_TITLE | 小莲宝宫颈癌工作台 | 小橙宝急性髓系白血病工作台 |
| 3 | SUBTITLE | 本机数据 · 记录不是诊断 | 同句式（本机数据 · 记录不是诊断） |
| 4 | DESCRIPTION | "……FIGO 分期、治疗与随访记录……" | 诱导日历、粒缺发热、MRD 双口径、移植评估、输注记录 |
| 5 | WIDTH_KEY | cervip.pal.cervical.agent-pane.v1 | orangep.pal.aml.agent-pane.v1 类 |
| 6 | DRAFT_QUEUE_KEY | cervip.pal.cervical.initial-drafts.v1 | orangep.pal.aml.initial-drafts.v1 类 |
| 7 | 消息类型 | `cervi:agent-draft` | `aml:agent-draft`（业务侧 postMessage 两端同改；按 34 号须带 `send:true`，见 §五） |
| 8 | icon + 色板 | 🪷；#18AFA5 全套 | icon 候选 🍊（G1 定）；**组织色橙 #C46A2B（白血病关怀丝带色）**/行动色深青/分区暖灰（DEV-REQUIREMENTS §二三变量） |

另需整段重写、不属于品牌变量：register 的 `audience`（"急性髓系白血病患者与照护者双主体"）/`requirements`/`author`、onboardingPrompt 5 行、Fallback 文案、顶栏 hint。cervical 的 requirements 是"本机数据整理；不做诊断与处置建议"——AML 需加"粒缺发热只提示按铃联系团队，不指导用药（K2）；MRD 趋势不判复发（K3）；移植零推荐（K4）"。

`scripts/build-client.mjs` 本身**零癌种内容**可直接复用；它替换完回扫 `__[A-Z_]+__` 残留 + 强校验 canonicalRepository。`lib/layout.js` 的 PANEL/AGENT_PANE/HOST_LIMITS 结构与注释同为主。**AML 的 `scripts/` 缺 build-client/build-version/check-schema/check-wording/check-demo-columns/dev-server 六件，M5 从 cervical 平移**。

---

## 四、breast 基准 L1–L10 做法摘要（小粉宝 0.12.0：8 一级 / 27 二级）

一级全集（`prototypes/v0.3/app.js` 实测）：**看板 / 病情整理 / 病情一图秀 / 临床 / 营养支持 / 心理支持 / 全程与康复 / 收藏与回顾**。二级合计：5+6+3+4+6+3 = **27**。

| # | 线 | breast 基准做法 | 出处 |
| --- | --- | --- | --- |
| L1 | 看板 | 单页：当前阶段（**用户选**）、一件事、上肢差值提醒、最近变化、安排、问题入口；不做自动判定阶段 | SPEC §2 |
| L2 | 疾病本体 | 病情整理·病情档案：病理转录、标本、指标序列；报告原文可回溯 | SPEC §2/§3 |
| L3 | 治疗与决策 | 临床·治疗历程（计划 vs 实际）+ 全程与康复"术后恢复三阶段"（D15 定名"术后上肢"） | SPEC §2/§3 |
| L4 | 指标分析 | 病情整理·指标检测：分组卡 + CTCAE 分级徽章 + 背面区间 + needsUln（×ULN 型） | 26 §3.1、23 号 |
| L5 | 安全与症状 | 全程与康复·上肢与淋巴水肿独立主题；四点位测量与差值（缺健侧不生成差值） | SPEC §2/§3 |
| L6 | 营养与体重 | 独立一级 3 二级：当下困扰 / 进食与体重 / 建议与回顾；体重进指标只做趋势 | SPEC §2、23 §8 |
| L7 | 心理与家庭 | 独立一级 4 二级：当下感受 / 我的记录 / 支持资源 / 身体与亲密；**主体（患者/照护者）区分**、私密标记 | SPEC §2/§3、HVT §4.5 |
| L8 | 复诊与随访 | 全程与康复·近期安排 + 就诊准备 + 长期生活 | SPEC §2 |
| L9 | 资料与导出 | **收藏与回顾独立一级**：问题清单版本、快照、Markdown 导出、源变标"已过时" | SPEC §2 |
| L10 | 试验与线索 | 临床·试验线索（虚构样例仅作界面演示，真实登记库二期） | SPEC §2 |
| 横切 | 一图秀 | 多指标时间轴、治疗条、缩放与时间窗、点详情回源、3D 翻转卡（0 二级） | SPEC §2 |

**三条可直接借的 breast 立场（SPEC §4.5，HVT 补丁）**：

1. **"LVEF 与骨密度只做与治疗同窗的记录，不做毒性判定"**——AML 的**蒽环类心脏毒性（ECHO/LVEF）、铁过载指标（血清铁蛋白）**逐字同构：记录数值+日期+机构+方法，常显"是否调整治疗由治疗团队决定"。
2. **"副作用记录体验、不做归因；强度轨道呈现，不画趋势曲线"**——AML 的**黏膜炎、乏力、恶心**同构；且 AML 更要防家属把发热/口腔溃疡归因为"护理不当"（自责语境，S07）。
3. **"主体区分、私密标记、默认三处过滤"**——AML 的 K6 双主体（**家属代记为主**，DEV-REQUIREMENTS 默认值）直接沿用 breast 的主体字段；"对死亡的准备"是 AML 特有的私密主题（S11），breast 无对应物。

**breast 不可直接借的**：①"当前阶段由用户选"在 AML 诱导期不成立——患者处在"7+3 第几天"这种**日级状态**，不是"早期/晚期"阶段；②breast 无任何按天/小时组件，L1/K1/K2 必须新做（见 §五末与 §六.6）；③breast 用 8 条一级，AML 因粒缺/输注/移植三条硬轨道，需要 10 条。

判定纪律（26 号）：HCC 曾因"营养一张表、心理完全没有、指标无卡无分级、二级为 0"被判结构性不足。AML 走查逐线过同一张表，尤其 **L5（粒缺/输注/黏膜炎三轨）** 与 **L10（venetoclax/FLT3/IDH 线索，SCENARIOS 已指定）**。

---

## 五、家族通用件 vs 必须癌种化部位（含 30/32/34/36 号接入）

**通用骨架（换癌种不换结构）**：

| 件 | 出处 | 要点 |
| --- | --- | --- |
| 三层结构 线→页→卡 | 26 §1 | 一级 8–10 / 二级 24–30；二级为 0 的一级 ≤2；单线二级 ≤6；<8/<20 判结构性不足 |
| customFrame 外壳 | cervical `src/client.js`、20 号 | M5 整段移植（见 §三） |
| 看板四点位 | SPEC 家族段 | 定调条→「现在可以做」→特色状态卡→随访卡→接下来/最近变化 |
| 一图秀 | 16 号 R1–R12 | 三合同 + 单点不连线、治疗条分层、末点避让、`minmax(0,1fr)`；**月粒度刻度，装不下小时级，见 §六.6** |
| 3D 指标卡翻转 | 16 §2、19 §4 | `data-flipped` 唯一开关、固定高度、reduced-motion 降级 |
| 多轨并列 | 27 号 | 永不加总/永不折算/各自归一化/分类只画节点；**K3 双口径、K5 输注成分直接套用** |
| 指标分组 + CTCAE | 23 号 | 血象（WBC/ANC/Hb/PLT）是家族少有的**绝对阈值完备**指标组，分级徽章全套适用 |
| 私密=数据结构属性 | 26 §4.3、cervical 口径 D | `visibility` 列 + 三出口各过滤收敛一个函数；AML 加 `author_role`（patient/caregiver，K6 双主体） |
| 版本链只增不改 | 0001 头注 | 更正=INSERT+翻 is_current；AML 的分层结论更正、移植状态机流转都是版本链 |
| 分节标题表化 | cervical `section_titles` | 教训件，照抄 |
| 设置三区 / 两区导出 / 试验线索卡 / MinerU 管线 | SETTINGS-DESIGN、29、18 号 | fact/view 分区；失败不产候选 |
| 指南四刻度 | 25 号 | L3 节点=起点+k×间隔；**AML 的随访节奏要按"化疗/移植后"两种语境分开给带宽** |
| 治疗线折叠卡（32 号） | `docs/32-TREATMENT-PATHWAY-FOLDOUT.md` + melanoma `pageTreatPathway()` | 家族模版已定稿：五块缺一违规、beforeprint 展开实测，见下 |
| 工程件 | `lib/version.js`、freeze-contract、check-* 族 | VERSION 唯一来源；迁移哈希冻结；无头实测出数字 |

**32 折叠卡（melanoma 参考实现实测，AML R4 必落）**：`pageTreatPathway()` 用原生 `<details class="phase-fold">`，summary 只放 `● 阶段名 · 日期 · 一句话概要 · 展开细节 ▸`；展开区固定五块（方案/指标和趋势/影像发现/副作用总结/心理与营养措施及效果），`grid repeat(2,minmax(0,1fr))`、≤900px 单列。两个实测坑已写进 AML 的 32 号文档：①打印展开**必须用 beforeprint JS**（Chrome printToPDF 下 CSS 强开无效）；②折叠状态在 `state` 持久化（melanoma L1156–1162 渲染前后保存/恢复 `d.open`）。AML 的"阶段"天然按疗程切（第一疗程诱导 / 巩固 1–4 / 移植 / 维持），demo 的 pathway 数组形状照 32 号 §4 `{d, phase, text, detail:{regimen,metrics,imaging,ae,support}}`。

**34 号接入（AI 一键发送，AML R6 必落）**：cervical 的草稿桥是旧口径"只填不发"；AML 按 `docs/34-AGENT-DRAFT-SEND.md` 实现——业务页 `<app>:agent-draft?prompt=…` 协议链接 → `parent.postMessage({type:'aml:agent-draft', prompt, send:true})` → 壳层校验 `event.source===iframe.contentWindow` 且同源、prompt ≤8000 → `conversation.input.for(actx)`：`setDraft` 后**仅 `phase==='plain'` 且草稿非空**才 `submit()`；降级链（pendingDraft 500ms 轮询、submit 失败保留草稿）与四条断言（对穿断言进 check 链）照 34 号。private 默认不进发送上下文（三出口同源过滤）。

**36 号接入（疾病概要「?」）**：看板右上角「?」展开四段固定结构（定义 / 医学资料规范和指南情况 / 治疗全景概要 / 发展趋势），与 README 同源，全部属第②层（解释）。AML 素材已备：WHO 2022/ICC 分类、中国 2021 指南 + ELN 2022 + NCCN 3.2026、治疗全景按"强化诱导/巩固/移植/不适合强化（ven+aza）/临床试验"分组、趋势只写已发生事实（维奈克拉 2020-12 NMPA 附条件批准、FLT3-ITD 高 VAF 移入中等等——均带来源与【待核验】标记）。AML 已有 `scripts/probe-disease-primer.mjs` 可复用验收。

**30 号接入（窄宽自适应）**：AML 已有 `docs/30-RESPONSIVE-RULES.md` 与 `scripts/check-probe-coverage.mjs`，但缺 `probe-responsive.mjs` 本体与 `test/`。AML 高发区：**诱导日历日格**（7 列 × 6 周网格，最易挤成竖排单字）、**小时级体温轨道**（时间轴标签密集）、**双口径 MRD 卡**（两列并列）、**输注记录表**（六列以上，必须 `.scroll-hint`）。这四处 M2 就跑窄宽扫描，不留到 M6。

**必须癌种化（不许换名复用）**：

| 部位 | cervical/breast 现值 | AML 必须换成 |
| --- | --- | --- |
| 品牌三档色与整套色板 | 青 #18AFA5 全套 / 粉 | **橙 #C46A2B + 行动色深青 + 暖灰分区**；icon 🍊；WIDTH_KEY/DRAFT_QUEUE_KEY 前缀 orangep |
| 分期/分层字典 | FIGO 2018 / 病理类型 | **WHO 2022 或 ICC 分类名（自由文本）+ ELN 2022 三组（只存医院结论 `risk_basis`）**；APL t(15;17) 单列分型（G1 决策同仓或另案） |
| 分子词表 | PD-L1 CPS/p16/MMR/HER2 四态 | **FLT3-ITD/FLT3-TKD/NPM1/IDH1/IDH2/TP53/CEBPA + 变异状态（野生型/突变型/未测）+ VAF + 方法（qPCR/NGS/FISH/核型）**；等位基因比高低量分口径 |
| 时间粒度 | 全家族日期都是 `YYYY-MM-DD`（日粒度地板） | **诱导日历按天（D+N）+ 体温 `HH:mm` 小时级（家族首次）+ 移植 Day+N 相对日期**，见 §六.6 |
| 20 张专属表 | stage/rt/late_effect/cytology… | AML 专属表（诱导日历、体温、粒缺发作、输注、MRD、骨穿、移植、供者、GVHD、黏膜炎……见 §六.7） |
| 五条口径 A–E | FIGO/后装/细胞学/私密/SCC-Ag | A 分层只存医院结论；B 双口径与输注成分分列禁合并；C 培养/影像/报告原文；D 对死亡的准备与家庭负担私密三出口；E 条件显示=ANC 粒缺期模式 + 移植状态驱动 |
| demo 画像 | 鳞癌 IIIC / 乳腺术后上肢 | **双主体画像（家属代记体温为主）+ 诱导期画像**（D1–D28 日历、谷值期体温 4 次/日含小时戳、一次粒缺发作含抗生素时点与血培养） |
| 随访节奏 | 细胞学+SCC-Ag+影像三类 | **每疗程骨穿 MRD + 缓解后血象 + 移植后 100 天节点（Day+N）**；三种语境不同频 |
| 试验关键词 | HPV/放化疗 / 内分泌 | venetoclax/阿扎胞苷、FLT3 抑制剂（吉瑞替尼）、IDH 抑制剂（艾伏尼布/恩西地平）、CPX-351 语境（SCENARIOS S12 指定） |
| check-wording 红线词表 | cervical 词族 | AML 加 K1–K6 词族：不指导用药（K2）、不判复发（K3）、移植零推荐（K4）、不判输血依赖（K5）、"MRD 转阴≠治愈/阳性≠复发"双警示常驻 |
| API 前缀与 routes | /api/cervical | /api/aml（与现有 health 统一） |

---

## 六、AML 结构建议草案（M2 原型候选，待 G1 讨论）

### 6.1 设计输入对齐

**PATIENT-FLOW 三流反推**（`docs/PATIENT-FLOW.md` 骨架）：

- 流一（急症入院与诱导）→ 线 2 诊断与基因（四大检查等待）+ 线 3 诱导与疗程（按天日历）+ 线 4 粒缺发热/输注。
- 流二（MRD 监测与缓解后）→ 线 5 MRD 与随访（双口径）+ 线 6 移植（评估/供者/Day+N）。
- 流三（缓解后长期随访，家属代记）→ 线 4 感染档案 + 线 9 心理与家庭（私密三出口）+ 线 10 复诊摘要。

三条流全部有两条以上线承接。

**六个 AML 特殊语境的落位**：

1. **"先打骨架、结果出来再调方向"**（确诊当天即开始化疗、基因 3–7 天后才出，medical-constraints §1）→ "检查结果等待清单"独立二级页，`genetic_panel_status` 三态（未送/送检中/已出），NGS 等待期 1–2 周是焦虑高峰。
2. **诱导是 4–6 周连续过程**（7 天输注 + 1–2 周谷值 + 骨穿 + 等恢复，家属纸笔记录极易混乱）→ 诱导日历按天是产品主视图之一（K1），不是附属表。
3. **粒缺发热是急症不是记录项**（≥38.3℃ 或 ≥38.0℃>1h + ANC<0.5；抗生素应在血培养后 1 小时内给）→ 体温轨道精确到小时 + 定义原文常驻 + 急症提示不可忽略关闭（K2）。
4. **MRD 两大误解**（转阴≠治愈、阳性≠复发；不同方法/阈值不可换算）→ 双口径并列 + 两条警示文案不可关闭（K3）。
5. **移植是状态机不是事件**（未评估→评估中→已选定供者→预处理中→已移植→移植后随访）+ 供者四类中国语境（同胞全合/半相合/无关/脐血）→ 移植独立线，Day+N 相对日期是患者社群通用语言（K4）。
6. **双主体以家属代记为主**（DEV-REQUIREMENTS 默认值）+ "对死亡的准备"是私密主题 → `author_role` 贯穿体温/症状录入；私密三出口（K6，S11）。

### 6.2 一级 10 条候选线（覆盖 K1–K6 与 S01–S13）

| # | 候选线名 | 接哪句患者话（骨架语料，非一手） | L 线 / K | 与 cervical（及 breast）的刻意不同 |
| --- | --- | --- | --- | --- |
| 1 | 看板 | "现在到疗程第几天？下次骨穿是什么时候？" | L1 | 四点位沿用；特色状态卡 = **当前疗程第 D+N 天 + 粒缺期模式卡（ANC<0.5 自动出现）+ 下次骨穿/移植 Day+N**；cervical 是放疗长期影响卡，breast 是上肢差值卡；「?」疾病概要入口（36 号） |
| 2 | 诊断与基因 | "骨穿是不是抽骨髓？FLT3 阳性是不是很危险？" | L2 | cervical 是 FIGO；AML 是 **确诊经过（血象→骨穿→四大检查，各日期允许仅知月份）+ 亚型/ELN 分层只存医院结论 + 基因逐项解释卡（解释不是判断）**；"未测≠野生型"上屏 |
| 3 | 诱导与疗程 | "7+3 到底是怎么打的？为什么第 8 天反而最危险？" | L3；K1 | cervical 是路径三选一；AML 是 **诱导日历按天（D1–D42 网格）+ 治疗路径 32 折叠卡（按疗程切阶段）+ 巩固与维持（HiDAC / ven+aza 分列）+ 检查结果等待清单**；计划 vs 实际、延迟原因留痕，不评疗效 |
| 4 | 粒缺、血象与支持 | "半夜烧到 38.5 该怎么办？又输血了是不是很严重？" | L5+L4 部分；K2 K5 | cervical 的 L5 起点是放疗；AML 是 **粒缺发热轨道（小时级体温曲线+抗生素时点+血培养，定义原文常驻）+ 血象趋势（CTCAE 徽章，谷值期语境）+ 输注记录与反应（成分分列、累计量汇总）+ 黏膜炎与症状 + 感染档案与预防**；不指导用药（K2）、不判依赖（K5） |
| 5 | MRD 与随访 | "MRD 转阴了是不是就好了？" | L8+L4 部分；K3 | cervical 是三类随访节点合成一页；AML 是 **MRD 双口径趋势（流式 %/PCR 分列禁合并）+ 骨穿与标本记录 + 复查节奏（骨穿按疗程、影像并列 S09）**；两条警示文案不可关闭 |
| 6 | 移植 | "要不要移植？半相合是不是退而求其次？" | L3 延伸；K4 | cervical/breast 都无此线；AML **移植评估档案（状态机）+ 供者与配型记录（四类+HLA 相合度）+ Day+N 时间轴与 GVHD 记录（100 天节点）**；零推荐，GVHD 代价如实呈现 |
| 7 | 病情一图秀 | "变化发生在哪一步" | 横切层 | 骨架同构；默认选线 **ANC/PLT（血象）+ 体重 + 同方法 MRD**，分类节点 = 疗程事件/粒缺发作/输注/移植节点；**小时级数据只以"发作"分类节点上轴，曲线留在轨道页**（见 §六.6） |
| 8 | 营养与生活 | "粒缺期什么都不能吃吗？口腔溃疡疼得吃不下" | L6 | cervical 是进食量；AML 加 **粒缺期食物安全（事实提醒非命令式）+ 出入量（呕吐防脱水）**；不给食谱处方 |
| 9 | 心理与家庭 | "我不敢跟家里人说我在想什么" | L7；K6 | cervical 专属子页是"母亲身份"；AML 是 **当下感受（双主体并列不平均）+ 对死亡的准备（私密，默认三出口过滤）+ 家庭负担与照护者**；FCR 不随缓解归零 |
| 10 | 资料与复诊 | "复诊带什么？还有没有我能参加的研究？" | L9+L10 | 对 cervical 拆三条合并为一条 4 子页（同 thyroid/GBM/MEL 惯例）：资料库与导入 / 草稿核对 / 就诊准备与导出（两区、private 过滤）/ 试验线索（ven/FLT3/IDH，线索不是推荐） |

### 6.3 二级 27 个候选页签

| 一级 | 二级候选 | 职责一句 |
| --- | --- | --- |
| 看板（0） | — | D+N 状态卡 + 粒缺模式卡 + 「?」疾病概要；无二级 |
| **诊断与基因（3）** | 确诊经过与四大检查 | 血象异常→骨穿→形态/流式/核型/分子四个日期，允许"仅知月份"；骨穿≠抽骨髓澄清卡 |
| | 亚型、分层与基因解释卡 | WHO/ICC 分类名（自由文本）+ ELN 三组只存医院结论 `risk_basis`；基因逐项"是什么"，**未测≠野生型**，不写"你是高危" |
| | 会诊与二次意见 | 同 cervical 骨架 |
| **诱导与疗程（4）** | 诱导日历（按天） | **D1–D42 日格网格**：化疗 D1–7 打勾、谷值期 D8–14 期带、骨穿窗口（停化疗后 7–14 天）、每日体温/输注摘要进格；第二疗程可并排；不做"疗程"粒度（K1） |
| | 治疗路径（32 折叠卡） | 按疗程切阶段；五块折叠卡 + 计划 vs 实际表；只记录不推荐 |
| | 巩固与维持 | HiDAC 疗程（q12h D1/3/5）与 ven+aza（剂量阶梯、CYP3A4 相互作用提示）分列；不评疗效 |
| | 检查结果等待清单 | genetic_panel_status 三态 + 等待中项目 + "结果出来会先给医生看"；承接等待焦虑 |
| **粒缺、血象与支持（5）** | 粒缺发热轨道 | **小时级体温曲线 + 抗生素时点 + 血培养双套 + ANC 联动**；定义原文（≥38.3℃+ANC<0.5）常驻；急症提示不可忽略；"一发烧就按铃"（K2） |
| | 血象趋势 | WBC/ANC/Hb/PLT 分组卡 + CTCAE 徽章 + 背面区间 + 谷值期对照；只给数值+分级+上次值+何时复查 |
| | 输注记录与反应 | 红细胞/血小板/血浆分列（日期/单位数/辐照去白/反应枚举）；累计红细胞单位数自动汇总（铁过载决策输入，不做铁过载结论）（K5） |
| | 黏膜炎与症状 | 0–3 强度轨道呈现不画曲线；不荐护理方案（S07） |
| | 感染档案与预防 | 发作史、预防用药（泊沙康唑/伏立康唑按院方原文）、疫苗话题只记"问过什么答了什么原文" |
| **MRD 与随访（3）** | MRD 双口径趋势 | 流式 % 与 PCR（靶点绑定）**两列并列，跨方法不连线**；两条警示文案常驻（K3） |
| | 骨穿与标本记录 | 每疗程采样日期/部位/结果原文；原始细胞百分比存原文+数值 |
| | 复查节奏与影像并列 | 骨穿按疗程、影像按区间（S09）；节点=起点+k×间隔，带宽标注工作台约定 |
| **移植（3）** | 移植评估档案 | 状态机（未评估→…→移植后随访）+ 评估项目（心肺/感染筛查/铁过载）+ 医生答复原文；零推荐（K4） |
| | 供者与配型记录 | 四类供者 + HLA 相合度（10/10 等）+ 检索/确认日期；"半相合在中国已非常成熟"是可引用出处不是安慰话 |
| | Day+N 时间轴与 GVHD | 预处理→Day 0 回输→粒细胞植入约 Day+14→100 天节点；GVHD 三联观察记录；移植后随访用 Day+N（K4） |
| **病情一图秀（0）** | — | ANC/PLT + 体重 + 同方法 MRD + 分类节点；无二级 |
| **营养与生活（2）** | 食量与体重 | 份量、食物、症状；体重进指标；不给食谱 |
| | 粒缺期食物安全与出入量 | 避免生食/隔夜菜等按院方原文；呕吐记出入量防脱水；事实提醒非命令式 |
| **心理与家庭（3）** | 当下感受（双主体） | 患者/照护者各自记录、并列展示、不平均；author_role 贯穿（K6） |
| | 对死亡的准备（私密） | 默认私密、三出口过滤、逐项授权；不承诺、不判读（S11） |
| | 家庭负担与照护者 | 照护者自己的记录位；"还能正常上班吗"承接长期随访话题 |
| **资料与复诊（4）** | 资料库与导入 | MinerU 六部件、失败不产候选；病理/流式/基因/影像报告分类（S13） |
| | 整理草稿与核对 | 候选逐项 accept 前不进正式数据 |
| | 就诊准备与导出 | 两区导出 + private 默认过滤 + 问题清单版本与"已过时"标记（S06） |
| | 试验线索 | venetoclax/FLT3/IDH 2026 线索（`fetch-aml-trials-2026.mjs` 已在 scripts）；线索不是推荐（S12） |

合计：一级 **10** / 二级 **27**（0+3+4+5+3+3+0+2+3+4）。单线最大 5（粒缺血象与支持）≤6；二级为 0 的一级 = 2（看板、一图秀）≤2；一级 10 ∈8–10；二级 27 ∈24–30。

### 6.4 K1–K6 与 S01–S13 覆盖矩阵

| 约束 | 落页 | 结构证据（M3 冻结时的断言） |
| --- | --- | --- |
| K1 诱导日历按天 | 3·诱导日历 | `regimen_calendar` 逐日行 `{d, day_index, items[]}`；`day_index = floor((d−start)/DAY)+1`；**无"疗程粒度"聚合列**；读模型输出日格 |
| K2 粒缺发热独立轨道 | 4·粒缺发热轨道 | `temperature_log.ts` 含 HH:mm（家族首次）；`fever_flag` 读模型规则（38.3/38.0+1h）；定义原文常驻渲染断言；急症提示不可忽略关闭；词表禁"吃点退烧药/观察看看" |
| K3 MRD 双口径 | 5·MRD 双口径趋势 | `mrd_record` 阴阳性必须与方法+靶点绑定；趋势按同方法同靶点分组连线，**跨方法不共轴不连线**（27 号）；UI 断言无单一"MRD 状态"合并字段；两条警示不可关闭 |
| K4 移植零推荐 | 6 全部 3 页 | `transplant_status` 状态机；供者四类枚举；无任何推荐/评分列；Day+N 相对日期字段 |
| K5 输注独立轨道 | 4·输注记录与反应 | `transfusion_record` 成分枚举 CHECK；**禁"总输注"合成**；累计量只做红细胞单位汇总（铁过载的直接输入），不判依赖 |
| K6 双主体+私密三出口 | 4·体温录入、9 全部 | `author_role`（patient/caregiver）必填列；`viewpoints`/死亡准备 `visibility` 默认 private；一图秀/摘要/导出三出口过滤收敛一个函数 + 单测 |

| 场景 | 落页 |
| --- | --- |
| S01 确诊与开始 7+3 | 2·确诊经过 → 3·诱导日历 → 3·等待清单 |
| S02 粒缺期发烧 | 4·粒缺发热轨道（定义原文+按铃提示） |
| S03 MRD 转阴 | 5·MRD 双口径趋势 + 解释卡 |
| S04 移植/供者 | 6·移植评估档案 + 供者与配型 |
| S05 又输血 | 4·输注记录与反应 |
| S06 复诊准备 | 10·就诊准备与导出 |
| S07 口腔溃疡 | 4·黏膜炎与症状 + 8·粒缺期食物安全 |
| S08 家属代记体温 | 4·粒缺发热轨道（`author_role=caregiver` 快速连录） |
| S09 影像并列 | 5·复查节奏与影像并列 + 7·一图秀（同模态才并列） |
| S10 营养与体重 | 8·食量与体重 |
| S11 心理（对死亡的准备） | 9·对死亡的准备（私密）+ 9·当下感受 |
| S12 试验线索 | 10·试验线索（ven/FLT3/IDH） |
| S13 文档导入 | 10·资料库与导入 + 10·整理草稿与核对 |

二期不占结构：APL 分型（M3，另案或同仓——G1 决策）、儿童 AML、CAR-T 专属、移植后 GVHD 深化。

### 6.5 按天/小时级时间轴的可行实现方案（家族首次，M2 的技术核心）

**家族现状实测**：

- **一图秀全是月粒度**：cervical/melanoma/thyroid 三仓的 `monthTicks(t0,t1)` 都按自然月打刻度（`YYYY-MM` 标签，>18 个月每 4 个取 1），SVG 画布 900px 宽要装下数年——**月粒度是设计前提，不是偶然**。日期值全部是 `YYYY-MM-DD` 字符串解析为 ms，**没有任何一仓存过 HH:mm**。
- **有"跨天期带"机制可复用**：thyroid `treatmentBands()` 里 RAI 隔离期带 `{kind:'iso', from: c.d, to: addDays(c.d, isolationDays)}` 证明 from/to 跨天带是现成能力——诱导日历的"输注期 D1–7 / 谷值期 D8–14 / 骨穿窗口"期带可直接套。
- **没有日格网格日历**：thyroid 的「隔离防护日历」实为 checklist 打卡（`mat-row` + checkbox），不是按天网格。K1 的 D1–D42 网格必须新做。
- **没有小时级组件**：体温曲线、抗生素时点、血培养都需要小时戳，三个仓都无先例。

**扩展方案（三条，全部不动 16 号合同）**：

1. **诱导日历 = 新组件 `dayGrid`，不借一图秀**。7 列（周一锚定 D1）× 至多 6 行的日格网格；每格 = 日期 + `D+n` 角标 + 内容标记（化疗打勾 / 骨穿 / 输注次数 / 当日体温 min–max 摘要）；期带用 thyroid from/to 机制在格背景上画。数据逐日行而非"疗程"行；`day_index` 由读模型派生，**允许"仅知月份"精度**（medical-constraints §1：所有确诊相关日期允许仅知月份——日格对缺日精度的显示"2026-03 某日"占位，不造数）。第二疗程并排第二块网格。
2. **粒缺发热轨道 = 新组件 `hourLane`，数据引入 `HH:mm`**。x 轴 = 发作窗口内的小时（或整个诱导窗口按需缩放），体温折线 + 38.3/38.0 两条参考线（标注"定义原文口径"）+ 抗生素时点/血培养/升阶梯节点（分类只画节点）；`temperature_log.ts` 存 `YYYY-MM-DDTHH:mm`。**小时级曲线只活在本页**：进一图秀时降维为"粒缺发作"分类节点（月粒度轴装不下小时，跨尺度共轴违反 16 号可比性合同）。
3. **移植 Day+N = 复用 `day_index` 机制换锚点**。锚从"疗程序号"换成"Day 0 回输日"，轴标签渲染为 `Day −7 … Day 0 … Day +100`；与诱导日历共用同一个"相对天数轴"原语（一个函数两个 anchor），GVHD/植入节点按 27 号分类只画节点。**三种粒度（月/天/小时）分属三个组件，互不混轴**——这是本草案对 16 号的关键补充断言。

配套工程件：`day_index`/`Day+N` 派生进读模型与 parity；`ts` 小时戳进 demo 生成器与 `check-demo-columns`；M2 窄宽扫描必须覆盖 dayGrid 与 hourLane 两页。

### 6.6 差异化判据自查与重名率实测

- 一级 10（∈8–10）/ 二级 27（∈24–30）；二级为 0 的一级 = 2；单线最大 5。若 G1 要加二级，先砍（候选：把「检查结果等待清单」并回「确诊经过」，或「输注反应」并回「输注记录」）。
- **与 cervical 12 条一级并排（实测）**：完全同名 = 看板、病情一图秀，共 **2 条 = 20% ≤70% ✅**。宽松口径（共享核心词）再加「营养与生活↔营养支持」「心理与家庭↔心理支持」「资料与复诊↔复诊准备」= **5 条 = 50%**，仍过线。与 breast 8 条并排：完全同名 = 看板、病情一图秀 = 25%。
- AML 新增结构位 6 条（诊断与基因、诱导与疗程、粒缺血象与支持、MRD 与随访、移植、营养与生活换义），占 60%——粒缺/输注/移植/按天日历四件在 cervical/breast 均无对应物，属临床结构决定，非换标题（26 §4.1 判据）。
- S01–S13 全部落页、K1–K6 全部有结构断言（§6.4）。**DEV-REQUIREMENTS 用 K1–K6 已避开与 DEV-PLAN 里程碑 M1–M6 的同号冲突**（MEL 曾踩此坑后改名——AML 建仓时已修正，保持即可）。

### 6.7 schema 草案（M2/M3 建库输入，不是冻结）

| 线 | 建议表 | 关键口径 |
| --- | --- | --- |
| 2 诊断与基因 | `diagnosis_events` / `subtype_rows` / `gene_results` / `risk_rows` | 四大检查日期允许月份精度；基因状态（野生型/突变型/未测）+ VAF + 方法；ELN 只存医院结论，无推导列 |
| 3 诱导与疗程 | `regimen_calendar` / `pathway_rows` / `consolidation_rows` / `pending_checks` | 逐日行 + `day_index`；pathway 折叠卡五块形状；ven/aza 剂量阶梯分列；等待清单三态 |
| 4 粒缺血象与支持 | `temperature_log` / `febrile_episodes` / `cbc_points`（入 metrics） / `transfusion_record` / `symptom_rows` / `infection_rows` | `ts` 含 HH:mm；`fever_flag` 读模型派生；episode 含"首剂抗生素距发热时长"；成分枚举 CHECK；累计量派生不存储 |
| 5 MRD 与随访 | `mrd_record` / `marrow_rows` / `rhythm`（通用） | 方法+靶点绑定阴阳性；趋势分组按 (method,target)；跨方法不连线 |
| 6 移植 | `transplant_status` / `donor` / `transplant_timeline` / `gvhd_rows` | 状态机枚举；供者四类 + HLA 相合度；Day+N 相对日期；GVHD 部位/分级只抄原文 |
| 7 一图秀 | `events` / `metric_points`（通用） | 小时级数据降维为分类节点上轴 |
| 8 营养与生活 | `nutrition_rows` / `io_rows`（出入量） | 事实提醒非命令式 |
| 9 心理与家庭 | `viewpoints`（通用） / `mind_rows` | `author_role` + `visibility` 默认 private（死亡准备/家庭负担）；三出口过滤 |
| 10 资料与复诊 | `documents` / `candidate_fields` / `exports` / `trials` / `questions` | 事实四层不合并；两区导出 |
| 通用平移 | `subjects` / `section_titles` / `metrics` / `metric_points` / `molecular`（词表换 AML 基因）/ `events` / `rhythm` / `cycles` / `treatment_lines` / `viewpoints` / `trials` / `documents` / `candidate_fields` / `demo_meta` + `profile_meta` | 机制照 cervical；词表/字段换 AML |

AML 的 L4 指标分析口径：**血象是家族少有的绝对阈值完备组**（CTCAE 分级徽章全套适用），但 **LDH/铁蛋白/维奈克拉相互作用检查只做记录不做分级**；无实体瘤式血清标志物趋势预测。

### 6.8 已知张力（G1 决策点，写明不沉默）

1. **「粒缺、血象与支持」一线 5 个二级顶格**：血象/输注/粒缺/黏膜炎/感染五件都是高频，若 G1 觉得挤，可拆「血象与输注」独立成线（一级变 11，超 26 号上限，须同步砍二级）。
2. **粒缺发热轨道放线 4 还是升独立一级**：K2 只要求"独立轨道"。本草案放线 4（与 ANC 联动、与输注同场景）；若 M1 访谈显示急症场景独立成主轴，可升一级（一级变 11 的同一张力）。
3. **APL 分型同仓还是另案**：DEV-REQUIREMENTS §四明确 G1 决策。APL 诊疗节奏（ATRA 疑似即用、DIC 风险）与普通 AML 差异大；若同仓，诱导日历需支持 APL 模板，占 demo 与词表预算。
4. **小时戳的存储精度**：本草案 `temperature_log.ts` 用 `YYYY-MM-DDTHH:mm`（分钟级）；若照护者实测只记到小时，展示层降级即可，存储不降（录多少存多少，不补零造精度）。
5. **累计输血量的呈现**：medical-constraints 要求"累计输血量自动汇总"（铁过载决策输入），但 K5 禁判依赖。呈现为"累计 X 单位红细胞（医生评估铁过载时会用到的数字）"，不出现"依赖/超标"。
6. **品牌与色板**：小橙宝/橙 #C46A2B 是 DEV-REQUIREMENTS 占位默认；icon 🍊 未定；家族已有青/粉/墨绿/紫等多套，G1 定三档色时避免与既有工作台撞色，橙底白字的对比度要过 WCAG（#C46A2B 对白字约 4.0:1，按钮文字需复验）。
7. **体温录入负担**：谷值期每日 4 次以上、含小时；S08 是家属代记。录入控件必须"两击一条"（时间默认现在 + 大数字键盘），否则真实使用会弃——M2 原型实测录 3 条的耗时。

---

## 七、移植注意（cervical 0.1.1 → AML）

**直接复用（文件级，改 ID/品牌后原样搬）**：

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 客户端 | `src/client.js` + `scripts/build-client.mjs` + `lib/layout.js` | customFrame 外壳全结构零癌种内容；只换 §三 的 14 token 源头 + 8 处手写品牌；**草稿桥按 34 号升级为 send:true 自动发送** |
| | `lib/version.js` + `build-version.mjs`、`lib/zip.js` | 版本唯一来源、导出打包 |
| 数据层 | `dsh/` 12 文件：server/routes/store/import/export/readmodels/settings/mineru/layout/index/workbench/demo | 零依赖 http + 127.0.0.1 + 前缀改写。**AML 现状只有 index.js，11 件全要平移**；AML 已有 `fetch-aml-trials-2026.mjs` 可并进 import/trials |
| | `schema/freeze-contract.md` 机制 | 迁移冻结与"只增不改"执行器；表内容全换。AML 无 schema/，从零建但机制照抄 |
| 工程 | cervical 的 `check-{schema,syntax,version,wording,pack,demo-columns}.mjs`、`dev-server.mjs` | AML 缺这 6+1 件；AML 已有 17 个自有 check/probe 脚本保留并并入 check 链；wording 红线按 K1–K6 扩 |
| 原型 | cervical `prototypes/v0.2/` 骨架段 + melanoma v0.2 的 `pageTreatPathway()`/`.phase-fold` 段 | PAGES/SUBPAGES 常量结构、state 模型、hash 路由 + go-*、esc/fmtDate/delta、3D 翻面、sidebar/breadcrumb、一图秀 SVG 段；折叠卡从 melanoma 抄（含 beforeprint 与状态持久化两件实测修正） |
| 样式 | `style.css` 令牌骨架 | 五组令牌结构保留，色值整组换橙 #C46A2B 系 |
| 窄宽 | 从 melanoma/GBM 参考实现抄 `probe-responsive.mjs` SCAN 段 | AML 缺此件与 `test/`；只换 `#main`/hash |

**必须换掉（不许换名复用）**：

1. **20 张 cervical 专属表 → AML 专属表**（§6.7 逐线配表）；通用 14+1 张平移，`molecular` 词表换 FLT3/NPM1/IDH/TP53/CEBPA 且状态改**三态（野生型/突变型/未测，未测≠野生型）**。
2. **cervical 五条口径 A–E → AML 重写**（§五末行）：分层只存医院结论 / 双口径与输注成分分列 / 报告原文 / 死亡准备私密三出口 / ANC+移植状态驱动条件显示。
3. **demo 画像与指标字典**：鳞癌 IIIC → **双主体画像（家属代记为主）+ 诱导期画像**：D1–D28 逐日行（含 D8–14 谷值期带、一次粒缺发作含小时级体温 4+ 次/日、抗生素时点、血培养双套）、流式+PCR 两套 MRD 点、输注 2–3 次、移植画像第二档案（Day 0/+14/+100）。演示律照家族（化验 2–4 周一点、影像不加密），AML 特例：**体温序列必须跨小时且 38.3 上下都有点**，否则 fever_flag 与 hourLane 演示不出来。
4. **文案全量**：SUBTITLES、看板任务卡 go-*、免责句、onboardingPrompt 5 行、Fallback/顶栏 hint——按 AML 立场重写，新增词族："粒缺发热按铃不等血象（不指导用药）""MRD 转阴≠治愈、阳性≠复发""移植是否做由你与治疗团队决定""未测≠野生型""D+N 天数是记录不是预测"。
5. **品牌与身份**：TITLE/PANEL_TITLE、icon 🍊、橙 #C46A2B 全套、WIDTH_KEY/DRAFT_QUEUE_KEY 前缀、`aml:agent-draft` 消息类型（业务侧两端同改，34 号 send 契约）、package.json name/repository、cordis.patch.yml、API 前缀。
6. **API 前缀统一**：现有 `dsh/index.js` 只注册 `/api/aml-workbench/health`，与 `__API_PREFIX__` 的 `/api/aml` 不一致。M5 定稿二选一写进 API-CONTRACT（建议统一 `/api/aml`，health 改 `/api/aml/health`）；守卫只禁交界重复 `/api/api`。
7. **测试从零建**：最低集 `responsive.test.mjs`（dayGrid/hourLane/MRD 双列四档宽）、`wording.test.mjs`（K1–K6 红线）、`schema.test.mjs`（冻结哈希 + 三态 CHECK + 禁推导列 + 成分枚举）、`granularity.test.mjs`（day_index/Day+N 派生、小时戳不降精度、跨方法 MRD 不连线）、`privacy.test.mjs`（三出口 + author_role 不混排）。
8. **36 号疾病概要**：README 与看板「?」同源四段；AML 素材从 medical-constraints 十节抽，全部带来源与【待核验】标记；`probe-disease-primer.mjs` 已在仓，接进 check 链。
9. **文档示例词防残留**：`docs/24-METRIC-TREND-TAB-DESIGN.md`（乳腺/淋巴瘤截图）、26/27/18/25 号都带其他病种示例。作为参考出处保留，但**任何一句不得进入 public/ 原型文案、demo 数据、导出模板**；check-wording 扫这三处。

---

### 落点提示

- 本篇 §6.2–6.3 → 填 `docs/DIFF-MATRIX.md` 全量行与自查（与 cervical 重名率 20% 已实测）；§6.3 → M2 原型 PAGES/SUBPAGES/SUBTITLES 常量；§6.5 → M2 原型的 dayGrid/hourLane/Day+N 三组件任务拆分；§三 → M5 客户端移植清单；§6.7 → schema 草案；§七 → DEV-PLAN M2/M5 任务与 check 链补件。
- 待 M1 补：SCENARIOS 一手回填（S01–S13 骨架句全部待替换）、家属代记体温的真实录入负担（H 类待建）、粒缺发热提示措辞的院方核对（2026 版指南上线前校对）、APL 同仓/另案、移植 Day+N 与绝对日期并存的显示带宽。
