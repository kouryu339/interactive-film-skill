import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bundle, inspect } from '../scripts/project.mjs';
const definition = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/custom-node/story.json'), 'utf8'));
function fixture() {
  const story = structuredClone(definition); story.catalog = [
    { id: 'room', name: '候船室', kind: 'background', path: 'assets/room.png' },
    { id: 'face', name: '调查员立绘', kind: 'portrait', role: 'detective', path: 'assets/face.png' },
    { id: 'talk', name: '候船室对话', kind: 'dialogue', text: 'detective：她离开了吗？\n旁白：门外只有雨声。' }
  ]; story.nodes[0].presentation = { background: 'room', portrait: 'face', dialogue: 'talk' }; return story;
}
test('node presentation resolves matching asset kinds and rejects missing, wrong or executable fields', () => {
  assert.deepEqual(inspect(fixture()), []);
  for (const presentation of [{ background: 'missing' }, { background: 'face' }, { dialogue: 'room' }, { script: 'alert(1)' }, { audio: 'talk' }, 'room']) {
    const story = fixture(); story.nodes[0].presentation = presentation; assert.ok(inspect(story).some(issue => issue.level === 'error'));
  }
  const wrongVersion = fixture(); wrongVersion.format = 'rusie.film/1'; assert.ok(inspect(wrongVersion).some(issue => issue.level === 'error'));
  const clear = fixture(); clear.nodes[0].presentation = { background: null, portrait: null, dialogue: null }; assert.deepEqual(inspect(clear), []);
});
test('dialogue parsing resolves known speakers and preserves unknown prefixes and markup as text', () => {
  const story = fixture(); const lines = globalThis.RusieCatalog.dialogueLines(story, story.catalog[2]);
  assert.deepEqual(lines.map(line => [line.speaker, line.name, line.text]), [['detective', '调查员', '她离开了吗？'], ['narrator', '旁白', '门外只有雨声。']]);
  assert.equal(globalThis.RusieCatalog.dialogueLines(story, { text: '<img src=x onerror=alert(1)>：原文' })[0].text, '<img src=x onerror=alert(1)>：原文');
  const explicit = { lines: [{ speaker: 'detective', text: '明确的台词' }], text: '不用此原文' }; assert.equal(globalThis.RusieCatalog.dialogueLines(story, explicit)[0].text, '明确的台词');
});
test('empty or malformed dialogue is rejected before playback without crashing validation', () => {
  for (const change of [asset => { asset.text = '\n\n'; }, asset => { asset.lines = {}; }, asset => { asset.lines = [null]; }, asset => { asset.lines = [{ speaker: 'detective', text: ' ' }]; }]) {
    const story = fixture(); change(story.catalog[2]); assert.ok(inspect(story).some(issue => issue.level === 'error'));
  }
});
