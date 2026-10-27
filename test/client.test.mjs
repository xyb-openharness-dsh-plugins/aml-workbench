/* 宿主侧入口（lib/client.js）的离线自检。
 *
 * 为什么值得单独测：这个文件**不经过任何打包/编译**，直接丢给宿主 renderer 的
 * `window.__ModuleLoader__.load({id, factory})`。家族里踩过三次：
 *   - 写成原生 ESM（`export default`）→ renderer 报 `Unexpected token 'export'`，
 *     还会触发 plugin-recovery 把整个包移出 profile；
 *   - register 少传 businessSide/businessWidth → 面板宽度按宿主默认，页面被挤成一条；
 *   - customFrame=false → 宿主自己画会话区，顶栏没有 AI 按钮、分栏拖不动（实机反馈）。
 *
 * 做法：给一个假 window + 假 react，把文件当普通脚本 eval 一遍。
 * 注意：这只是**入口契约**自检，不等于在 Desktop 里真的画出来了（那要实机签认）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** 极简 React 替身：createElement 记录 tag/props/children；hooks 用一次性桩。 */
const React = {
  createElement(tag, props, ...children) {
    return { tag, props: props || {}, children };
  },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
  useRef(value) { return { current: value }; },
  useEffect() {},
  useCallback(fn) { return fn; },
};

/** 假 localStorage：client.js 顶层会读一次宽度与草稿队列。 */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function loadClient() {
  let captured = null;
  const sandbox = {
    window: {
      __ModuleLoader__: { load(spec) { captured = spec; } },
      location: { origin: 'http://localhost' },
      addEventListener() {},
      removeEventListener() {},
    },
    localStorage: fakeStorage(),
  };
  const require = (name) => {
    if (name === 'react') return React;
    throw new Error(`client.js 不该 require(${name})——宿主只保证 react 可用`);
  };
  /* eslint-disable no-new-func */
  new Function('window', 'localStorage', 'require', `${SRC}\n`)(sandbox.window, sandbox.localStorage, require);
  return captured;
}

test('① 必须是 ModuleLoader.load({id, factory}) 包装的普通脚本，不能是 ESM', () => {
  assert.equal(/^\s*export\s/m.test(SRC), false, '出现 export 会被 renderer 拒绝');
  assert.equal(/^\s*import\s/m.test(SRC), false, '不能被当成 ESM 解析');
  const spec = loadClient();
  assert.ok(spec, '没有调用 window.__ModuleLoader__.load');
  assert.equal(spec.id, '@xyb-community/aml-workbench');
  assert.equal(typeof spec.factory, 'function');
});

test('② factory 只依赖 react，返回 {apply, inject}，inject 必须带 sessions（会话桥接要用）', () => {
  const spec = loadClient();
  const mod = spec.factory((name) => {
    if (name === 'react') return React;
    throw new Error(`factory 里 require(${name}) 会炸`);
  });
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual(mod.inject, ['desktopWorkbenches', 'sessions']);
});

test('③ register 参数：AML 品牌、仓库、customFrame（left / 0.65 / true）、embedded', () => {
  const spec = loadClient();
  const mod = spec.factory(() => React);
  let registered = null;
  const ctx = {
    effect(fn) { return fn(); },
    desktopWorkbenches: {
      register(meta, Panel) { registered = { meta, Panel }; },
    },
  };
  mod.apply(ctx);
  assert.ok(registered, 'apply 里没有 register');
  assert.match(registered.meta.title, /小橙宝/);
  assert.match(registered.meta.title, /OrangePal/);
  assert.equal(registered.meta.repository, 'https://github.com/xyb-openharness-dsh-plugins/aml-workbench');
  assert.equal(registered.meta.layout.businessSide, 'left');
  assert.equal(registered.meta.layout.businessWidth, 0.65);
  assert.equal(registered.meta.customFrame, true,
    'customFrame=false 时宿主自己画会话区：顶栏没有 AI 按钮、分栏拖不动（实机反馈）');
  assert.equal(registered.meta.embedded, true);
  assert.match(registered.meta.description, /粒缺发热|MRD/, '描述要写本癌种特有的东西，不是通用套话');
  assert.equal(/肢端肥大|GH\/IGF|acromegaly/i.test(JSON.stringify(registered.meta)), false, '不许留底本病种词');
});

test('④ Panel 自绘 header + 业务 iframe + 会话 aside + splitter（不是裸 iframe）', () => {
  const spec = loadClient();
  const mod = spec.factory(() => React);
  let Panel = null;
  mod.apply({
    effect(fn) { return fn(); },
    desktopWorkbenches: { register(meta, P) { Panel = P; } },
  });

  /* 无会话态：也能渲染，且首个子元素必须是 <header>（宿主为 macOS 窗口按钮留了避让变量） */
  const tree = Panel({});
  assert.equal(tree.tag, 'div');
  assert.equal(tree.children[0]?.tag, 'header', '根节点首个子元素必须是语义 <header>');
  assert.match(tree.children[0].props.style.paddingInlineStart, /--dsh-frame-leading-clearance/);

  /* 顶栏右侧必须有 AI 对话按钮 */
  const actions = tree.children[0].children.find((c) => c?.props?.style?.marginLeft === 'auto');
  assert.ok(actions, '顶栏缺少右侧按钮组（margin-left:auto）');
  const labels = actions.children.map((c) => (typeof c === 'string' ? c : c?.children?.join?.('') ?? ''));
  assert.ok(labels.some((t) => /AI 对话/.test(t)), `顶栏没有 AI 对话按钮：${labels.join(' | ')}`);

  /* 业务区是 iframe 指到本包 UI 前缀，不维护第二套 UI */
  const body = tree.children[1];
  const iframe = body.children[0].children[0];
  assert.equal(iframe.tag, 'iframe');
  assert.equal(iframe.props.src, '/api/aml/ui/');

  /* 会话区：无会话时给引导文案，且节点始终在树里（隐藏靠 display，不卸载） */
  const aside = body.children.find((c) => c && c.tag === 'aside');
  assert.equal(aside.tag, 'aside');
  assert.equal(aside.props.style.display, 'none');
  assert.match(JSON.stringify(aside.children), /AI 对话还没开始/);

  /* 有会话时：aside 显示，并出现可拖 splitter（role=separator + aria-valuenow） */
  const live = Panel({ conversation: { tag: 'div', props: {}, children: ['native'] } });
  const liveBody = live.children[1];
  const liveAside = liveBody.children.find((c) => c && c.tag === 'aside');
  assert.equal(liveAside.tag, 'aside', 'aside 必须排在分隔线之后');
  assert.equal(liveAside.props.style.display, 'flex');
  assert.equal(liveAside.props.style.width, '35%', '默认会话宽度应取 AGENT_PANE.def=0.35');
  const splitter = liveBody.children.find((c) => c && c.props && c.props.role === 'separator');
  assert.ok(liveBody.children.indexOf(splitter) < liveBody.children.indexOf(liveAside), '分隔线必须夹在业务区与会话之间');
  assert.equal(splitter?.props?.role, 'separator');
  assert.equal(splitter.props['aria-valuemin'], 25);
  assert.equal(splitter.props['aria-valuemax'], 45);
  assert.equal(splitter.props['aria-valuenow'], 35);
  assert.equal(splitter.props.tabIndex, 0, 'splitter 必须可聚焦，键盘才调得了');
  /* 线条是 1px 绝对定位细线，不占布局宽度；拖动命中靠内部 11px 透明热区 */
  assert.equal(splitter.props.style.position, 'absolute', '分隔线必须绝对定位，不占布局宽度');
  assert.equal(splitter.props.style.width, 1, '分隔线视觉宽度必须是 1px');
  assert.equal(splitter.props.style.right, '35%', '分隔线贴在会话面板边界上');
  const hit = splitter.children.find((c) => c && c.props && c.props.style && c.props.style.width === 11);
  assert.ok(hit, '缺少 11px 拖动热区子元素');
  assert.equal(hit.props.style.left, -5, '热区需左右各溢出 5px');
  assert.equal(hit.props.style.background, 'transparent');
});

test('⑤ 34 号链路的两端在同一个仓里对得上：壳层监听 aml:agent-draft 且校验 event.source', () => {
  assert.match(SRC, /'aml:agent-draft'/, '壳层必须监听 aml:agent-draft（页面发的就是这个）');
  assert.match(SRC, /event\.source\s*!==\s*frame/, '必须校验 event.source，只校 origin 挡不住同源窗口');
  assert.match(SRC, /phase\s*===\s*'plain'/, '自动发送要有 plain 相守卫');
  assert.match(SRC, /\.submit\?\.\(\)|submit\(\)/, '自动发送最终要调 submit');
  /* 占位符必须全被替换（构建脚本漏一个就装不进去）。 */
  assert.equal(/__[A-Z_]+__/.test(SRC), false, `lib/client.js 里还有未替换的占位符：${(SRC.match(/__[A-Z_]+__/g) || []).join(',')}`);
  assert.match(SRC, /请勿手改|由 scripts\/build-client\.mjs/, '产物头要写明来源，防止有人直接改它');
});
