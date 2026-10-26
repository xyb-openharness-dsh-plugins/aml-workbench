/**
 * 极简 CDP 客户端（零依赖：Node 22 自带 WebSocket + fetch）。
 * 供 test/ui-parity.test.mjs、scripts/check-hvt.mjs、scripts/probe-headless.mjs 共用。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiters = new Map();
    this.errors = [];
    this.badResponses = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiters.has(msg.id)) {
        const { resolve: ok, reject: bad } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        if (msg.error) bad(new Error(msg.error.message));
        else ok(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        const where = d.stackTrace?.callFrames?.[0]
          ? `${d.stackTrace.callFrames[0].url}:${d.stackTrace.callFrames[0].lineNumber + 1}`
          : d.url ?? '';
        this.errors.push([d.exception?.description || d.text || 'exception', where].filter(Boolean).join(' @ '));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      } else if (msg.method === 'Network.loadingFailed') {
        this.badResponses.push(`${msg.params.errorText} ${msg.params.blockedReason ?? ''}`.trim());
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((ok, bad) => {
      this.waiters.set(id, { resolve: ok, reject: bad });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error(`evaluate 失败：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
}

export async function launchChrome({ port, userDataPrefix = '.xyb-mpm-chrome-' } = {}) {
  if (!existsSync(CHROME)) {
    throw new Error(`找不到 Chrome：${CHROME}（可用 CHROME_PATH 指定）`);
  }
  const userDataDir = mkdtempSync(join(homedir(), userDataPrefix));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-software-rasterizer', `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null;
    } catch { /* 还没起来 */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) {
    chrome.kill();
    throw new Error('Chrome 调试端口未就绪');
  }
  const sock = new WebSocket(wsUrl);
  await new Promise((ok, bad) => {
    sock.addEventListener('open', ok, { once: true });
    sock.addEventListener('error', bad, { once: true });
  });
  const cdp = new CDP(sock);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  try {
    await cdp.send('Network.enable');
  } catch { /* 可选 */ }
  return { chrome, cdp, sock, userDataDir };
}

export async function stopChrome({ chrome, sock, userDataDir }) {
  try { sock?.close(); } catch { /* ignore */ }
  chrome?.kill();
  await sleep(200);
}
