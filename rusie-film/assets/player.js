/* This file also runs from file:// in exported works. No network or module loader required. */
(() => {
  const $ = id => document.getElementById(id);
  const { createLocalSession, assertStory } = globalThis.RusieStory;
  const params = new URLSearchParams(location.hash.slice(1));
  const preview = new URLSearchParams(location.search).has('preview');
  const token = params.get('token');
  let story, revision, session, storageKey, video, generation = 0;
  let pendingMedia = false; let storageWarning = '';
  let customController, paused = false, checkpointTimer, scene, canvas, videoControl;
  const notice = message => { $('notice').textContent = message; };
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(session.snapshot())); }
    catch { storageWarning = '浏览器未允许保存进度，本次仍可正常游玩。'; }
  }
  function renderChoices(node, expectedVisit) {
    if (pendingMedia) return;
    document.body.classList.remove('playing'); $('media-gate').hidden = true;
    $('choices').replaceChildren();
    if (node.type === 'custom') { startCustom(node, expectedVisit); return; }
    if (node.ending) { canvas.pause(); $('eyebrow').textContent = 'THE END · 故事在此停留'; notice(storageWarning); return; }
    const choices = session.available();
    choices.forEach((choice, index) => {
      const button = document.createElement('button'); button.className = 'choice';
      const number = document.createElement('span'); number.className = 'choice-number'; number.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('span'); label.textContent = choice.label;
      const arrow = document.createElement('span'); arrow.className = 'choice-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      button.append(number, label, arrow);
      button.addEventListener('click', () => {
        try { button.disabled = true; session.choose(choice.id, expectedVisit); save(); render(); }
        catch (error) { button.disabled = false; notice(error.message); }
      });
      $('choices').append(button);
    });
    notice(choices.length ? storageWarning : '当前状态没有可用选项，请重新开始，或联系作品作者检查条件。');
  }
  function finishMedia(node, state, epoch) {
    if (epoch !== generation) return;
    document.body.classList.remove('playing'); $('media-gate').hidden = true;
    scene.begin(node, () => { if (epoch === generation) renderChoices(node, state.visit); });
  }
  function stopCustom() {
    customController?.dispose(); customController = null; clearTimeout(checkpointTimer);
    $('custom-stage').hidden = true; $('custom-stage').replaceChildren(); $('node-controls').hidden = true;
    $('custom-stage').classList.remove('logic-stage');
    document.body.classList.remove('custom-running');
  }
  function startCustom(node, expectedVisit) {
    const component = story.components.find(c => c.id === node.custom.component);
    if (location.protocol === 'file:') { notice('此作品包含自定义 Web 节点。请使用“启动作品”入口，或通过 HTTP 地址打开。'); return; }
    const epoch = generation; paused = false;
    $('custom-stage').hidden = false; $('node-controls').hidden = false; $('retry-node').hidden = true; $('pause-node').hidden = false; $('cancel-node').hidden = false;
    $('pause-node').textContent = '暂停交互'; $('node-status').textContent = '正在启动：' + component.label;
    $('custom-stage').classList.toggle('logic-stage', node.custom.mode === 'logic');
    document.body.classList.toggle('custom-running', node.custom.mode !== 'logic');
    const fail = message => {
      if (epoch !== generation) return;
      canvas.pause();
      customController?.dispose(); customController = null; $('custom-stage').hidden = true; document.body.classList.remove('custom-running');
      $('node-status').textContent = '交互未完成'; $('retry-node').hidden = false; $('pause-node').hidden = true; $('cancel-node').hidden = true; notice(message);
    };
    try {
      const url = new URL(`components/${component.id}/${component.entry.split('/').map(encodeURIComponent).join('/')}`, location.href);
      customController = globalThis.RusieNodeHost.mount({
        container: $('custom-stage'), url: url.href, input: session.input(), visit: expectedVisit, title: node.title, timeoutMs: node.custom.timeoutMs, startTimeoutMs: node.custom.startTimeoutMs,
        onReady() { if (epoch === generation) $('node-status').textContent = component.label; },
        onComplete(outcome, result) { if (epoch !== generation) throw new Error('交互已过期。'); return session.complete(outcome, result, expectedVisit); },
        onCheckpoint(data) { if (epoch !== generation) throw new Error('交互已过期。'); session.checkpoint(data, expectedVisit); clearTimeout(checkpointTimer); checkpointTimer = setTimeout(save, 400); },
        onCommitted() { save(); render(); }, onError: fail,
        onRejected(message) { if (epoch === generation) $('node-status').textContent = '结果未被接受：' + message; },
        onCanvas(command) {
          if (epoch !== generation) throw new Error('画布访问已过期。');
          const normalized = globalThis.RusieCanvasProtocol.normalize(command, { story, component,
            componentBase: new URL(`components/${component.id}/`, location.href).href,
            source: relative => preview ? `/media/${relative.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}` : relative
          });
          if (normalized.operation === 'clear') canvas.clear(normalized.layer);
          else canvas.set(normalized.layer, normalized.value);
        }
      });
      $('retry-node').onclick = () => render();
      $('pause-node').onclick = () => { paused = !paused; if (paused) { customController?.pause(); canvas.pause(); } else { customController?.resume(); canvas.resume(); } $('pause-node').textContent = paused ? '恢复交互' : '暂停交互'; $('node-status').textContent = paused ? '已暂停结果提交' : component.label; };
      $('cancel-node').onclick = () => customController?.cancel();
    } catch (error) { fail(error.message); }
  }
  function render() {
    const epoch = ++generation; stopCustom(); video = null; videoControl = null; pendingMedia = false;
    const state = session.snapshot(); const node = story.nodes.find(n => n.id === state.node);
    scene.prepare(node);
    $('node-title').textContent = node.title; $('node-text').textContent = node.presentation?.dialogue ? '' : node.text;
    $('eyebrow').textContent = node.ending ? 'THE END' : 'YOUR CHOICE, YOUR STORY';
    $('chapter-label').textContent = node.ending ? 'ENDING' : 'CHAPTER ' + String(story.nodes.indexOf(node) + 1).padStart(2, '0');
    $('path-label').textContent = preview ? '作者试玩 · 不影响正式存档' : '故事由你决定';
    $('position').textContent = `已作出 ${state.history.length} 次选择`;
    $('choices').replaceChildren(); $('media-gate').hidden = true; $('replay').hidden = !node.video; notice(storageWarning);
    if (!node.video) { finishMedia(node, state, epoch); return; }
    const asset = story.assets.find(a => a.id === node.video);
    pendingMedia = true; document.body.classList.add('playing');
    const current = () => epoch === generation;
    const gate = message => {
      if (!current()) return; document.body.classList.remove('playing'); $('media-gate').hidden = false; $('media-message').textContent = message;
    };
    const source = preview ? `/media/${asset.path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}` : asset.path;
    videoControl = canvas.play(source, {
      label: node.title,
      onEnded() { if (current()) { pendingMedia = false; finishMedia(node, state, epoch); } },
      onError() { gate('片段暂时无法播放，请检查素材是否完整，以及浏览器是否支持此视频编码。'); },
      onBlocked() { gate('点击下方按钮开始播放。若仍无法播放，请检查视频文件和编码。'); },
      onPlaying() { if (current()) { $('media-gate').hidden = true; document.body.classList.add('playing'); } }
    });
    video = videoControl.video;
    $('resume').onclick = () => { if (!current()) return; if (video.error) video.load(); void videoControl.play(); };
    $('replay').onclick = () => { if (current()) render(); };
  }
  $('restart').addEventListener('click', () => {
    if (!story) return;
    if (session.snapshot().history.length && !confirm('重新开始会清除本作品当前的选择进度，继续吗？')) return;
    canvas.reset(); session = createLocalSession(story, preview ? params.get('node') || story.start : story.start); save(); render();
  });
  window.addEventListener('pagehide', () => { if (session) save(); stopCustom(); canvas?.dispose(); });
  (async () => {
    try {
      let data;
      if (preview) {
        const response = await fetch('/api/project', { headers: { 'X-Rusie-Token': token || '' } });
        data = await response.json(); if (!response.ok) throw new Error(data.error);
      } else {
        const embedded = $('story-data'); if (!embedded) throw new Error('作品数据未打包。请从编辑器试玩，或先导出作品。');
        data = JSON.parse(embedded.textContent);
      }
      story = data.story; revision = data.revision; assertStory(story);
      canvas = globalThis.RusieCanvas.create({ picture: $('picture'), screen: document.querySelector('.screen'), notice, onEvent: event => customController?.notifyCanvas(event) });
      scene = globalThis.RusieScenePlayer.create(story, { canvas, preview, token });
      document.title = story.title; $('film-title').textContent = story.title;
      const start = preview ? params.get('node') || story.start : story.start;
      session = createLocalSession(story, start); storageKey = `rusie:${preview ? 'preview:' + start + ':' : ''}${story.id}:${revision}`;
      if (!preview) {
        try { const saved = localStorage.getItem(storageKey); if (saved) session.restore(JSON.parse(saved)); }
        catch { storageWarning = '旧进度无法恢复，已从故事开头开始。'; }
      }
      render();
    } catch (error) { document.body.classList.remove('playing'); $('node-title').textContent = '作品暂时无法打开'; $('node-text').textContent = error.message; }
  })();
})();
