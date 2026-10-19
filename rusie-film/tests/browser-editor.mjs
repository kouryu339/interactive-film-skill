import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bundle, readProject, saveProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { launchBrowser } from './browser-driver.mjs';
const output = path.join(bundle, '.test-output'); await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'editor-layout-'));
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(bundle, 'tests/fixtures/custom-node');
const root = path.join(temporary, 'project'); await fs.cp(source, root, { recursive: true, filter: entry => path.basename(entry) !== 'exports' });
const initial = await readProject(root); initial.story.id = 'editor-layout-' + randomUUID().slice(0, 8); await saveProject(root, initial.story, initial.revision);
const running = await startServer(root); let browser; const checks = [];
try {
  browser = await launchBrowser(temporary); const { evaluate: run, waitFor: wait } = browser;
  await browser.navigate(running.url);
  await wait(`document.querySelectorAll('.node-card').length===${initial.story.nodes.length}`, 'all nodes loaded');
  assert.equal(await run(`document.getElementById('inspector').hidden`), true);
  assert.equal(await run(`document.querySelector('.navigation').getBoundingClientRect().width`), 222);
  assert.equal(await run(`document.getElementById('graph-scroll').getBoundingClientRect().width>innerWidth*.8`), true);
  assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
  await browser.screenshot('tauri-editor-graph.png'); checks.push('Tauri-sized sidebar and full-width fitted graph; inspector does not occupy canvas until opened');
  const size = await run(`document.getElementById('graph-size').getBoundingClientRect().width`);
  await run(`document.getElementById('zoom-in').click()`); assert.ok(await run(`document.getElementById('graph-size').getBoundingClientRect().width`) > size);
  await run(`document.getElementById('fit-graph').click()`); checks.push('zoom and fit controls resize the actual graph scrolling surface');
  async function click(selector) {
    const point = await run(`(()=>{const box=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:box.left+box.width/2,y:box.top+box.height/2}})()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  await click('.node-card'); await wait(`!document.getElementById('inspector').hidden`, 'node details opened by pointer');
  assert.equal(await run(`document.getElementById('inspector').getBoundingClientRect().width`), 360);
  await browser.screenshot('tauri-editor-inspector.png');
  await click('.inspector-close'); assert.equal(await run(`document.getElementById('inspector').hidden`), true);
  await click('.node-card'); await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await run(`document.getElementById('inspector').hidden`), true); checks.push('node pointer selection opens 360px floating inspector; close and Escape restore canvas');
  await click('.node-card');
  await run(`{const input=document.querySelector('#inspector .field input');input.value='布局验收节点';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('save').click()}`);
  await wait(`document.getElementById('save-state').textContent==='已保存到本地'`, 'node save');
  assert.equal((await readProject(root)).story.nodes[0].title, '布局验收节点'); checks.push('floating inspector writes through existing project revision-safe save');
  await run(`document.querySelector('[data-tab="media"]').click()`);
  await wait(`document.querySelectorAll('.media-card').length===${initial.story.assets.length}`, 'media view');
  assert.equal(await run(`document.getElementById('page-title').textContent`), '资产配置');
  await browser.screenshot('tauri-editor-assets.png');
  await run(`document.querySelector('[data-tab="components"]').click()`); await wait(`document.querySelectorAll('.component-catalog').length>0`, 'component catalog');
  await run(`document.querySelector('[data-tab="settings"]').click()`); await wait(`document.querySelectorAll('.role-card').length>0`, 'role definitions'); checks.push('sidebar routes to media, component catalog and graph/role settings with current capabilities intact');
  await run(`document.querySelector('[data-tab="story"]').click();document.getElementById('preview-nav').click()`);
  await wait(`document.getElementById('preview-dialog').open&&document.getElementById('preview-frame').contentDocument?.querySelector('video')?.readyState>=2`, 'sidebar preview playable');
  await run(`document.getElementById('close-preview').click()`); checks.push('sidebar preview mounts the saved real player and decodes MP4');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
  assert.ok(await run(`document.getElementById('graph-scroll').getBoundingClientRect().height`) > 200);
  await browser.screenshot('tauri-editor-mobile.png'); checks.push('390px layout retains canvas and navigation without horizontal page overflow');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await run(`document.getElementById('node-picker').open=true;document.querySelectorAll('.node-link')[1].click()`);
  await run(`{const control=document.querySelector('#inspector .field input');control.value='保留的网页草稿';control.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const updated = await readProject(root); updated.story.title += ' · 外部更新'; await saveProject(root, updated.story, updated.revision);
  await wait(`!document.getElementById('connection').hidden`, 'external write conflict', undefined, 12000);
  assert.equal(await run(`document.querySelector('#inspector .field input').value`), '保留的网页草稿'); checks.push('external file updates preserve unsaved inspector drafts and expose conflict controls');
  assert.deepEqual(browser.exceptions, []); checks.push('no uncaught browser exceptions');
  await fs.writeFile(path.join(output, 'editor-layout-validation.json'), JSON.stringify({ passed: true, checks }, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) { await browser?.screenshot('tauri-editor-failure.png').catch(() => {}); throw error; }
finally {
  await browser?.close(); await running.close();
  const resolved = await fs.realpath(temporary); assert.ok(path.basename(resolved).startsWith('editor-layout-')); assert.equal(path.dirname(resolved), await fs.realpath(output));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}
