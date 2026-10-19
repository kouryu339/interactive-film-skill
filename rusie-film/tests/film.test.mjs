import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { initialize, readProject, saveProject, importMedia, exportProject, validateProject, withLock, inspect, bundle, containedFile } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
const { createLocalSession } = globalThis.RusieStory;
const template = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/base-story.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rusie-film-test-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.ok(path.basename(resolved).startsWith('rusie-film-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  const root = await initialize(directory), current = await readProject(root);
  await saveProject(root, template, current.revision); return root;
}
const fakeMP4 = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 0, 0, ...Buffer.from('isommp42')]);

test('story validation catches broken targets, conditions, types and unsafe paths', () => {
  assert.deepEqual(inspect(template), []);
  const story = clone(template); story.nodes[0].choices[0].target = 'missing'; story.nodes[0].choices[1].set = { opened: 'yes' };
  story.assets.push({ id: 'clip', label: 'x', path: 'assets/../../private.mp4' });
  const issues = inspect(story).filter(i => i.level === 'error'); assert.equal(issues.length, 3);
  for (const invalid of [null, [], {}, { format: 'rusie.film/1', nodes: [null], assets: [null], variables: null }]) assert.ok(inspect(invalid).some(i => i.level === 'error'));
  for (const filename of ['https://example.com/a.mp4', 'assets/../a.mp4', 'assets/%2e/a.mp4', 'assets\\a.mp4']) {
    const draft = clone(template); draft.assets.push({ id: 'clip', label: 'x', path: filename }); assert.ok(inspect(draft).some(i => i.level === 'error'));
  }
});
test('conditional choices, single commit, immutable snapshots and replayed saves', () => {
  const story = clone(template); story.nodes[1].choices[0].when = { variable: 'opened', equals: true };
  const session = createLocalSession(story); let commits = 0; session.subscribe(() => commits++);
  const first = session.choose('open', 0); assert.equal(first.variables.opened, true); assert.equal(first.node, 'letter');
  assert.throws(() => session.choose('open', 0), /过期/); assert.equal(commits, 1);
  first.variables.opened = false; first.history.length = 0; assert.equal(session.snapshot().variables.opened, true);
  session.choose('stay', 1); assert.equal(session.snapshot().node, 'stay');
  const saved = session.snapshot(); saved.variables.opened = false;
  const restored = createLocalSession(story); restored.restore(saved); assert.equal(restored.snapshot().variables.opened, true);
  const before = restored.snapshot(); const corrupt = clone(saved); corrupt.history[1].to = 'sail';
  assert.throws(() => restored.restore(corrupt)); assert.deepEqual(restored.snapshot(), before);
  const middle = createLocalSession(story, 'letter'); assert.deepEqual(middle.available().map(c => c.id), ['board']);
  assert.throws(() => middle.choose('stay', 0), /无法选择/);
});
test('graph diagnostics identify unreachable scenes and loops without endings', () => {
  const story = clone(template); story.nodes[0].choices.forEach(c => { c.target = 'arrival'; });
  const issues = inspect(story); assert.ok(issues.some(i => i.message.includes('无法到达此节点'))); assert.ok(issues.some(i => i.message.includes('任何结局')));
});
test('exclusive initialization and concurrent CAS preserve another writer', async t => {
  const root = await fixture(t); await assert.rejects(initialize(root), { code: 'EEXIST' });
  const first = await readProject(root); const left = clone(first.story); const right = clone(first.story); left.title = 'AI 修改'; right.title = '网页修改';
  const results = await Promise.allSettled([saveProject(root, left, first.revision), saveProject(root, right, first.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const after = await readProject(root); assert.notEqual(after.revision, first.revision);
  await assert.rejects(saveProject(root, first.story, first.revision), error => error.status === 409); assert.equal((await readProject(root)).revision, after.revision);
  await withLock(root, async () => { await assert.rejects(saveProject(root, first.story, after.revision), error => error.status === 409); });
  assert.ok(!(await fs.readdir(root)).some(name => name.includes('.tmp') || name.includes('.lock')));
});
test('invalid save leaves official story intact; external edits trigger conflict', async t => {
  const root = await fixture(t); const original = await readProject(root); const draft = clone(original.story); draft.nodes[0].choices[0].target = 'gone';
  await assert.rejects(saveProject(root, draft, original.revision)); assert.equal((await readProject(root)).revision, original.revision);
  original.story.title = '外部新标题'; await fs.writeFile(path.join(root, 'story.json'), JSON.stringify(original.story));
  await assert.rejects(saveProject(root, template, original.revision), error => error.status === 409);
});
test('MP4 import registers streamed data and rolls back invalid files', async t => {
  const root = await fixture(t); const loaded = await readProject(root);
  await assert.rejects(importMedia(root, 'bad.mp4', Readable.from(['not a movie file']), loaded.revision), /MP4/);
  assert.equal((await readProject(root)).revision, loaded.revision); assert.deepEqual(await fs.readdir(path.join(root, 'assets')), []);
  const result = await importMedia(root, '演示 视频.mp4', Readable.from([fakeMP4]), loaded.revision);
  assert.equal(result.story.assets.length, 1); assert.deepEqual(await fs.readFile(path.join(root, result.asset.path)), fakeMP4);
  assert.deepEqual(await validateProject(root, result.story), []);
  await fs.unlink(path.join(root, result.asset.path)); assert.ok((await validateProject(root, result.story)).some(i => i.level === 'error'));
});
test('standalone export embeds safe data, copies media and refuses overwrite', async t => {
  const root = await fixture(t); let loaded = await readProject(root);
  loaded = await importMedia(root, 'sample.mp4', Readable.from([fakeMP4]), loaded.revision);
  loaded.story.nodes[0].video = loaded.asset.id; loaded.story.title = '</script><script>alert(1)</script>';
  loaded = await saveProject(root, loaded.story, loaded.revision);
  const out = path.join(root, 'web'); await exportProject(root, out, loaded.revision);
  const html = await fs.readFile(path.join(out, 'index.html'), 'utf8'); assert.ok(!html.includes('<script>alert(1)')); assert.ok(html.includes('\\u003c/script>'));
  const embedded = JSON.parse(html.match(/id="story-data">([\s\S]*?)<\/script>/)[1]); assert.equal(embedded.story.title, loaded.story.title);
  assert.deepEqual(await fs.readFile(path.join(out, loaded.story.assets[0].path)), fakeMP4);
  assert.ok((await fs.readFile(path.join(out, 'player.js'), 'utf8')).includes('story-data'));
  await assert.rejects(exportProject(root, out), { code: 'EEXIST' }); await assert.rejects(exportProject(root, root), /源项目/);
  const missing = clone(loaded.story); missing.assets[0].path = 'assets/missing.mp4'; await saveProject(root, missing, loaded.revision);
  await assert.rejects(exportProject(root, path.join(root, 'broken')), /素材/);
});
test('HTTP editor authenticates requests, serves media ranges, and protects revisions', async t => {
  const root = await fixture(t); const loaded = await readProject(root); const imported = await importMedia(root, 'clip.mp4', Readable.from([fakeMP4]), loaded.revision);
  const running = await startServer(root); t.after(() => running.close()); const auth = { 'X-Rusie-Token': running.token };
  assert.equal((await fetch(running.origin + '/')).status, 200);
  assert.equal((await fetch(running.origin + '/api/project')).status, 403);
  assert.equal((await fetch(running.origin + '/api/project', { headers: { ...auth, Origin: 'https://other.example' } })).status, 403);
  const response = await fetch(running.origin + '/api/project', { headers: auth }); const data = await response.json(); assert.equal(data.story.assets.length, 1);
  const mediaURL = `${running.origin}/media/${imported.asset.path}?token=${running.token}`;
  const ranged = await fetch(mediaURL, { headers: { Range: 'bytes=4-7' } }); assert.equal(ranged.status, 206); assert.equal(await ranged.text(), 'ftyp');
  assert.equal((await fetch(mediaURL, { headers: { Range: 'bytes=999-1000' } })).status, 416);
  assert.equal((await fetch(running.origin + '/media/' + imported.asset.path)).status, 403);
  assert.equal((await fetch(running.origin + '/story.json')).status, 404);
  const draft = clone(data.story); draft.title = '新标题';
  const saved = await fetch(running.origin + '/api/project', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ story: draft, revision: data.revision }) }); assert.equal(saved.status, 200);
  const stale = await fetch(running.origin + '/api/project', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ story: data.story, revision: data.revision }) }); assert.equal(stale.status, 409);
});
test('resolved file guard refuses files outside project', async t => {
  const root = await fixture(t); await assert.rejects(containedFile(root, path.join(bundle, 'package.json')), error => error.status === 403);
});
