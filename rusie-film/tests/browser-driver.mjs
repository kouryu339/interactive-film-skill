import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bundle } from '../scripts/project.mjs';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function browserExecutable() {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const filename of candidates) { try { if ((await fs.stat(filename)).isFile()) return filename; } catch {} }
  throw new Error('Chrome/Chromium not found. Set CHROME_BINARY to your browser executable.');
}
export async function launchBrowser(temporary) {
  const binary = await browserExecutable();
  const child = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket, next = 0, session; const pending = new Map(), contexts = new Map(), listeners = new Map(); const exceptions = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 2000); }); }
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = ''; const timer = setTimeout(() => reject(new Error('Browser startup: ' + stderr.slice(-1000))), 20000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('Browser exited ' + code + ': ' + stderr.slice(-1000))); });
      child.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method) for (const listener of listeners.get(message.method) || []) listener(message.params);
      if (message.id) { const item = pending.get(message.id); if (item) { pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); } }
      else if (message.method === 'Target.attachedToTarget') {
        const childSession = message.params.sessionId;
        void send('Runtime.enable', {}, childSession).catch(() => {});
        void send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, childSession).catch(() => {});
      }
      else if (message.method === 'Runtime.executionContextCreated') { const context = message.params.context; if (context.auxData?.isDefault) contexts.set(context.auxData.frameId, { id: context.id, session: message.sessionId }); }
      else if (message.method === 'Runtime.executionContextsCleared') { for (const [frame, context] of contexts) if (context.session === message.sessionId) contexts.delete(frame); }
      else if (message.method === 'Runtime.executionContextDestroyed') for (const [frame, context] of contexts) if (context.session === message.sessionId && context.id === message.params.executionContextId) contexts.delete(frame);
      else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
      else if (message.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId);
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
    await send('Page.enable', {}, session); await send('Runtime.enable', {}, session);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    async function evaluate(expression, frame) {
      if (frame && !contexts.has(frame)) throw new Error('No current execution context for frame ' + frame);
      const context = frame ? contexts.get(frame) : undefined;
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true, ...(context ? { contextId: context.id } : {}) }, context?.session || session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
    }
    async function waitFor(expression, label, frame, timeout = 12000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression, frame)) return; await delay(100); } throw new Error('Browser check timed out: ' + label);
    }
    return {
      binary, exceptions, close, evaluate, waitFor,
      on(method, listener) { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(listener); return () => listeners.get(method)?.delete(listener); },
      send: (method, params) => send(method, params, session),
      navigate: async url => { await send('Page.navigate', { url }, session); },
      async frames() { return (await send('Page.getFrameTree', {}, session)).frameTree; },
      async componentFrame() {
        const until = Date.now() + 10000;
        while (Date.now() < until) {
          for (const frame of contexts.keys()) { try { if (await evaluate(`location.pathname.startsWith('/components/')`, frame)) return frame; } catch {} }
          await delay(100);
        }
        throw new Error('Component browsing context not available');
      },
      async screenshot(name) { const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session); await fs.writeFile(path.join(bundle, '.test-output', name), Buffer.from(image.data, 'base64')); }
    };
  } catch (error) { await close(); throw error; }
}
