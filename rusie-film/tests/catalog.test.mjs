import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bundle, initialize, readProject, saveProject, validateProject, importCatalogFile, exportProject, inspect } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { serveExport } from '../assets/serve.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const parent = path.join(bundle, '.test-output'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'catalog-test-')); await initialize(root);
  t.after(async () => { const resolved = await fs.realpath(root); assert.equal(path.dirname(resolved), await fs.realpath(parent)); assert.ok(path.basename(resolved).startsWith('catalog-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return root;
}
test('asset schema validates types, role and node references, paths and HTML package ownership', async () => {
  const story = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/custom-node/story.json'), 'utf8'));
  story.catalog = [{ id: 'script', name: '台本', kind: 'script', text: '内容', role: 'detective', nodes: ['arrival'] }, { id: 'html', kind: 'html', name: '动画', component: 'signal-lock' }];
  assert.deepEqual(inspect(story), []);
  for (const bad of [
    { id: 'x', name: 'x', kind: 'audio', path: 'assets/../../account.mp3' },
    { id: 'x', name: 'x', kind: 'html', component: 'missing' },
    { id: 'x', name: 'x', kind: 'script', text: '', role: 'unknown' },
    { id: 'x', name: 'x', kind: 'script', text: '', nodes: ['missing'] },
    { id: 'x', name: 'x', kind: 'dialogue', text: '', lines: [{ speaker: 'hijacked', text: 'x' }] },
    { id: 'x', name: 'x', kind: 'portrait', path: 'assets/file.html' }
  ]) { const candidate = structuredClone(story); candidate.catalog.push(bad); assert.ok(inspect(candidate).some(issue => issue.level === 'error')); }
  const legacy = structuredClone(story); legacy.format = 'rusie.film/1'; assert.ok(inspect(legacy).some(issue => issue.level === 'error'));
});
test('binary imports validate signatures and revisions, roll back failures, and preserve filenames as labels', async t => {
  const root = await fixture(t); const before = await readProject(root);
  await assert.rejects(importCatalogFile(root, 'wrong.png', 'background', Readable.from(['this is HTML content']), before.revision), /文件头/);
  assert.equal((await readProject(root)).revision, before.revision); assert.deepEqual(await fs.readdir(path.join(root, 'assets')), []);
  const imported = await importCatalogFile(root, '背景.png', 'background', Readable.from([png]), before.revision);
  assert.equal(imported.story.format, 'rusie.film/2'); assert.equal(imported.asset.name, '背景.png'); assert.equal(imported.story.catalog.length, 1);
  assert.deepEqual(await fs.readFile(path.join(root, imported.asset.path)), png);
  await assert.rejects(importCatalogFile(root, 'another.png', 'portrait', Readable.from([png]), before.revision), error => error.status === 409);
  assert.equal((await readProject(root)).story.catalog.length, 1);
});
test('catalog binary files are token protected, copied into export, and served with ranges', async t => {
  const root = await fixture(t); const before = await readProject(root);
  const imported = await importCatalogFile(root, 'portrait.png', 'portrait', Readable.from([png]), before.revision);
  const editor = await startServer(root); t.after(() => editor.close());
  const media = `/media/${imported.asset.path}`;
  assert.equal((await fetch(editor.origin + media)).status, 403);
  assert.equal((await fetch(editor.origin + media + '?token=' + editor.token, { headers: { Origin: 'null' } })).status, 403);
  const response = await fetch(editor.origin + media + '?token=' + editor.token); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  const exported = await exportProject(root, path.join(root, 'exported')); const server = await serveExport(exported.output, 0); t.after(() => server.close());
  const range = await fetch(server.url + imported.asset.path, { headers: { Range: 'bytes=0-7' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 8);
  assert.deepEqual(await fs.readFile(path.join(exported.output, imported.asset.path)), png);
  await fs.unlink(path.join(root, imported.asset.path)); assert.ok((await validateProject(root, imported.story)).some(issue => issue.message.includes('分类素材文件')));
});
test('asset text remains plain data across save/export and references block invalid deletion', async t => {
  const root = await fixture(t); const before = await readProject(root); const story = before.story; story.format = 'rusie.film/2';
  story.catalog = [{ id: 'cue', kind: 'dialogue', name: '旁白', text: '<script>globalThis.bad=true</script>', nodes: [story.start] }, { id: 'key', kind: 'item', name: '钥匙', text: '开门用' }];
  const saved = await saveProject(root, story, before.revision); const exported = await exportProject(root, path.join(root, 'exported'));
  const html = await fs.readFile(path.join(exported.output, 'index.html'), 'utf8'); assert.ok(!html.includes('<script>globalThis.bad')); assert.ok(html.includes('\\u003cscript>'));
  const invalid = structuredClone(story); invalid.catalog[0].nodes = ['removed']; await assert.rejects(saveProject(root, invalid, saved.revision)); assert.equal((await readProject(root)).revision, saved.revision);
});
