import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BaseNode } from '../assets/shared/control-node.js';
import { bundle, inspect } from '../scripts/project.mjs';

test('BaseNode freezes its definition and inputs, dispatches arbitrary local events and guards lifecycle writes', async () => {
  let control; const commits = [], lifecycle = [];
  const api = { input: { definition: { id: 'node', kind: 'control' }, config: {}, resources: { component: 'widget' }, state: { bag: 'key' } },
    complete: (...args) => { commits.push(args); return Promise.resolve(); }, checkpoint: () => Promise.resolve(), onControl(listener) { control = listener; return () => lifecycle.push('unsubscribed'); } };
  class Extension extends BaseNode {
    onEvent(name, payload) { return { name, payload }; }
    onPause() { lifecycle.push('pause'); } onResume() { lifecycle.push('resume'); } onDispose() { lifecycle.push('dispose'); }
  }
  const node = new Extension({ api, root: {} });
  assert.throws(() => { node.definition.id = 'other'; }, TypeError);
  assert.throws(() => { node.input.state.bag = 'other'; }, TypeError);
  assert.throws(() => { node.input = {}; }, TypeError);
  assert.deepEqual(await node.fire('engine:custom-trigger', { arbitrary: 1 }), { name: 'engine:custom-trigger', payload: { arbitrary: 1 } });
  await node.complete({ route: 'own' }); assert.deepEqual(commits, [[{ route: 'own' }]]);
  await control('pause'); assert.throws(() => node.complete({ route: 'own' }), /暂停/);
  await control('resume'); await node.complete('exit', { score: 1 });
  await control('dispose'); assert.throws(() => node.checkpoint({}), /卸载/);
  assert.deepEqual(lifecycle, ['pause', 'resume', 'dispose', 'unsubscribed']);
});

test('BaseNode asset URLs stay inside the current component under a static-site prefix', () => {
  const old = globalThis.location; globalThis.location = { href: 'http://localhost/site/components/widget/sub/index.html' };
  try {
    const node = new BaseNode({ root: {}, api: { input: { resources: { component: 'widget' } }, onControl() {} } });
    assert.equal(node.asset('models/角色.glb'), 'http://localhost/site/components/widget/models/%E8%A7%92%E8%89%B2.glb');
    for (const name of ['../secret', '/root', 'https://elsewhere/x', 'x%2fsecret', 'x\\y']) assert.throws(() => node.asset(name), /相对路径/);
  } finally { if (old === undefined) delete globalThis.location; else globalThis.location = old; }
});

test('control input exposes only its own base contract and opt-in history without past outputs', async () => {
  const definition = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/custom-node/story.json'), 'utf8'));
  const session = globalThis.RusieStory.createLocalSession(definition); session.choose('investigate', 0);
  assert.equal(session.input().history, undefined);
  definition.nodes[1].custom.inputs.history = true;
  assert.deepEqual(inspect(definition), []);
  const withHistory = globalThis.RusieStory.createLocalSession(definition); withHistory.choose('investigate', 0);
  const input = withHistory.input();
  assert.equal(input.definition.kind, 'control'); assert.equal(input.definition.id, 'signal');
  assert.deepEqual(input.history, [{ from: 'arrival', choice: 'investigate', to: 'signal' }]);
  assert.ok(!JSON.stringify(input.definition).includes('target'));
  definition.nodes[1].custom.inputs.history = 'yes'; assert.ok(inspect(definition).some(issue => issue.message.includes('history')));
});

test('new project template is blank and has no embedded narrative or runtime assets', async () => {
  const template = JSON.parse(await fs.readFile(path.join(bundle, 'templates/story.json'), 'utf8'));
  assert.deepEqual(inspect(template), []); assert.equal(template.nodes.length, 1); assert.equal(template.nodes[0].text, ''); assert.deepEqual(template.assets, []);
});
