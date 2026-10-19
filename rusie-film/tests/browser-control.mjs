import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bundle, initialize, readProject, saveProject, exportProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { serveExport } from '../assets/serve.mjs';
import { launchBrowser } from './browser-driver.mjs';
const output = path.join(bundle, '.test-output'); await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'control-browser-')); const root = await initialize(path.join(temporary, 'project'));
const loaded = await readProject(root), story = loaded.story;
story.format = 'rusie.film/2'; story.variables = { answer: '' };
story.components = [{ id: 'test-control', label: 'Control test', entry: 'index.html', files: ['index.html', 'control.js', 'asset.model', 'canvas.svg', 'clip.mp4'], runtime: { name: 'test-runtime', version: '1', files: ['control.js'] } }];
story.nodes = [{ id: 'start', title: 'Control', text: '', video: null, ending: false, type: 'custom', custom: {
  component: 'test-control', inputs: { graph: [], role: [], state: [], history: true }, config: { view: { inputs: [{ id: 'value', label: 'Value' }], choices: [{ id: 'go', label: 'Submit' }], inventory: ['key'] } }, result: { route: { type: 'string' }, value: { type: 'string', maxLength: 30 } }
}, choices: [{ id: 'done', label: 'Done', target: 'end', when: { source: 'lastNode.output', field: 'route', equals: 'go' }, capture: { answer: 'value' } }] }, { id: 'end', title: 'Finished', text: '', video: null, ending: true, choices: [] }];
const component = path.join(root, 'components/test-control'); await fs.mkdir(component, { recursive: true });
await fs.writeFile(path.join(component, 'index.html'), '<!doctype html><html><body><main id="root"></main><script type="module" src="control.js"></script></body></html>');
await fs.writeFile(path.join(component, 'asset.model'), 'provider-owned-format');
await fs.writeFile(path.join(component, 'canvas.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
await fs.copyFile(path.join(bundle,'tests/fixtures/film/assets/sample-1.mp4'),path.join(component,'clip.mp4'));
await fs.writeFile(path.join(component, 'control.js'), `import { ControlNode } from '../../shared/control-node.js';
class Inherited extends ControlNode {
  applyStyles(css) { super.applyStyles(css+'body{background:rgb(20,40,30);color:white}'); }
  renderHistory(records) { this.slots.history.id='history';this.slots.history.textContent='Custom history: '+records.length; }
  renderInventory(items) { this.slots.inventory.id='bag';this.slots.inventory.textContent='Custom bag: '+items.join(','); }
  renderChoices(choices) { super.renderChoices(choices);this.slots.choices.dataset.overridden='true'; }
  renderInputs(fields) { super.renderInputs(fields);this.slots.inputs.dataset.overridden='true'; }
  async onEvent(name, payload) { this.root.dataset.event=name;await this.checkpoint(payload); }
  onPause() { this.root.dataset.status='paused'; } onResume() { this.root.dataset.status='running'; }
  async onChoice(choice, values) { await this.complete({route:choice.id,value:values.value}); }
}
globalThis.testControl=await Inherited.start({root:document.getElementById('root')});`);
await saveProject(root, story, loaded.revision);
const running = await startServer(root), checks = []; let browser, hosted;
try {
  browser = await launchBrowser(temporary); const { evaluate: run, waitFor: wait } = browser;
  await browser.navigate(running.origin + '/player.html?preview=1#token=' + running.token);
  let frame = await browser.componentFrame(); await wait(`!!globalThis.testControl`, 'inherited class handshake', frame);
  assert.equal(await run(`testControl.definition.kind`, frame), 'control');
  assert.equal(await run(`(()=>{'use strict';try{testControl.definition.id='other';return false}catch{return true}})()`, frame), true);
  assert.equal(await run(`document.body.style.background||getComputedStyle(document.body).backgroundColor`, frame), 'rgb(20, 40, 30)');
  assert.equal(await run(`document.getElementById('history').textContent`, frame), 'Custom history: 0');
  assert.equal(await run(`document.getElementById('bag').textContent`, frame), 'Custom bag: key');
  assert.equal(await run(`document.querySelector('[data-control-slot="choices"]').dataset.overridden`, frame), 'true');
  assert.equal(await run(`document.querySelector('[data-control-slot="inputs"]').dataset.overridden`, frame), 'true');
  assert.equal(await run(`(()=>{const view=testControl.view;testControl.render({...view,choices:undefined});const label=testControl.slots.choices.textContent;testControl.render(view);return label})()`, frame), 'Done');
  checks.push('ControlNode inherits BaseNode; immutable definition, styles, choices, input, history and inventory render in the sandbox');
  assert.equal(await run(`fetch(testControl.asset('asset.model')).then(response=>response.text())`, frame), 'provider-owned-format');
  await run(`testControl.fire('engine:arbitrary-event',{progress:7})`, frame);
  assert.equal(await run(`document.getElementById('root').dataset.event`, frame), 'engine:arbitrary-event');
  checks.push('provider asset formats load through declared resources; arbitrary local runtime event reaches the override and checkpoints');
  await run(`testControl.canvas.set('background',{source:testControl.asset('canvas.svg'),style:{opacity:'.8'}})`,frame);
  await run(`testControl.canvas.set('portrait',{source:testControl.asset('canvas.svg')})`,frame);
  await wait(`document.querySelector('.scene-background')?.naturalWidth===16&&document.querySelector('.scene-portrait')?.naturalWidth===16`,'canvas bridge images');
  assert.equal(await run(`document.querySelector('[data-canvas-layer="background"]').style.opacity`),'0.8');
  await run(`testControl.canvas.set('dialogue',{speaker:'Custom',text:'<script>plain text</script>'})`,frame);
  assert.equal(await run(`document.querySelector('.dialogue-text').textContent`),'<script>plain text</script>');
  assert.equal(await run(`document.querySelector('.dialogue-text').children.length`),0);
  await run(`document.getElementById('dialogue-next').click()`);
  const blocked=await run(`testControl.canvas.set('background',{source:'/api/project'}).then(()=>false,error=>error.message)`,frame); assert.match(blocked,/组件/);
  await run(`testControl.canvas.set('video',{source:testControl.asset('clip.mp4')})`,frame);
  await wait(`!!document.querySelector('[data-canvas-video="tail"]')`,'runtime canvas video',undefined,15000);
  await wait(`document.getElementById('root').dataset.event==='canvas:ended'`,'canvas event to inherited hook',frame);
  assert.equal(await run(`document.getElementById('node-title').textContent`),'Control');
  checks.push('current control overrides all four canvas layers through scoped commands; canvas events do not automatically advance graph lifecycle');
  await run(`document.getElementById('pause-node').click()`);
  await wait(`testControl.paused&&document.getElementById('root').dataset.status==='paused'`, 'pause hook', frame);
  assert.equal(await run(`(()=>{try{testControl.complete({route:'go',value:'42'});return false}catch{return true}})()`, frame), true);
  assert.match(await run(`testControl.canvas.clear('background').then(()=>'',error=>error.message)`,frame),/暂停/);
  await run(`document.getElementById('pause-node').click()`);
  await wait(`!testControl.paused&&document.getElementById('root').dataset.status==='running'`, 'resume hook', frame);
  await run(`document.querySelector('input').value='42';document.querySelector('[data-control-slot="choices"] button').click()`, frame);
  await wait(`document.getElementById('node-title').textContent==='Finished'`, 'output-based own exit');
  checks.push('pause/resume reaches inherited lifecycle; own input and choice commit through validated output');
  const exported = await exportProject(root, path.join(temporary, 'exported')); hosted = await serveExport(exported.output, 0);
  assert.equal((await fetch(hosted.url + 'shared/control-node.js', { headers: { Origin: 'null' } })).headers.get('access-control-allow-origin'), '*');
  await browser.navigate(hosted.url); frame = await browser.componentFrame(); await wait(`!!globalThis.testControl`, 'exported inherited class', frame);
  await run(`document.querySelector('input').value='exported';document.querySelector('[data-control-slot="choices"] button').click()`, frame);
  await wait(`document.getElementById('node-title').textContent==='Finished'`, 'export own exit');
  const answer = await run(`(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('rusie:')&&!key.includes('preview'));return JSON.parse(localStorage.getItem(key)).variables.answer})()`);
  assert.equal(answer, 'exported'); checks.push('standalone export carries both SDK files and persists the validated result');
  assert.deepEqual(browser.exceptions, []); checks.push('no uncaught browser exceptions');
  const report = { passed: true, checks }; await fs.writeFile(path.join(output, 'control-browser-validation.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await hosted?.close(); await running.close(); const resolved = await fs.realpath(temporary); assert.equal(path.dirname(resolved), await fs.realpath(output)); assert.ok(path.basename(resolved).startsWith('control-browser-')); await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 }); }
