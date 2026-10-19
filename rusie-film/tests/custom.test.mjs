import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { bundle, inspect, initialize, readProject, saveProject, importComponent, registerComponent, validateProject, exportProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { serveExport } from '../assets/serve.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const definition = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/custom-node/story.json'), 'utf8'));
const { createLocalSession } = globalThis.RusieStory;
async function fixture(t) {
  const parent = path.join(bundle, '.test-output'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'custom-test-'));
  await fs.cp(path.join(bundle, 'tests/fixtures/custom-node'), root, { recursive: true });
  t.after(async () => { const resolved = await fs.realpath(root); assert.ok(path.basename(resolved).startsWith('custom-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return fs.realpath(root);
}
test('custom definitions validate runtime, input scope, output types and declared paths', () => {
  assert.deepEqual(inspect(definition), []);
  const wrongVersion = clone(definition); wrongVersion.format = 'rusie.film/1'; assert.ok(inspect(wrongVersion).some(i => i.message.includes('旧播放器')));
  for (const modify of [
    s => { delete s.components[0].runtime; }, s => { s.components[0].runtime.files = ['absent.js']; },
    s => { s.components[0].entry = '../../editor.html'; }, s => { s.components[0].files.push('../story.json'); },
    s => { s.nodes[1].custom.inputs.role = ['secret']; }, s => { s.nodes[1].custom.inputs.graph = ['missing']; },
    s => { s.nodes[1].custom.result.score.type = 'json'; }, s => { s.nodes[1].custom.result.score.min = 101; },
    s => { s.nodes[1].choices[0].set.score = 1; }, s => { s.playerRole = 'unknown'; },
    s => { s.nodes[1].type = 'arbitrary'; }
  ]) { const s = clone(definition); modify(s); assert.ok(inspect(s).some(i => i.level === 'error')); }
  const malformed = clone(definition); malformed.nodes[1].choices = {}; assert.ok(inspect(malformed).some(i => i.level === 'error'));
});
test('custom input is selected from graph, active role, state and independent copies', () => {
  const session = createLocalSession(definition, 'signal'); const input = session.input();
  assert.deepEqual(Object.keys(input.graph), ['harbor']); assert.deepEqual(input.role, { observation: 3 }); assert.deepEqual(input.state, { score: 0 });
  assert.ok(!JSON.stringify(input).includes('privateMemo')); assert.ok(!JSON.stringify(input).includes('authorNotes')); assert.ok(!JSON.stringify(input).includes('secret'));
  input.graph.harbor.code = 'tampered'; input.role.observation = 100; assert.equal(session.input().graph.harbor.code, '2410'); assert.equal(session.input().role.observation, 3);
});
test('custom completion rejects wrong ports, types, exits and duplicate commits atomically', () => {
  const session = createLocalSession(definition, 'signal'); const before = session.snapshot();
  assert.throws(() => session.choose('solved', 0), /提交入口/);
  for (const [outcome, result] of [['solved', { score: '100' }], ['solved', { score: 200 }], ['solved', { score: 1, writeFile: true }], ['jump-anywhere', { score: 50 }]]) {
    assert.throws(() => session.complete(outcome, result, 0)); assert.deepEqual(session.snapshot(), before);
  }
  session.complete('solved', { score: 80 }, 0); const after = session.snapshot(); assert.equal(after.node, 'found'); assert.equal(after.variables.score, 80); assert.equal(after.variables.opened, true);
  assert.throws(() => session.complete('solved', { score: 80 }, 0), /过期/); assert.deepEqual(session.snapshot(), after);
  const normal = createLocalSession(definition); assert.throws(() => normal.complete('investigate', {}, 0), /提交入口/);
});
test('checkpoint and custom-result replay preserve progress without trusting stored variables', () => {
  const session = createLocalSession(definition); session.choose('investigate', 0); session.checkpoint({ attempts: 2, pin: '241' }, 1);
  const restored = createLocalSession(definition); restored.restore(session.snapshot()); assert.deepEqual(restored.input().checkpoint, { attempts: 2, pin: '241' });
  restored.complete('solved', { score: 60 }, 1); assert.equal(restored.snapshot().checkpoint, null);
  const saved = restored.snapshot(); saved.variables.score = 999; const reloaded = createLocalSession(definition); reloaded.restore(saved); assert.equal(reloaded.snapshot().variables.score, 60);
  const before = reloaded.snapshot(); saved.history[1].result.score = 500; assert.throws(() => reloaded.restore(saved)); assert.deepEqual(reloaded.snapshot(), before);
  assert.throws(() => restored.checkpoint({}, 1), /过期/);
  const otherRole = clone(definition); otherRole.playerRole = 'guard'; otherRole.nodes[1].custom.inputs.role = []; assert.throws(() => createLocalSession(otherRole).restore(session.snapshot()), /角色/);
});
test('untrusted structured data has bounded depth, size and safe keys', () => {
  for (const value of [JSON.parse('{"__proto__":1}'), { nested: Infinity }, { huge: 'a'.repeat(66000) }, { method() {} }]) assert.throws(() => globalThis.RusieCustom.assertJSON(value));
  let deep = {}; for (let i = 0; i < 20; i++) deep = { nested: deep }; assert.throws(() => globalThis.RusieCustom.assertJSON(deep));
});
test('large repeated custom results have a bounded history and reject without partial commit', () => {
  const story = clone(definition); story.nodes[1].custom.result.blob = { type: 'string', maxLength: 60000 }; story.nodes[1].choices[0].target = 'signal';
  const session = createLocalSession(story, 'signal'); const payload = { score: 50, blob: 'x'.repeat(60000) };
  let refused = false;
  for (let i = 0; i < 100; i++) {
    const before = session.snapshot();
    try { session.complete('solved', payload, before.visit); }
    catch (error) { assert.match(error.message, /4 MB/); assert.deepEqual(session.snapshot(), before); refused = true; break; }
  }
  assert.equal(refused, true);
});
test('component import checks supplied runtime and uses CAS without replacing installed packages', async t => {
  const root = await fixture(t); let loaded = await readProject(root); delete loaded.story.components; loaded.story.nodes[1].custom.component = 'signal-lock';
  // Start from an ordinary, valid project before registering a package.
  loaded.story.nodes.splice(1, 1); loaded.story.nodes[0].choices[0].target = 'found'; await fs.writeFile(path.join(root, 'story.json'), JSON.stringify(loaded.story));
  const existing = path.join(root, 'components'); const moved = path.join(root, 'provider'); await fs.rename(existing, moved);
  loaded = await readProject(root); const imported = await importComponent(root, path.join(moved, 'signal-lock'), loaded.revision);
  assert.equal(imported.story.components[0].runtime.name, 'demo-web-module'); assert.equal(imported.story.components.length, 1); assert.deepEqual((await validateProject(root, imported.story)).filter(i => i.level === 'error'), []);
  await assert.rejects(importComponent(root, path.join(moved, 'signal-lock'), loaded.revision), error => error.status === 409);
  await assert.rejects(importComponent(root, path.join(moved, 'signal-lock'), imported.revision));
  await fs.unlink(path.join(root, 'components/signal-lock/runtime.js')); assert.ok((await validateProject(root, imported.story)).some(i => i.level === 'error'));
});
test('component registration validates an existing project package', async t => {
  const root = await fixture(t); const loaded = await readProject(root); loaded.story.components = []; loaded.story.nodes.splice(1, 1); loaded.story.nodes[0].choices[0].target = 'found';
  await fs.writeFile(path.join(root, 'story.json'), JSON.stringify(loaded.story)); const before = await readProject(root);
  const result = await registerComponent(root, 'signal-lock', before.revision); assert.equal(result.story.components.length, 1);
  await assert.rejects(registerComponent(root, '../outside', result.revision));
});
test('registering a runtime upgrades a legacy movie definition without losing its story', async t => {
  const root = await fixture(t); const movie = await initialize(path.join(root, 'new-movie')); const before = await readProject(movie); assert.equal(before.story.format, 'rusie.film/1');
  const result = await importComponent(movie, path.join(root, 'components/signal-lock'), before.revision);
  assert.equal(result.story.format, 'rusie.film/2'); assert.deepEqual(result.story.nodes, before.story.nodes);
});
test('missing provider runtime rolls back partial import and leaves project version unchanged', async t => {
  const root = await fixture(t); const source = path.join(root, 'provider');
  await fs.rename(path.join(root, 'components/signal-lock'), source); await fs.unlink(path.join(source, 'runtime.js'));
  const loaded = await readProject(root); loaded.story.components = []; loaded.story.nodes.splice(1, 1); loaded.story.nodes[0].choices[0].target = 'found';
  await fs.writeFile(path.join(root, 'story.json'), JSON.stringify(loaded.story)); const before = await readProject(root);
  await assert.rejects(importComponent(root, source, before.revision)); assert.equal((await readProject(root)).revision, before.revision);
  await assert.rejects(fs.stat(path.join(root, 'components/signal-lock')), { code: 'ENOENT' });
});
test('component resources cannot follow a link into another part of the project', async t => {
  const root = await fixture(t); const alias = path.join(root, 'components/signal-lock/leak'); await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const loaded = await readProject(root); loaded.story.components[0].files.push('leak/story.json'); await saveProject(root, loaded.story, loaded.revision);
  assert.ok((await validateProject(root, loaded.story)).some(i => i.level === 'error'));
  const running = await startServer(root); t.after(() => running.close());
  const result = await fetch(running.origin + '/components/signal-lock/leak/story.json', { headers: { Origin: 'null' } }); assert.equal(result.status, 403);
  assert.ok(!(await result.text()).includes('harbor-custom-demo'));
  await assert.rejects(exportProject(root, path.join(root, 'bad-export')));
});
test('component HTTP responses isolate documents and support module fetch without API access', async t => {
  const root = await fixture(t); const running = await startServer(root); t.after(() => running.close());
  const response = await fetch(running.origin + '/components/signal-lock/index.html', { headers: { Origin: 'null' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.ok(response.headers.get('content-security-policy').includes('sandbox allow-scripts;')); assert.ok(!response.headers.get('content-security-policy').includes('allow-same-origin'));
  const runtime = await fetch(running.origin + '/components/signal-lock/runtime.js', { headers: { Origin: 'null' } }); assert.equal(runtime.status, 200); assert.ok(runtime.headers.get('content-type').includes('javascript'));
  assert.equal((await fetch(running.origin + '/components/signal-lock/component.json')).status, 404);
  assert.equal((await fetch(running.origin + '/api/project', { headers: { Origin: 'null', 'X-Rusie-Token': running.token } })).status, 403);
  assert.equal((await fetch(running.origin + '/shared/component-sdk.js', { headers: { Origin: 'null' } })).status, 200);
  const loaded = await readProject(root);
  const unchanged = await fetch(`${running.origin}/api/project?poll=1&revision=${loaded.revision}`, { headers: { 'X-Rusie-Token': running.token } }); assert.equal((await unchanged.json()).unchanged, true);
  const labelURL = running.origin + '/components/signal-lock/labels.json'; assert.equal((await fetch(labelURL)).status, 200);
  loaded.story.components[0].files = loaded.story.components[0].files.filter(file => file !== 'labels.json'); await saveProject(root, loaded.story, loaded.revision);
  assert.equal((await fetch(labelURL)).status, 404);
});
test('custom export packages complete runtime, launcher and HTTP-only requirements', async t => {
  const root = await fixture(t); const loaded = await readProject(root); const exported = await exportProject(root, path.join(root, 'exported'), loaded.revision);
  assert.equal(exported.requiresHTTP, true); const manifest = JSON.parse(await fs.readFile(path.join(exported.output, 'export-manifest.json'), 'utf8'));
  assert.equal(manifest.requiresHTTP, true); assert.ok(manifest.files.includes('components/signal-lock/runtime.js')); assert.ok(manifest.files.includes('serve.mjs')); assert.ok(manifest.files.includes('启动作品.cmd'));
  const hosted = await serveExport(exported.output, 0); t.after(() => hosted.close());
  assert.equal((await fetch(hosted.url)).status, 200);
  const asset = await fetch(new URL('components/signal-lock/labels.json', hosted.url), { headers: { Origin: 'null' } }); assert.equal(asset.status, 200); assert.equal(asset.headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(new URL('index.html', hosted.url), { headers: { Origin: 'null' } })).status, 404);
  assert.equal((await fetch(new URL('export-manifest.json', hosted.url))).status, 404);
});
test('local service shutdown is bounded even with a speculative browser socket', async t => {
  const root = await fixture(t); const running = await startServer(root); t.after(() => running.close());
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(new URL(running.origin).port) }); t.after(() => socket.destroy());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  let timer;
  try { await Promise.race([running.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Shutdown waited for a socket forever')), 1500); })]); }
  finally { clearTimeout(timer); }
});
