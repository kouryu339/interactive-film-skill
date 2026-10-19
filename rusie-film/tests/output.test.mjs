import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { bundle, inspect } from '../scripts/project.mjs';
import path from 'node:path';
const { createLocalSession } = globalThis.RusieStory;
const original = JSON.parse(await fs.readFile(path.join(bundle, 'tests/fixtures/custom-node/story.json'), 'utf8'));
function story() {
  const value = structuredClone(original);
  value.nodes[1].custom.result.route = { type: 'string', maxLength: 20 };
  value.nodes[1].choices.forEach((edge, i) => { edge.when = { source: 'lastNode.output', field: 'route', equals: i ? 'failed' : 'solved' }; });
  return value;
}
test('output edges accept only current custom node scalar fields, never expressions or other nodes', () => {
  assert.deepEqual(inspect(story()), []);
  for (const change of [
    s => { s.nodes[1].choices[0].when.field = 'other.output.route'; },
    s => { s.nodes[1].choices[0].when.source = 'otherNode.output'; },
    s => { s.nodes[1].choices[0].when.equals = false; },
    s => { s.nodes[1].choices[0].when.node = 'another'; },
    s => { s.nodes[0].choices[0].when = { source: 'lastNode.output', field: 'route', equals: 'solved' }; }
  ]) { const value = story(); change(value); assert.ok(inspect(value).some(issue => issue.level === 'error')); }
});
test('finish validates output and atomically chooses exactly one own edge once', () => {
  const play = createLocalSession(story(), 'signal'); const before = play.snapshot();
  for (const output of [{ score: 2 }, { score: 200, route: 'solved' }, { score: 2, route: 'other' }]) {
    assert.throws(() => play.finish(output, 0)); assert.deepEqual(play.snapshot(), before);
  }
  play.finish({ score: 80, route: 'solved' }, 0);
  assert.equal(play.snapshot().node, 'found'); assert.equal(play.snapshot().variables.score, 80);
  assert.deepEqual(play.snapshot().lastNode, { id: 'signal', output: { score: 80, route: 'solved' } });
  assert.equal(play.snapshot().history[0].automatic, true);
  const committed = play.snapshot(); assert.throws(() => play.finish({ score: 80, route: 'failed' }, 0), /过期/); assert.deepEqual(play.snapshot(), committed);
  const normal = createLocalSession(story()); assert.throws(() => normal.finish({}, 0), /提交入口/);
});
test('ambiguous output refuses all state writes and old named complete remains compatible', () => {
  const value = story(); value.nodes[1].choices[1].when.equals = 'solved';
  const play = createLocalSession(value, 'signal'); const before = play.snapshot();
  assert.throws(() => play.finish({ score: 60, route: 'solved' }, 0), /多条出边/); assert.deepEqual(play.snapshot(), before);
  const legacy = createLocalSession(original, 'signal'); legacy.complete('solved', { score: 60 }, 0); assert.equal(legacy.snapshot().node, 'found');
});
test('lastNode is reconstructed from validated history and cannot leak a stale visit output', () => {
  const value = story(); value.nodes[2].ending = false; value.nodes[2].choices = [{ id: 'again', label: '再来一次', target: 'signal' }];
  const play = createLocalSession(value, 'signal'); play.finish({ score: 70, route: 'solved' }, 0);
  const saved = play.snapshot(); saved.lastNode = { id: 'hijacked', output: { score: 999 } };
  const restored = createLocalSession(value, 'signal'); restored.restore(saved); assert.equal(restored.snapshot().lastNode.id, 'signal'); assert.equal(restored.snapshot().lastNode.output.score, 70);
  restored.choose('again', 1); assert.deepEqual(restored.snapshot().lastNode, { id: 'found', output: null });
  assert.throws(() => restored.finish({ score: 10, route: 'solved' }, 0), /过期/);
  restored.finish({ score: 10, route: 'failed' }, 2); assert.equal(restored.snapshot().node, 'lost');
  const corrupt = restored.snapshot(); corrupt.history[0].result.route = 'failed'; const before = restored.snapshot(); assert.throws(() => restored.restore(corrupt)); assert.deepEqual(restored.snapshot(), before);
});
