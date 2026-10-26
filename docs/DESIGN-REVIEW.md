# 设计独立审查记录

状态：待执行。自审与独立模型审查分开，不以模板存在宣称review完成。

| 轮次 | 阶段/文档版本或hash | 实际模型/推理档位/审查Agent | 时间与输入范围 | 发现及优先级 | 建议/讨论项 | 用户决定与修改证据 | 未解决项 |
| --- | --- | --- | --- | --- | --- | --- | --- |

评审重点：用户任务证据、专业视角偏差、场景取舍、完整闭环、AI解释价值、分期、来源时效和主体/隐私。记录高优先级问题，而非只给“通过”。未能调用实际独立模型，写明待完成及影响，不阻断全部探索。

本表只审设计方案，不代表发布已授权、包已安装、Desktop已加载或市场已收录。发布决策与证据分别记录在 `docs/RELEASE.md`、`docs/ACCEPTANCE.md`；市场流程见 `docs/10-MARKET-PUBLISHING.md`。

## G2 前独立评审（2026-10-26）· P0=2 → 已全部修复

评审人：独立评审 Agent（主线模型，CDP 真实浏览器实测 + 代码逐行核对）。

### 初评结论：**不通过**（P0=2 / P1=4 / P2=6 / PASS=12）

| ID | 等级 | 问题 | 证据 | 修复 |
| --- | --- | --- | --- | --- |
| F-01 | **P0** | 粒缺发热急症提示被静默关掉：`onSave(vals); closeModal()` 把刚弹出的急症框立即关闭——录 38.5℃ 无任何提示 | app.js:895 + CDP 埋点 finalOpen=false | ✅ openForm 支持 `onSave` 返回 true 接管弹窗；temp-add fever 分支先 closeModal 再 feverFlag 并 return true |
| F-02 | **P0** | 急症框可被 Esc / 遮罩点击忽略关闭（与"不可忽略"承诺不符） | 全文件 cancel 监听 0 处；实测 Esc/backdrop 均关闭 | ✅ dataset.emergency 标记 + cancel/click 拦截 + closeModal 清标记 |
| F-03 | PASS | classifyTemp 三常量语义正确（11 例边界全过） | 11/11 实测 | — |
| H-01 | P1 | 代记体温只存不显（`mem().temps` 无渲染读取） | grep 3 处均写不读 | ✅ pageNeuFever 按 episode 时间窗合并 liveTemps 去重排序 |
| H-02 | P1 | hourLane 事件标签重叠（12:40 ∩ 13:10 叠印） | SVG 坐标实测 | ✅ 相邻 <22 单位交替两行 + 虚线引导 |
| H-03 | P1 | README 8 张截图指向过期资产 + 1 张破图（`-v0.2.0` 不存在） | 尺寸/时间戳比对 | ✅ 引用统一 `-0.2.0`，删 8 个 `-v0.2.0` 残留，重跑 shots 9 张 |
| H-04 | P1 | 评审截图 primer 拍到淡入起始帧 | 像素 diff 138px | ✅ 重拍（脚本内等待稳定态），本轮截图非看板 |
| H-05 | P2 | 一图秀输注泳道标签重叠 | 文本包围盒相交 | ✅ 按 x 排序贪心错行（<34 单位换行） |
| M-01 | P2 | dayGrid `.today` 死代码（TODAY 不在疗程窗口） | 实测 todayCell=NONE | ⏳ 已知：保留分支（换疗程窗口即生效），记入待办 |
| M-02 | P2 | 发热定义双前缀重复渲染 | 实测文本双前缀 | ✅ 渲染时剥离 meta 自带前缀 |
| M-03 | P2 | 字号越界（body 15.5 / eyebrow 11.5 / footer 12 / dayGrid 10–11） | computed fontSize 实测 | ✅ body→15、eyebrow→12.5、footer→12.5、dg-day/dg-dn→12.5、dg-mark→12 |
| M-04 | P2 | 35 号 v2 试验匹配未实现 | 试验页仅 4 列表格 | ⏳ **本期不实现**（已在 DIFF-MATRIX 标注为二期；命名红线干净，无 eligible/适配度） |
| M-05 | P2 | screenshots 两套资产并存 | 17 文件 | ✅ 删残留后 9 张 |

### 修复后复验（实测）

- E2E（CDP）：录 38.5 → `#dialog.open=true` 标题「这是急症信号」→ Esc 不关 → 遮罩不关 → 点确认才关 ✓
- 代记体温：录 38.5 后页面文本含 38.5 ✓
- `check-fever-rule.mjs` 扩为 **15/15**（新增 F-01/F-02/H-01 六条源码守卫断言，防回归）
- `npm run check` exit=0；`npm test` 4/4；README 9 张截图 md5 全唯一、引用 0 破图
