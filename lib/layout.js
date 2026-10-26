/* 面板布局参数。
 *
 * 这里是 DSH 分栏合同的**唯一入参来源**：客户端 register、构建注入（scripts/build-client.mjs）
 * 与包级检查都读它。别处不许再写一份 0.65（也别写它的补数 0.35）——以前面板参数散在
 * client.js 与构建脚本里，改一处漏一处，最后连"业务区到底多宽"都要靠截图量。
 *
 * ## 为什么从「标准分栏」改成 customFrame（2026-10-21 实机反馈）
 *
 * 0.1.0 发布时装的是 customFrame=false（标准分栏）。装进 Desktop 后用户截图反馈：
 * 业务区被拉满整幅、顶栏没有 AI 对话按钮、右侧会话区宽度不可调。原因不是漏接服务：
 * 标准分栏下宿主 `packages/dsh-desktop-workbenches/client.js` 只把
 * `--workbench-business-width` 写成注册时的静态值，
 *
 *   h('div', { className:'dshWbBody', hidden: customFrame,
 *     style: { '--workbench-business-width': `${entry.layout.businessWidth * 100}%` } })
 *
 * 服务只暴露 register/isActive/ownsSession/add/open/home/ensureSession/currentSession/
 * subscribe，**没有**拖宽或关闭面板的编程接口。所以"没有 AI 按钮、分栏拖不动"在那条路上
 * 根本不存在，只能换形态。
 *
 * customFrame=true 时宿主改走另一条分支：
 *
 *   h(item.Component, { service, entry, active,
 *     conversation: <原生会话挂载点> })
 *
 * 宿主把**原生会话节点**作为 `conversation` prop 交给我们排版，于是顶栏 AI 按钮、
 * splitter 拖动/键盘调整、收起重开、宽度记忆都由工作台自己实现。这与乳腺癌工作台
 * （pinkypal 0.10.0）以及 starter `docs/20-AGENT-PANE-DESIGN.md` 的基线一致。
 *
 * 代价（官方 §4 / §6 要求，已在 lib/client.js 里逐条处理）：
 * 1. 无会话态要自己引导（宿主不再给 .dshWbInit 引导）；
 * 2. macOS 收起侧栏时窗口按钮占左上角：根节点首个子元素必须是语义 `<header>`，
 *    并用 `--dsh-frame-leading-clearance` 避让；
 * 3. 一切布局、弹层、拖拽都必须留在宿主分配的主内容区内。
 *
 * 取值的两条理由（不变）：
 * 1. businessSide=left：业务区在左、宿主原生会话在右，与 v0.2 原型的信息层级一致；
 * 2. businessWidth=0.65：v0.2 原型的 34 个视图是在 1440×65% ≈ 936px 的宽度下量出来的，
 *    0.7 会把会话区压到 30% 以下（家族规范判为不合格），0.6 以下则会让原型里的
 *    三栏卡片提前换行。customFrame 下这个数记的是**默认业务区宽度**，与 AGENT_PANE.def 互补。
 */

/**
 * 宿主面板参数（写进客户端 register 时逐字使用）。
 * 宿主强校验：businessSide ∈ left/right，businessWidth ∈ 0.25–0.7，越界直接抛错。
 */
export const PANEL = Object.freeze({
  businessSide: 'left',
  businessWidth: 0.65,
  customFrame: true,
});

/** 宿主允许的 businessWidth 区间（源码 client.js 强校验，越界直接抛错） */
export const HOST_LIMITS = Object.freeze({ min: 0.25, max: 0.7 });

/**
 * AI 会话面板的宽度档位（客户端拖动/键盘/预设共用这一份，客户端不留第二份数字）。
 *
 * 单位是「占工作区宽度的比例」，区间 25%–45% 取自 20-AGENT-PANE-DESIGN §2 的
 * customFrame 基线：更窄读不了消息，更宽会把业务区压到 55% 以下、三栏卡片提前换行。
 * `step` 是键盘 ←/→ 的像素步进（给人看的档位说明），`ratioStep` 是实际参与计算的
 * 比例步进——两者都留着，避免"文档说 24px、代码按 2% 跳"这种对不上账的情况。
 */
export const AGENT_PANE = Object.freeze({
  def: 0.35,
  default: 0.35,                              // 与 def 同值；新代码统一读 default
  min: 0.25,
  max: 0.45,
  step: 24,                                   // 键盘 ←/→ 每次步进的像素
  ratioStep: 0.02,                            // 键盘/鼠标共用的比例步进
  narrowBelowPx: 760,                         // 容器窄于此改覆盖式抽屉
  drawerMaxPx: 420,                           // 抽屉最大宽度
  presets: Object.freeze({ narrow: 0.25, std: 0.35, wide: 0.45 }),
});

/** 把比例夹到 AGENT_PANE 区间；非数字一律回默认值。 */
export function clampAgentRatio(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r)) return AGENT_PANE.def;
  return Math.min(AGENT_PANE.max, Math.max(AGENT_PANE.min, r));
}

/** 业务区像素宽度：宿主给的比例 × 窗口宽度。1440 → 936，1280 → 832。 */
export function businessPanePx(windowWidth, width = PANEL.businessWidth) {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) throw new TypeError('windowWidth 必须是正数');
  const ratio = width === undefined ? PANEL.businessWidth : width;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new TypeError('width 必须是正数');
  return Math.round(windowWidth * ratio);
}

/**
 * 自检：返回问题清单，空数组表示合法。参数可注入，便于单测覆盖越界情形。
 * 只查宿主真正会校验的那几项，外加 AGENT_PANE 自己的区间——
 * 多查一条，就多一处"代码说不行、宿主说行"的漂移。
 */
export function assertPanelConfig(config = PANEL, agent = AGENT_PANE) {
  const problems = [];
  if (!config || typeof config !== 'object') return ['面板配置必须是对象'];

  if (!['left', 'right'].includes(config.businessSide)) {
    problems.push(`businessSide 只能是 left/right，当前 ${config.businessSide}`);
  }
  if (typeof config.customFrame !== 'boolean') {
    problems.push(`customFrame 必须是布尔值，当前 ${config.customFrame}`);
  }

  const w = config.businessWidth;
  if (!(typeof w === 'number' && Number.isFinite(w) && w >= HOST_LIMITS.min && w <= HOST_LIMITS.max)) {
    problems.push(`businessWidth 必须在 ${HOST_LIMITS.min}–${HOST_LIMITS.max} 之间，当前 ${w}`);
  } else if (w === HOST_LIMITS.max) {
    problems.push(`businessWidth 不得取上限 0.7：贴到上限会把会话区压到 0.3 以下，本项目不这么做`);
  }

  if (agent && typeof agent === 'object') {
    const { def, min, max, ratioStep } = agent;
    for (const [name, value] of Object.entries({ def, min, max, ratioStep })) {
      if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        problems.push(`AGENT_PANE.${name} 必须是正数，当前 ${value}`);
      }
    }
    if (typeof min === 'number' && typeof max === 'number' && min >= max) {
      problems.push(`AGENT_PANE.min(${min}) 必须小于 max(${max})`);
    }
    if (typeof def === 'number' && typeof min === 'number' && typeof max === 'number' && (def < min || def > max)) {
      problems.push(`AGENT_PANE.def(${def}) 必须落在 ${min}–${max} 区间内`);
    }
    if (typeof max === 'number' && max > HOST_LIMITS.max) {
      problems.push(`AGENT_PANE.max(${max}) 不得大于宿主上限 ${HOST_LIMITS.max}`);
    }
  }
  return problems;
}
