/* 本文件由 scripts/build-client.mjs 从 src/client.js 生成，请勿手改。
 * 改客户端源码请改 src/client.js 后运行 npm run build:client。
 * 包名 @xyb-community/aml-workbench · 仓库 https://github.com/xyb-openharness-dsh-plugins/aml-workbench
 * 面板 customFrame 开关 开 · 业务 left 0.65
 * AI 会话可拖宽度 0.25–0.45（默认 0.35）
 */
/* 客户端入口源码（小橙宝 OrangePal · 急性髓系白血病工作台）。
 *
 * **不要直接改 lib/client.js**：那是 npm run build:client 从本文件生成的产物。
 * 官方要求客户端必须是已构建好的单文件（workbench-standard §3.5），这里用零依赖的
 * 字符串替换注入常量：包名与仓库取自 package.json，面板参数取自 lib/layout.js，
 * 接口前缀取自 dsh/routes.js。参数只有一份来源，避免两边漂移。
 *
 * 面板形态：customFrame 自绘外壳（家族 2026-10-21 实机反馈后统一）。
 * 宿主把原生会话节点作为 conversation prop 交给我们排版：
 * - 顶栏有「AI 对话 / 收起」按钮；splitter 可拖/键盘调（25%–45%，步进 2%）；
 * - 收起只隐藏不结束会话；宽度存 localStorage；容器窄于 760px 改覆盖式抽屉；
 * - 业务区是 iframe（/api/aml/ui/），与独立 dev-server 同一份前端。
 *
 * 三条硬约束（官方 §4 / §6）：
 * 1. 根节点首个子元素必须是语义 <header>，并用 --dsh-frame-leading-clearance 避让
 *    macOS 左上角窗口按钮；
 * 2. 原生会话始终挂载（只用 display 控显隐）——卸载会丢输入框状态；
 * 3. 无会话时业务面板照常可用。
 *
 * 页面发来的 aml:agent-draft 消息（public/app.js 的协议链接）经 postMessage
 * 到这里，填进原生会话并自动发送、开启互动（34 号契约）。
 * 发送的是预写提示词 + 已确认病情上下文，AI 回复仍是候选：核对才入事实层，拒收零副作用。
 * 私密记录不进上下文：public/app.js 的 sharedOnly 过滤在前，这里不做第二套判定。
 */

;(function () {
  // 没有模块加载器就静静退出：这个文件也可能被静态检查脚本扫到，不该在那时抛错。
  if (typeof window === 'undefined' || typeof window.__ModuleLoader__?.load !== 'function') return

  window.__ModuleLoader__.load({
    id: '@xyb-community/aml-workbench',
    factory: (require) => {
      const React = require('react')
      const h = React.createElement

      const UI_ENTRY = '/api/aml/ui/'
      const API_PREFIX = '/api/aml'
      const VERSION = '0.6.5'
      const TITLE = '小橙宝 OrangePal'
      const PANEL_TITLE = '小橙宝急性髓系白血病工作台'
      const SUBTITLE = '本机数据 · 只整理不判定'
      const DESCRIPTION = '把散落的血象、诱导化疗日历、粒缺发热小时级体温、MRD 双口径、移植评估与输注记录整理成可核对、可回溯的资料，并整理成就诊时能带着走的问题清单。'

      /* ---- 面板参数（由 scripts/build-client.mjs 从 lib/layout.js 注入） ---- */
      const BUSINESS_SIDE = 'left'
      const BUSINESS_WIDTH = Number('0.65')
      const CUSTOM_FRAME = true
      const AGENT_DEFAULT = Number('0.35')
      const AGENT_MIN = Number('0.25')
      const AGENT_MAX = Number('0.45')
      const AGENT_STEP = Number('0.02')
      const NARROW_BELOW = Number('760')
      const DRAWER_MAX = Number('420')
      const WIDTH_KEY = 'orange.aml.agent-pane.v1'
      const DRAFT_QUEUE_KEY = 'orange.aml.initial-drafts.v1'

      const clampWidth = (value) => {
        const n = Number(value)
        if (!Number.isFinite(n)) return AGENT_DEFAULT
        return Math.min(AGENT_MAX, Math.max(AGENT_MIN, n))
      }
      /** 对齐到步进，键盘与鼠标落在同一组取值上，避免拖出 33.7% 这种数 */
      const snapWidth = (value) => clampWidth(Math.round(value / AGENT_STEP) * AGENT_STEP)
      const round4 = (n) => Math.round(n * 10000) / 10000

      function loadWidth() {
        try {
          const saved = JSON.parse(localStorage.getItem(WIDTH_KEY) || 'null')
          return clampWidth(saved?.width)
        } catch { return AGENT_DEFAULT }
      }
      function saveWidth(width) {
        try { localStorage.setItem(WIDTH_KEY, JSON.stringify({ width: round4(width) })) } catch { /* 隐私模式忽略 */ }
      }

      /* ---------------- 样式（小橙宝主色 #E8722C 橙系，配 #FDF6F1 底与 #1F6E6B 点缀） ---------------- */

      const rootStyle = {
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0,
        width: '100%', maxWidth: '100%', boxSizing: 'border-box',
        background: '#FDF6F1', fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
      }
      // 首个子元素必须是语义 <header>：宿主为 macOS 窗口按钮预留了 --dsh-frame-leading-clearance。
      // 布局：左侧 = 品牌 + 版本号；右侧 = AI 对话/收起按钮，紧贴右缘；中间说明文字占位。
      const headerStyle = {
        display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto', flexWrap: 'wrap',
        padding: '6px 12px', paddingInlineStart: 'var(--dsh-frame-leading-clearance, 12px)',
        borderBottom: '1px solid #F3E1D3', background: '#FBEEE4', fontSize: 12,
      }
      const brandStyle = {
        display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, color: '#B4531D',
        whiteSpace: 'nowrap', fontSize: 12.5,
      }
      const verStyle = {
        fontWeight: 500, fontSize: 11, color: '#8a6a52', background: '#F7E7DA',
        borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
      }
      const hintStyle = { flex: 1, minWidth: 200, color: '#9c8674', fontSize: 11.5 }
      const headerActionsStyle = {
        display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', marginLeft: 'auto',
      }
      const bodyStyle = { position: 'relative', display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }
      const businessStyle = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }
      const frameStyle = { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, display: 'block' }
      const paneStyle = {
        display: 'flex', flexDirection: 'column', flex: '0 0 auto', minWidth: 0, minHeight: 0,
        borderLeft: '1px solid #F3E1D3', background: '#fff', overflow: 'hidden',
      }
      const drawerStyle = {
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 3,
        boxShadow: '-8px 0 24px rgba(232, 114, 44, 0.16)',
      }
      const splitterStyle = {
        position: 'absolute', top: 0, bottom: 0, width: 1, marginRight: -0.5,
        zIndex: 2, background: '#F3E1D3', cursor: 'col-resize', touchAction: 'none',
        transition: 'background .15s ease, box-shadow .15s ease',
      }

      /* 分隔线（全家族统一行为）：悬停显示本工作台同色系品牌色 + 发光把手；按住左右拖动调 AI 面板宽度 */
      const SPLITTER_BRAND = '#B4531D'
      const splitterRgba = (hex, alpha) => {
        const n = parseInt(String(hex).replace('#', ''), 16)
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
      const splitterHoverStyle = {
        ...splitterStyle,
        background: SPLITTER_BRAND,
        boxShadow: `0 0 6px ${splitterRgba(SPLITTER_BRAND, 0.55)}`,
      }
      const splitterDragStyle = {
        ...splitterHoverStyle,
        boxShadow: `0 0 10px ${splitterRgba(SPLITTER_BRAND, 0.8)}`,
      }
      const splitterHitStyle = {
        position: 'absolute', top: 0, bottom: 0, left: -5, width: 11,
        background: 'transparent', cursor: 'col-resize',
      }
      const splitterGripStyle = {
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 14, height: 22, borderRadius: 4, background: SPLITTER_BRAND,
        color: '#fff', fontSize: 11, lineHeight: '22px', letterSpacing: '-1px', textAlign: 'center',
        opacity: 0.95, pointerEvents: 'none', userSelect: 'none',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
      }
      const dragShieldStyle = {
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 4,
        cursor: 'col-resize', background: 'transparent', touchAction: 'none',
      }
      const fallbackStyle = { padding: 24, color: '#B4531D', fontSize: 14, lineHeight: 1.7 }
      const buttonStyle = {
        border: 0, borderRadius: 999, padding: '5px 14px', whiteSpace: 'nowrap',
        background: '#E8722C', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer',
      }
      const ghostStyle = { ...buttonStyle, background: 'transparent', color: '#B4531D', border: '1px solid #EFD8C6' }
      const padStyle = {
        display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
        padding: 20, color: '#8a6a52', fontSize: 12.5, lineHeight: 1.75,
      }

      function Fallback({ onRetry }) {
        return h('div', { style: fallbackStyle },
          h('p', null, `页面没能加载（v${VERSION} · ${UI_ENTRY}）。常见原因是 Harness 刚重启、插件还没加载完。`),
          h('p', null, '本工作台的数据只存在你选择的本机目录里，不会因为这个提示丢失。'),
          h('button', { type: 'button', style: buttonStyle, onClick: onRetry }, '重新加载'),
        )
      }

      /* ---------------- 会话判定（官方 dsh-site-selection 同款） ---------------- */

      let bridge = null
      function currentSession() {
        const service = bridge?.desktopWorkbenches
        if (typeof service?.currentSession === 'function') return service.currentSession() || null
        const snapshot = bridge?.sessions?.list?.getSnapshot?.()
        return snapshot?.current || Object.keys(snapshot?.byId || {}).find((id) =>
          (snapshot.byId[id]?.retainedBy?.mainView ?? 0) > 0) || null
      }
      function workbenchOwnsSession(sessionId) {
        if (!sessionId) return false
        const service = bridge?.desktopWorkbenches
        if (typeof service?.ownsSession === 'function') return service.ownsSession(sessionId)
        return false
      }
      function ownedSession() {
        const id = currentSession()
        return workbenchOwnsSession(id) ? id : null
      }

      /* 会话创建：优先默认工作区；无可用工作区时传 undefined，让宿主按其流程提示选目录。
         不要用 ensureSession({})：customFrame 下它不保证归属，也不会自动挂载面板。 */
      async function createOwnedSession() {
        const service = bridge?.desktopWorkbenches
        let workspaceId
        try { workspaceId = service?.defaultWorkspace?.()?.workspaceId } catch { workspaceId = undefined }
        return service.newSession(workspaceId)
      }

      /* ---------------- 原生草稿：填入，并按需自动发送 ---------------- */

      function fillDraft(sessionId, prompt, autoSend) {
        if (!sessionId || ownedSession() !== sessionId) throw new Error('会话已切换，请回到本工作台再操作')
        const actx = bridge.sessions.scope?.(sessionId)
        const conversation = actx?.get?.('conversation')
        if (!conversation) throw new Error('对话输入不可用')
        const input = conversation.input.for(actx)
        const snapshot = input.state.getSnapshot()
        if (snapshot.occurrences?.length || (snapshot.phase && snapshot.phase !== 'plain')) {
          throw new Error('当前草稿含引用或特殊输入，请先在原生会话里处理，再交给小橙宝')
        }
        const current = snapshot.draft || ''
        input.setDraft(current.trim() ? `${current}\n\n${prompt}` : prompt)
        // 自动发送（34 号）：仅 plain 相、草稿非空时提交；submit 自带守卫，失败则草稿保留待手动发送
        if (autoSend) {
          try {
            const fresh = input.state.getSnapshot()
            if (fresh.phase === 'plain' && (fresh.draft || '').trim()) input.submit?.()
          } catch { /* 提交面未就绪：草稿已填好，留给患者按回车 */ }
        }
      }

      let pendingDraft = null // { sessionId, prompt, send? }
      try {
        const saved = JSON.parse(localStorage.getItem(DRAFT_QUEUE_KEY) || 'null')
        if (saved?.sessionId && saved?.prompt) pendingDraft = saved
      } catch { /* 隐私模式忽略 */ }
      function rememberDraft(entry) {
        pendingDraft = entry
        try {
          if (entry) localStorage.setItem(DRAFT_QUEUE_KEY, JSON.stringify(entry))
          else localStorage.removeItem(DRAFT_QUEUE_KEY)
        } catch { /* 隐私模式忽略 */ }
      }
      function flushDraft() {
        if (!pendingDraft) return false
        try {
          fillDraft(pendingDraft.sessionId, pendingDraft.prompt, pendingDraft.send === true)
          rememberDraft(null)
          return true
        } catch { return false // composer 未就绪就留给下一轮
        }
      }

      function onboardingPrompt(dir) {
        return [
          '你正在协助我使用「小橙宝 OrangePal 急性髓系白血病工作台」。它只做本机资料整理，不提供诊疗建议。',
          `资料目录：${dir || '（首次打开时在面板里选择）'}`,
          '里面是我的血象、诱导/巩固化疗日历、粒缺发热小时级体温与抗生素时点、MRD 双口径结果、移植评估与供者登记、输注与黏膜炎记录、就诊问题清单。',
          '分工：你帮我汇总、找缺漏、把报告里的数值和日期整理成对照表（数值照抄、单位随报告原文）；判断和决定由我和血液科团队做。',
          '我标记的"看法"是我自己的担心或判断，不是医生结论；私密记录默认不进上下文。',
        ].join('\n')
      }

      /* ---------------- 面板（customFrame） ---------------- */

      function Panel({ conversation }) {
        const [generation, setGeneration] = React.useState(0)
        const [broken, setBroken] = React.useState(false)
        const [note, setNote] = React.useState('')
        const [width, setWidth] = React.useState(loadWidth)
        const [paneOpen, setPaneOpen] = React.useState(true)
        const [connecting, setConnecting] = React.useState(false)
        const [narrow, setNarrow] = React.useState(false)
        const [dragging, setDragging] = React.useState(false)
        const [hovering, setHovering] = React.useState(false)

        const brokenTimer = React.useRef(null)
        const shellRef = React.useRef(null)
        const dragHostRef = React.useRef(null)
        const frameRef = React.useRef(null)

        const [paneTick, setPaneTick] = React.useState(0)
        /* 会话归属只问宿主：ownedSession() = ownsSession(currentSession())。
           不要用 Boolean(conversation)——customFrame 下没会话也会传隐藏容器，判断恒为真。 */
        const activeSession = React.useMemo(() => ownedSession(), [paneTick]) // eslint-disable-line react-hooks/exhaustive-deps
        const hasConversation = Boolean(activeSession) // pane-contract-allow: 反例说明见上
        const canOpenSession = typeof bridge?.desktopWorkbenches?.newSession === 'function'

        // 8 秒内没有 onLoad 就当作没起来：宁可给一个能重试的提示，也不留一块白板。
        // onLoad 成功后必须清掉这个定时器——否则页面加载完 8 秒后整个面板被换成兜底页。
        React.useEffect(() => {
          setBroken(false)
          brokenTimer.current = setTimeout(() => setBroken(true), 8000)
          return () => clearTimeout(brokenTimer.current)
        }, [generation])

        // 挂载后开始消化未送达的开场白（composer 就绪一轮一次），并订阅会话变化。
        React.useEffect(() => {
          const timer = setInterval(() => { if (flushDraft()) setNote('草稿已填入会话，按回车发送') }, 500)
          const unsubscribe = bridge?.desktopWorkbenches?.subscribe?.(() => { setNote(''); setPaneTick((n) => n + 1) })
          return () => { clearInterval(timer); unsubscribe?.() }
        }, [])

        // 窄屏判定用**容器宽度**而不是窗口宽度：宿主主区宽度不等于窗口宽度（合同 §3 基线）。
        React.useEffect(() => {
          const host = shellRef.current
          if (!host || typeof ResizeObserver !== 'function') return undefined
          const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width ?? 0
            setNarrow(w > 0 && w < NARROW_BELOW)
          })
          observer.observe(host)
          return () => observer.disconnect()
        }, [])

        const applyWidth = React.useCallback((next) => {
          const snapped = round4(snapWidth(next))
          setWidth(snapped)
          saveWidth(snapped)
        }, [])

        /* ---- splitter：鼠标/触控拖动 ---- */

        const stopDrag = React.useCallback(() => {
          dragHostRef.current = null
          setDragging(false)
        }, [])

        React.useEffect(() => {
          if (!dragging) return undefined
          const onMove = (event) => {
            const host = dragHostRef.current
            if (!host) return
            const rect = host.getBoundingClientRect()
            if (!rect.width) return
            // 会话在右侧：指针越靠左，会话越宽
            applyWidth((rect.right - event.clientX) / rect.width)
          }
          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', stopDrag)
          document.addEventListener('pointercancel', stopDrag)
          return () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', stopDrag)
            document.removeEventListener('pointercancel', stopDrag)
          }
        }, [dragging, applyWidth, stopDrag])

        const onSplitterPointerDown = (event) => {
          event.preventDefault()
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 旧宿主无指针捕获：document 监听仍可拖动 */ }
          dragHostRef.current = shellRef.current
          setDragging(true)
        }

        const onSplitterKeyDown = (event) => {
          const delta = { ArrowLeft: AGENT_STEP, ArrowRight: -AGENT_STEP }[event.key] // 会话在右：← 变宽
          if (delta !== undefined) { event.preventDefault(); applyWidth(width + delta); return }
          if (event.key === 'Home') { event.preventDefault(); applyWidth(AGENT_MAX); return }
          if (event.key === 'End') { event.preventDefault(); applyWidth(AGENT_MIN) }
        }

        /* ---- 打开 / 收起 AI 对话 ---- */

        async function openAgent(prompt = null) {
          setNote('')
          if (!canOpenSession) {
            setNote('当前 Desktop 版本不支持从面板调起会话；请从左侧会话列表新建会话')
            return
          }
          setConnecting(true)
          try {
            let dir = null
            try {
              const res = await fetch(`${API_PREFIX}/health`)
              dir = (await res.json())?.dir || null
            } catch { /* 拿不到目录也照样调起 */ }
            const id = await createOwnedSession()
                        if (!id) {
              setNote('已取消资料目录选择，没有创建会话。可以再次点击「AI 对话」重试。')
              return
            }
rememberDraft({ sessionId: id, prompt: prompt || onboardingPrompt(dir) })
            flushDraft()
            setPaneOpen(true)
            setNote('会话已就绪：草稿已填入右侧输入框，按回车发送')
          } catch (error) {
            setNote(`没能调起会话：${error?.message ?? error}`)
          } finally {
            setConnecting(false)
          }
        }

        // 收起只是隐藏，不是关闭/删除会话：再点「打开 AI 对话」回到同一个会话。
        function onAgentClick() {
          if (!hasConversation) { void openAgent(); return }
          setPaneOpen((open) => !open)
          setNote('')
        }

        /* ---- 页面发来的「AI 协助」：填入并自动发送，开启互动（34 号） ---- */

        async function deliverContext(prompt, send) {
          const id = ownedSession()
          if (id) {
            rememberDraft({ sessionId: id, prompt, send: send === true })
            setPaneOpen(true)
            // flushDraft 失败说明 composer 还没就绪：草稿留在队列里，500ms 轮询会重试（就绪后同样自动发送）。
            setNote(flushDraft()
              ? (send ? '已发送到 AI 对话，可继续互动' : '已填入会话草稿，按回车发送')
              : '会话输入框还没就绪；内容已暂存，就绪后自动发送')
            return
          }
          setNote('正在为你调起 AI 会话…')
          await openAgent(prompt)
        }

        // handler 每轮都换成最新的闭包，effect 只注册一次：
        // 直接在 effect 里闭包 deliverContext 会拿到首帧的 state（会话 ID 已经变了也不自知）。
        const deliverRef = React.useRef(null)
        React.useEffect(() => { deliverRef.current = deliverContext })
        React.useEffect(() => {
          function onMessage(event) {
            const data = event.data
            if (!data || typeof data !== 'object' || data.type !== 'aml:agent-draft') return
            const frame = frameRef.current
            // 不认"谁都能发"的消息：必须来自我们自己的 iframe，且同源。
            if (!frame || event.source !== frame.contentWindow) return
            if (event.origin !== window.location.origin) return
            const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : ''
            if (!prompt) return
            void deliverRef.current?.(prompt.slice(0, 8000), data.send === true)
          }
          window.addEventListener('message', onMessage)
          return () => window.removeEventListener('message', onMessage)
        }, [])

        const agentLabel = !canOpenSession
          ? 'AI 对话暂不可用'
          : connecting ? '正在连接…'
            : !hasConversation ? 'AI 对话'
              : paneOpen ? '收起 AI 对话' : '打开 AI 对话'

        if (broken) return h(Fallback, { onRetry: () => setGeneration((n) => n + 1) })

        const percent = Math.round(width * 100)
        const paneVisible = paneOpen && (hasConversation || connecting)

        return h('div', { style: rootStyle },
          h('header', { style: headerStyle },
            h('span', { style: brandStyle }, `🍊 ${TITLE}`),
            h('span', { style: verStyle }, `v${VERSION}`),
            h('span', { style: hintStyle },
              hasConversation
                ? '右侧是 DSH 原生会话：可拖中间分隔边调整宽度（25%–45%），收起不会结束会话。'
                : '还没有会话。点右侧「AI 对话」调起原生会话，开场白只填进草稿，不自动发送。'),
            h('div', { style: headerActionsStyle },
              h('button', {
                type: 'button',
                style: buttonStyle,
                onClick: onAgentClick,
                disabled: connecting || !canOpenSession,
                'aria-label': `AI 对话：${agentLabel}`,
              }, agentLabel),
              // 会话已绑定时给一个明确的收起控件，不把关闭藏在面板内部（合同 §1）
              hasConversation && paneOpen && h('button', {
                type: 'button', style: ghostStyle, onClick: () => setPaneOpen(false),
                'aria-label': '收起 AI 对话面板',
              }, '×'),
              note && h('span', { style: { color: '#B4531D', fontWeight: 600 } }, note),
            ),
          ),
          h('div', { ref: shellRef, style: bodyStyle },
            h('div', { style: businessStyle },
              h('iframe', {
                key: generation,
                ref: frameRef,
                src: UI_ENTRY,
                title: `${TITLE} · ${SUBTITLE}`,
                style: frameStyle,
                sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads',
                onLoad: () => { setBroken(false); clearTimeout(brokenTimer.current) },
              }),
            ),
            // splitter 只在宽屏出现：窄屏是覆盖式抽屉，拖宽没有意义
            !narrow && paneVisible && h('div', {
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': '调整 AI 对话面板宽度',
              'aria-valuemin': Math.round(AGENT_MIN * 100),
              'aria-valuemax': Math.round(AGENT_MAX * 100),
              'aria-valuenow': percent,
              tabIndex: 0,
              style: {
                ...(dragging ? splitterDragStyle : hovering ? splitterHoverStyle : splitterStyle),
                right: `${percent}%`,
              },
              onPointerDown: onSplitterPointerDown,
              onPointerEnter: () => setHovering(true),
              onPointerLeave: () => setHovering(false),
              onKeyDown: onSplitterKeyDown,
            },
              h('span', { style: splitterHitStyle, 'aria-hidden': 'true' }),
              (hovering || dragging) ? h('span', { style: splitterGripStyle, 'aria-hidden': 'true' }, '⠿') : null),
            // 原生会话**始终挂载**：卸载会丢掉输入框与草稿状态（宿主明确要求不重挂输入树），
            // 所以隐藏走 display，不卸载组件。
            h('aside', {
              style: {
                ...paneStyle,
                ...(narrow ? drawerStyle : null),
                width: narrow ? `min(92%, ${DRAWER_MAX}px)` : `${percent}%`,
                display: paneVisible ? 'flex' : 'none',
              },
              'aria-label': 'AI 对话',
              'aria-hidden': paneVisible ? undefined : 'true',
            }, conversation ?? h('div', { style: padStyle },
              h('b', null, 'AI 对话还没开始'),
              h('span', null, '点顶栏「AI 对话」调起 DSH 原生会话后，它会固定出现在这一侧。'),
              h('span', null, '没有会话也不影响记录：左侧的日历、体温轨道、MRD 与就诊准备照常可用。'),
            )),
            // 拖动时铺一层透明遮罩：指针一旦掠到业务 iframe 上，指针事件就归子文档，
            // document 上的监听收不到；遮罩让整个面板都成为我们的命中区。
            dragging && !narrow && h('div', { 'aria-hidden': 'true', style: dragShieldStyle }),
          ),
        )
      }

      function apply(ctx) {
        bridge = ctx
        ctx.effect(() => ctx.desktopWorkbenches.register({
          title: TITLE,
          panelTitle: PANEL_TITLE,
          icon: '🍊',
          repository: 'https://github.com/xyb-openharness-dsh-plugins/aml-workbench',
          description: DESCRIPTION,
          audience: '急性髓系白血病患者与照护者',
          requirements: '本机数据整理；不做判读与处置建议，判断由用户与血液科团队做出。',
          initialization: 'empty',
          embedded: true,
          version: VERSION,
          author: '小橙宝 OrangePal 社区贡献者',
          // 下面三个值由 scripts/build-client.mjs 从 lib/layout.js 注入，不在这里手写第二份
          layout: { businessSide: BUSINESS_SIDE, businessWidth: BUSINESS_WIDTH },
          customFrame: CUSTOM_FRAME,
        }, Panel))
      }

      return { apply, inject: ['desktopWorkbenches', 'sessions'] }
    },
  })
})()
