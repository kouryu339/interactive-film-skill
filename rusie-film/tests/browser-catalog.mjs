import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bundle, readProject, saveProject, exportProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { launchBrowser } from './browser-driver.mjs';
const output = path.join(bundle, '.test-output'); await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'catalog-browser-'));
const root = path.join(temporary, 'project'); await fs.cp(path.join(bundle, 'tests/fixtures/custom-node'), root, { recursive: true });
const picture = path.join(temporary, '背景.png'); await fs.writeFile(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
// A short PCM WAV fixture keeps the asset test independent of a local encoder.
const audio = path.join(temporary, '港口声.wav'), wav = Buffer.alloc(44 + 1600);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(1600, 40); await fs.writeFile(audio, wav);
const running = await startServer(root); let browser; const checks = [];
try {
  browser = await launchBrowser(temporary); const { evaluate: run, waitFor: wait } = browser;
  await browser.navigate(running.url); await wait(`document.querySelectorAll('.node-card').length===4`, 'editor ready');
  await run(`document.querySelector('[data-tab="media"]').click()`);
  await wait(`document.querySelectorAll('[data-asset-kind]').length===8`, 'eight categories');
  checks.push('all eight asset categories are visible in the Tauri-style library');
  async function kind(value) { await run(`document.querySelector('[data-asset-kind="${value}"]').click()`); }
  async function textAsset(value, name, text) {
    await kind(value); await run(`document.getElementById('add-catalog-asset').click()`);
    for (const [key, content] of Object.entries({ name, text })) await run(`{const control=document.querySelector('[data-asset-field="${key}"]');control.value=${JSON.stringify(content)};control.dispatchEvent(new Event('input',{bubbles:true}))}`);
    await run(`document.querySelector('#asset-form .asset-form-footer .accent').click()`);
    await wait(`document.getElementById('asset-form').hidden&&document.getElementById('save-state').textContent==='已保存到本地'`, 'saved ' + value);
    assert.ok((await readProject(root)).story.catalog.some(asset => asset.kind === value && asset.name === name && asset.text === text));
  }
  await textAsset('script', '调查员的故事台本', '# 夜港\n我收到一封没有落款的信。');
  await textAsset('dialogue', '候船室对话', '调查员：你见过她吗？\n旁白：雨还在下。');
  await textAsset('item', '黄铜钥匙', '一把可以打开检修门的钥匙。'); checks.push('story scripts, dialogue and item definitions save through the real editor and persist on disk');
  async function upload(value, filename) {
    await kind(value);
    const doc = await browser.send('DOM.getDocument', {}), node = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#catalog-upload' });
    await browser.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [filename] });
    await wait(`document.querySelector('#asset-form input[data-asset-field="name"]')&&document.getElementById('save-state').textContent==='已保存到本地'`, 'imported ' + value);
    const actual = (await readProject(root)).story.catalog.filter(asset => asset.kind === value).at(-1); assert.ok(actual?.path); return actual;
  }
  await upload('background', picture); await wait(`document.querySelector('.catalog-card img')?.naturalWidth===1`, 'background image renders');
  await run(`document.querySelector('#asset-form .asset-form-header button').click()`);
  await upload('portrait', picture); await wait(`document.querySelector('.catalog-card img')?.naturalWidth===1`, 'portrait image renders');
  const oldPortrait = (await readProject(root)).story.catalog.find(asset => asset.kind === 'portrait');
  const replacementDoc = await browser.send('DOM.getDocument', {}), replacementInput = await browser.send('DOM.querySelector', { nodeId: replacementDoc.root.nodeId, selector: '[data-asset-field="file"]' });
  await browser.send('DOM.setFileInputFiles', { nodeId: replacementInput.nodeId, files: [picture] });
  await wait(`document.getElementById('save-state').textContent==='有未保存修改'&&document.querySelector('[data-asset-field="name"]')?.value==='背景.png'`, 'replacement staged');
  await run(`document.querySelector('#asset-form .asset-form-footer .accent').click()`);
  await wait(`document.getElementById('asset-form').hidden&&document.getElementById('save-state').textContent==='已保存到本地'`, 'replacement saved');
  const portraits = (await readProject(root)).story.catalog.filter(asset => asset.kind === 'portrait'); assert.equal(portraits.length, 1); assert.equal(portraits[0].id, oldPortrait.id); assert.notEqual(portraits[0].path, oldPortrait.path);
  checks.push('replacing a portrait file preserves its asset ID and metadata without duplicate catalog records');
  await run(`document.querySelector('.catalog-card .catalog-actions button').click()`);
  await run(`document.querySelector('#asset-form .asset-form-header button').click()`);
  await upload('audio', audio); await wait(`document.querySelector('.catalog-card audio')?.readyState>=1`, 'audio decodes');
  checks.push('background, portrait and audio files import from local files; images render and audio metadata decodes');
  await run(`document.querySelector('#asset-form .asset-form-header button').click()`);
  await kind('html'); await wait(`document.querySelectorAll('.catalog-card').length===1`, 'existing package appears');
  await run(`document.querySelector('.catalog-card .catalog-actions button:nth-child(2)').click()`);
  await wait(`document.getElementById('preview-dialog').open&&document.getElementById('preview-frame').contentDocument?.getElementById('node-status')?.textContent==='港口信号台'`, 'HTML bridge preview');
  const frame = await browser.componentFrame(); await wait(`!document.getElementById('pin')?.disabled`, 'HTML interaction ready', frame);
  assert.equal(await run(`document.getElementById('pin').disabled`, frame), false);
  await run(`document.getElementById('close-preview').click()`); checks.push('HTML category previews the registered package through its real isolated custom node and bridge');
  await kind('item'); await run(`document.querySelector('.catalog-card .catalog-actions button:nth-child(2)').click();document.getElementById('save').click()`);
  await wait(`document.getElementById('save-state').textContent==='已保存到本地'`, 'asset reference saved');
  assert.ok((await readProject(root)).story.catalog.find(asset => asset.kind === 'item').nodes.includes('signal'));
  const oldOrigin = await run('performance.timeOrigin');
  await browser.send('Page.reload'); await wait(`performance.timeOrigin!==${oldOrigin}&&document.querySelectorAll('.node-card').length===4`, 'reload'); await run(`document.querySelector('[data-tab="media"]').click()`); await kind('script');
  assert.equal(await run(`document.querySelector('.catalog-card strong').textContent`), '调查员的故事台本');
  checks.push('asset-to-node references and catalog definitions survive reload');
  await run(`document.getElementById('asset-search').value='没有这个资产';document.getElementById('asset-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await run(`document.querySelectorAll('.catalog-card').length`), 0);
  await run(`document.getElementById('asset-search').value='';document.getElementById('asset-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await browser.screenshot('asset-library-desktop.png');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true); await browser.screenshot('asset-library-mobile.png');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); checks.push('search filters real assets and eight-category navigation fits a 390px viewport');
  await run(`document.querySelector('.catalog-card .catalog-actions button').click();{const text=document.querySelector('[data-asset-field="text"]');text.value='尚未保存的台本草稿';text.dispatchEvent(new Event('input',{bubbles:true}))}`);
  const external = await readProject(root); external.story.title = '外部更新'; await saveProject(root, external.story, external.revision);
  await wait(`!document.getElementById('connection').hidden`, 'conflict preserves asset draft', undefined, 12000);
  assert.equal(await run(`document.querySelector('[data-asset-field="text"]').value`), '尚未保存的台本草稿'); checks.push('external project updates do not overwrite an unsaved asset form');
  const exported = await exportProject(root, path.join(temporary, 'exported'));
  for (const asset of external.story.catalog.filter(asset => asset.path)) assert.deepEqual(await fs.readFile(path.join(exported.output, asset.path)), await fs.readFile(path.join(root, asset.path)));
  checks.push('export contains all imported binary resources byte-for-byte');
  assert.deepEqual(browser.exceptions, []); checks.push('no uncaught browser exceptions');
  const report = { passed: true, checks }; await fs.writeFile(path.join(output, 'catalog-browser-validation.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify({ checks })); await browser?.screenshot('asset-library-failure.png').catch(() => {}); throw error; }
finally { await browser?.close(); await running.close(); const resolved = await fs.realpath(temporary); assert.equal(path.dirname(resolved), await fs.realpath(output)); assert.ok(path.basename(resolved).startsWith('catalog-browser-')); await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 }); }
