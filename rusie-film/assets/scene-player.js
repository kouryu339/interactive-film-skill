/* Graph-defined scene entry. Canvas state outlives individual controls. */
(() => {
  function create(story, { canvas, preview, token }) {
    const source = relative => preview ? `/media/${relative.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}` : relative;
    const asset = id => (story.catalog || []).find(item => item.id === id);
    let pending = false;
    function prepare(node) {
      pending = false; canvas.enter();
      if (Object.hasOwn(node.presentation || {}, 'background')) {
        const selected = asset(node.presentation.background);
        if (selected) canvas.set('background', { source: source(selected.path), alt: selected.name });
        else { canvas.clear('background'); canvas.clear('video'); }
      }
    }
    function begin(node, onDone) {
      const portrait = asset(node.presentation?.portrait);
      if (portrait) canvas.set('portrait', { source: source(portrait.path), alt: portrait.name });
      const selected = asset(node.presentation?.dialogue), lines = globalThis.RusieCatalog.dialogueLines(story, selected);
      if (!lines.length) { onDone(); return; }
      pending = true; canvas.set('dialogue', { lines, label: selected.name }, { onDone() { pending = false; onDone(); } });
    }
    return { prepare, begin, get pending() { return pending; } };
  }
  globalThis.RusieScenePlayer = Object.freeze({ create });
})();
