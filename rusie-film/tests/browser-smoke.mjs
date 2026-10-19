// Optional real-Chromium integration check. Uses only Node built-ins and an installed browser.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { bundle, readProject, saveProject, exportProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { browserExecutable } from './browser-driver.mjs';

const output = path.join(bundle, '.test-output'); await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'rusie-browser-'));
const root = path.join(temporary, 'project'); await fs.cp(path.join(bundle, 'tests/fixtures/film'), root, { recursive: true, filter: source => !source.includes(path.sep + 'exports') });
const browser = await browserExecutable();
const running = await startServer(await fs.realpath(root));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket; let next = 0; const pending = new Map(); const errors = []; const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
let session;
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
};
async function waitFor(expression, label, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error('Browser check timed out: ' + label);
}
async function screenshot(name) { const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session); await fs.writeFile(path.join(output, name), Buffer.from(shot.data, 'base64')); }
async function playIfNeeded(prefix = '') {
  await waitFor(`${prefix}document.querySelector('video')?.readyState >= 2`, 'video decoded');
  await evaluate(`{ const d=${prefix}document; if(!d.getElementById('media-gate').hidden) d.getElementById('resume').click(); }`);
  await waitFor(`${prefix}document.querySelectorAll('#choices button').length === 2`, 'choices after real video end');
}
try {
  const websocketURL = await new Promise((resolve, reject) => {
    let stderr = ''; const timeout = setTimeout(() => reject(new Error('Browser did not start: ' + stderr.slice(-1500))), 20000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error('Browser exited ' + code + ': ' + stderr.slice(-1500))); });
    child.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(websocketURL);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId);
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await send('Page.enable', {}, session); await send('Runtime.enable', {}, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await send('Page.navigate', { url: running.url }, session);
  await waitFor(`document.getElementById('work-title')?.textContent === '港口来信' && document.querySelectorAll('.node-card').length === 5`, 'editor ready');
  await screenshot('editor-desktop.png'); checks.push('desktop editor renders five connected scenes');
  await evaluate(`document.querySelector('[data-tab="media"]').click()`);
  const documentNode = await send('DOM.getDocument', {}, session);
  const uploadNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#upload' }, session);
  await send('DOM.setFileInputFiles', { nodeId: uploadNode.nodeId, files: [path.join(root, 'assets/sample-1.mp4')] }, session);
  await waitFor(`document.getElementById('asset-count').textContent==='4' && !document.querySelector('main').inert`, 'MP4 UI upload');
  assert.equal((await readProject(root)).story.assets.length, 4); checks.push('MP4 upload copies and registers a real video through editor');
  await evaluate(`document.querySelector('[data-tab="settings"]').click();document.getElementById('add-variable').click()`);
  await waitFor(`document.querySelectorAll('.variable-row').length===2`, 'variable editor');
  await evaluate(`document.querySelector('[data-tab="story"]').click()`);
  await evaluate(`{const input=document.querySelector('#inspector .field input');input.value='01 · 浏览器保存验证';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('save').click();}`);
  await waitFor(`document.getElementById('save-state').textContent==='已保存到本地'`, 'save complete');
  assert.equal((await readProject(root)).story.nodes[0].title, '01 · 浏览器保存验证'); checks.push('editor save persists in shared project file');
  assert.equal((await readProject(root)).story.variables.flag1, false); checks.push('variable editor persists typed initial state');
  await evaluate(`document.getElementById('preview').click()`);
  await waitFor(`document.getElementById('preview-frame').contentDocument?.querySelector('video') !== null && !!document.getElementById('preview-frame').contentDocument?.getElementById('resume')`, 'preview ready');
  const frame = `document.getElementById('preview-frame').contentWindow.`;
  await playIfNeeded(frame); checks.push('MP4 decoded and reached choices in editor preview');
  await evaluate(`${frame}document.querySelector('#choices button').click()`); await playIfNeeded(frame);
  await evaluate(`${frame}document.querySelector('#choices button').click()`);
  await waitFor(`${frame}document.getElementById('node-title').textContent==='结局 · 灯塔仍亮着'`, 'preview ending'); checks.push('preview completes branching path to ending');
  await screenshot('editor-preview.png'); await evaluate(`document.getElementById('close-preview').click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
  await screenshot('editor-mobile.png');
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true); checks.push('390px editor has no page overflow');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`{const input=document.querySelector('#inspector .field input');input.value='未保存的网页草稿';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  let loaded = await readProject(root); loaded.story.title = 'AI 更新的作品名'; await saveProject(root, loaded.story, loaded.revision);
  await waitFor(`!document.getElementById('connection').hidden`, 'external-write conflict banner', 12000);
  assert.equal(await evaluate(`document.querySelector('#inspector .field input').value`), '未保存的网页草稿'); checks.push('external AI write does not overwrite unsaved editor draft');
  await evaluate(`document.getElementById('reload').click()`);
  await waitFor(`document.getElementById('work-title').textContent==='AI 更新的作品名' && document.getElementById('connection').hidden`, 'reload latest after conflict');
  await evaluate(`document.getElementById('export').click()`);
  await waitFor(`document.getElementById('issues-dialog').open && document.getElementById('issues').textContent.includes('作品已导出')`, 'UI export'); checks.push('editor exports work directory');
  const exported = await exportProject(root, path.join(temporary, 'standalone'));
  await send('Page.navigate', { url: pathToFileURL(path.join(exported.output, 'index.html')).href }, session);
  await waitFor(`document.title==='AI 更新的作品名' && !!document.querySelector('video')`, 'standalone file ready');
  await playIfNeeded(); await evaluate(`document.querySelector('#choices button:nth-child(2)').click()`); await playIfNeeded();
  await evaluate(`document.querySelector('#choices button').click()`);
  await waitFor(`document.getElementById('node-title').textContent==='结局 · 雾中的航线'`, 'standalone ending');
  await screenshot('standalone-player.png'); checks.push('file:// standalone MP4 plays and second branch reaches ending');
  await send('Page.reload', {}, session); await waitFor(`document.getElementById('node-title')?.textContent==='结局 · 雾中的航线'`, 'standalone persisted progress'); checks.push('standalone progress survives browser reload');
  assert.deepEqual(errors, []); checks.push('no uncaught browser exceptions');
  await fs.writeFile(path.join(output, 'browser-validation.json'), JSON.stringify({ passed: true, checks, browser, screenshots: ['editor-desktop.png', 'editor-preview.png', 'editor-mobile.png', 'standalone-player.png'] }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
  if (child.exitCode === null) { child.kill(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 2000); }); }
  await running.close();
  // Isolated test profile only; never operate on the user's browser profile.
  const resolved = await fs.realpath(temporary); assert.ok(path.basename(resolved).startsWith('rusie-browser-'));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 }).catch(error => console.error('Test cleanup:', error.message));
}
