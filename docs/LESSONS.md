## 2026-10-25 · 从慢性淋巴细胞白血病小淋宝 LymPal（cll-workbench v0.2.0）回收

### L28 · 移植底本的检查器会把**底本病种名**当成本项目的期望值

`scripts/check-host-contract.mjs` 从「底本 + 布局」拼出的字符串里正则找 `customFrame`。
底本头部注释里写着「面板 customFrame=true · 业务 left 0.65」，而本项目的真实值是
`const CUSTOM_FRAME = String(PANEL.customFrame === true)`（生成物里的常量引用）。三轮修法都不对：

1. 先报 `true · 业务 left 0.65`（注释被当值）→ 只剥 `//`/`/*` 行头，**没剥块注释续行 ` * `**；
2. 再报 `'true' === 'true'`（常量赋值式被当值）→ 把正则收窄成 `customFrame:\s*` 对象属性形态；
3. 最终仍报 `CUSTOM_FRAME`（属性值本身是常量）→ 还要**解析常量定义**取字面量。

**规则（可做成断言）**：检查器读生成物时，**先剥注释再匹配**，且属性值允许「常量名」——
需回查 `const NAME = 'true'|'false'` 的定义。判据：把底本原样换成新病种，检查器应直接绿；
若不绿，问题在检查器不在项目。

### L29 · 五套测试是按底本**业务形状**写的，换病种必须整体重写而不是改常量

底本的 `store/server/import-export/demo-parity/ui-parity` 断言的是 `metric_points`、`documents`、
`candidate_fields`、私密分节 `vagina/sexual`。直接 `sed` 换病种名 → 31/42 红（不是环境问题，是形状不符）。
CLL 的 19 表与 cervical 的 18 分节没有任何一列同名。

**规则**：移植第一步先跑一遍底本测试，把红项按「形状不符 / 环境不符」分类；形状不符的一律
**按本项目 schema 重写**（本仓重写后 41/41）。改常量能让它变绿的那种改法是假绿。

### L30 · 「数据只有一个来源」要在**两处**同时钉住：生成器与原型

原型（视觉基准）与 demo 生成器（入库基准）各有一份血象序列时，日期与点数会悄悄分叉
（原型 10 点 2024-11 起 / 生成器 9 点 2024-03 起）。**正确方向是生成器服从原型**——
原型是签认过的视觉基准，生成器跟它对齐后，parity 测试才有意义。

**可断言**：`test/demo-parity` 里逐点 `deepStrictEqual(原型点位, 生成器点位)`，
而不只比点数或末值。只比末值时两条不同序列也可能通过。

### L31 · 装机目标 profile 不能凭 `~/.dsh` 推断

本机同时存在两套：`~/.dsh/profiles/desktop`（通用 CLI）与
`~/Library/Application Support/dsh-desktop/harness/profiles/web`（DSH Desktop app 实际使用）。
按 06 号做「装到 ~/.dsh」会**装成功但 Desktop 永远看不到**，而 `verify-desktop-load` 会如实报
「装机目录 未安装」。

**规则（可做成断言）**：装机前先读 `desktop-workbenches/state.json` 的 `added` 数组——
里面出现的 workbench 说明宿主认这个 profile；再用 `~/Library/Logs/DSH Desktop/harness.log`
里出现的 `profiles/<名字>/node_modules` 路径交叉确认。两处一致才动手装。

### 待实施⑦（下轮进检查器）

- `check-workbench-package`：移植自底本时，若 `package.json` 的 `files` 未包含运行时会读的目录
  （`schema`/`public`/`demo`），报红（与 NF 回流待实施⑤之②合并实现）。
- 新增 `check-derivative-leftovers`：扫 `dsh/ lib/ public/ src/ test/ scripts/` 里出现
  **底本病种名/底本品牌名**（如 `cervical`/`CerviPal`/`小莲宝`/`宫颈`）即报红。
  本轮实测残留 14 处（`src/client.js` 标题、`dev-server.mjs` 用法行、两个测试的 brand 断言），
  人工 `grep` 才清掉；这类残留会直接出现在患者界面上。

## 2026-10-25 · **假面孔 C：被空值骗过的真**

慢性粒细胞白血病工作台（小粒宝）第四轮独立评审抓到的，比前两副面孔更隐蔽——**它不是假失败也不是假通过，是一条"证据看起来完备"的假通过**。

```js
// 断言：关掉"治疗条"后曲线不变（16 号 R3 硬要求）
const before = path.getAttribute('d');
toggleTreatment();
const after = path.getAttribute('d');
assert(before === after);   // 恒成立——因为 before 和 after 都是空字符串
```

真实情况：绘图函数的调用方传 `[x, y]` 数组，函数只认 `{x, y}` 对象，`filter` 把点全丢了 → `d=""`。
**图上一根线都没有画出来**，而这条断言绿了整整一轮，自检里还写着「实测 True」。

同一轮第二例：图例写「全期口径」，基线实际取的是**窗口内**首点。切 6 个月窗口后基线从 42.6% 变 8.4%，
但"图例文字没变"这条也绿——因为没人核过基线的**来源**。

**修法与验收合同**：

1. **断言"不变"之前，先断言"有东西"**。顺序不能反：
   `assert(d.length > 0)` → `assert(bbox.width > 0 && bbox.height > 0)` → 再比 `before === after`。
2. **"不变"要比较所有会变的量**，不只最显眼的那个。本项目只比 `d`，漏了每个点的 `cy`——
   而缺陷恰好只动 `cy`（治疗条压缩了绘图区高度）。逐项列全：路径、坐标、bbox、容器高度。
3. **凡声称"口径 X"，断言必须核口径的来源**。写"全期口径"就要断言基线等于全期首点，
   而不是断言"这段文字没改过"。
4. **空窗口用例触发不了时记 SKIP，不记 PASS**。触发不了却记 PASS 等于假装验过。

**元教训（可直接做成断言）**：一条断言如果**在实现完全坏掉时也能通过**，它就不是断言，是装饰。
写完立刻想一遍"我把核心逻辑删掉，这条还绿吗"——本项目那两条都会绿。

## 2026-10-25 · 从神经纤维瘤病 v0.1.3 回收：profile 目录会被应用迁移

**【2026-10-26 修正：上一版这条把方向写反了】** 工作台 bundle 永远装 **DSH Desktop.app** 的
profile：`~/Library/Application Support/dsh-desktop/harness/profiles/web`（本地惯例：tgz 拷进该目录、
依赖写 `file:<tgz 文件名>`、bundles 数组登记、`CI=true corepack pnpm install --no-frozen-lockfile`）。
**不能**因为 `pgrep -fl dsh-desktop-host` 看见 DeepSeek Harness（Agent 宿主）的 argv 指向
`~/.dsh-classic/profiles/desktop` 就往那里装——Agent 宿主加载工作台 bundle 会把宿主搞崩
（NF 0.1.2–0.1.4 三轮装错位置，用户反馈"安装位置错误，导致 dsh 崩溃"后纠正）。
两个 app 的分辨判据见 1.5.7 节；激活的硬证据：DSH Desktop 的 web profile 数据目录里出现
`schema_migrations` 有记录的 sqlite（真目录模式不灌演示数据，表计数 0 是正确行为）。

## 2026-10-25 · 从神经纤维瘤病小纤宝 FibroPal（neurofibromatosis-workbench v0.1.2）回收

- **L26/L27 见上表**（真机 boot 的 ctx.config 未注入；files 漏 schema/）。**待实施⑤（下轮进检查器）**：`check-workbench-package` 增加——① `dsh/*.js` 出现 `ctx.config` 且对应 `apply(ctx` 无第二参 → 报错；② 存在 `dsh/store.js`（读 `../schema`）而 package.json files 缺 `schema` → 报错。
- **可复用结构（templates 挂钩）**：`templates/FLIP-METRIC-CARD.md`——分系列有序指标卡墙 + 正面当前值/背面最近记录与来源的 3D 翻转卡（含 reduce-motion 降级与键盘 Enter 支持），与 32 号折叠卡并列的第二个"原型即模版"结构；`prompts/ZERO-TO-DEV.md` 已在功能线清单挂引用。
- **流程规则**：自动领取前必须按 issues 搜索确认无人正在做（本轮 PF-ILD/地贫/儿童急淋均已被认领，BACKLOG 未认领池 ≠ issues 现实）；判读词黑名单在 NF 语境追加"恶变/癌变风险提示、遗传概率建议"两类（仅静态来源引用豁免）。
- **待实施⑥（既有失败，2026-10-25 实测）**：starter `npm test` 中 "ships the desktop-load verifier" 在本机失败——`verify-desktop-load.mjs` 在找不到 DSH Desktop harness 目录时直接抛「找不到…harness 目录」，没走到「界面加载核验」可读结论分支（test/starter.test.mjs:59 期望 `/界面加载核验/`）。该失败早于本次 NF 回流（stash 验证过），按不修绿纪律只登记不擅改。
