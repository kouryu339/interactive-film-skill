/* Persistent canvas. Graph/node disposal never implicitly clears a video tail. */
(() => {
  const names = ['background', 'video', 'portrait', 'dialogue'];
  function create({ picture, screen, notice = () => {}, renderers = {}, onEvent = () => {} }) {
    const roots = {}, values = {}, cleanups = {}, revisions = {};
    let generation = 0, current = null, pending = null, paused = false;
    for (const name of names) {
      const root = screen.ownerDocument.createElement('div'); root.className = 'canvas-layer canvas-' + name; root.dataset.canvasLayer = name;
      (['background', 'video'].includes(name) ? picture : screen).append(root); roots[name] = root; revisions[name] = 0;
    }
    function removeVideo(record) {
      if (!record) return;
      if (record.frameCallback !== undefined) record.video.cancelVideoFrameCallback?.(record.frameCallback);
      record.video.pause(); record.video.removeAttribute('src'); record.video.load(); record.element.remove(); record.dispose?.();
    }
    function clearVideo() { generation++; removeVideo(pending); pending = null; removeVideo(current); current = null; }
    function clear(name) {
      if (!names.includes(name)) throw new Error('未知画布图层。');
      if (name === 'video') { clearVideo(); return; }
      revisions[name]++; const cleanup = cleanups[name];
      if (typeof cleanup === 'function') cleanup(); else cleanup?.dispose?.();
      delete cleanups[name]; delete values[name]; roots[name].replaceChildren();
      if (name === 'dialogue') screen.ownerDocument.body.classList.remove('dialogue-running');
    }
    function image(name, value) {
      const img = screen.ownerDocument.createElement('img'); img.className = name === 'background' ? 'scene-background' : 'scene-portrait';
      img.alt = value.alt || ''; img.src = value.source;
      img.addEventListener('error', () => { if (img.isConnected) notice('画布图片无法加载，请检查素材。'); }, { once: true }); roots[name].append(img);
    }
    function dialogue(value, done) {
      const lines = value.lines || []; if (!lines.length) { done(); return; }
      const document = screen.ownerDocument, box = document.createElement('section'); box.id = 'scene-dialogue'; box.className = 'scene-dialogue'; box.setAttribute('aria-label', value.label || '对话');
      const speaker = document.createElement('strong'); speaker.className = 'dialogue-speaker';
      const text = document.createElement('p'); text.className = 'dialogue-text'; text.setAttribute('aria-live', 'polite');
      const footer = document.createElement('div'); footer.className = 'dialogue-footer';
      const progress = document.createElement('span'); progress.className = 'dialogue-progress';
      const button = document.createElement('button'); button.type = 'button'; button.id = 'dialogue-next'; button.className = 'dialogue-next';
      let index = 0, finished = false;
      const update = () => { speaker.textContent = lines[index].name || ''; text.textContent = lines[index].text; progress.textContent = `${index + 1} / ${lines.length}`; button.textContent = index === lines.length - 1 ? '结束对话' : '继续'; };
      button.addEventListener('click', () => { if (finished || paused) return; if (++index < lines.length) { update(); return; } finished = true; box.remove(); done(); });
      footer.append(progress, button); box.append(speaker, text, footer); roots.dialogue.append(box); update();
    }
    function styles(name, style) {
      if (style === undefined) return;
      if (!style || typeof style !== 'object' || Array.isArray(style) || Object.values(style).some(value => typeof value !== 'string')) throw new Error('图层样式需要 CSS 属性与字符串值。');
      for (const [key, value] of Object.entries(style)) roots[name].style.setProperty(key, value);
    }
    function set(name, value, { onDone = () => {} } = {}) {
      if (!names.includes(name)) throw new Error('未知画布图层。');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图层描述需要是对象。');
      // A background command is a scene cut, even when a pre-video follows.
      if (name === 'background' && Object.hasOwn(value, 'source')) clearVideo();
      styles(name, value.style);
      if (name === 'video') { if (value.source) return play(value.source, value); return; }
      if (!Object.hasOwn(value, 'source') && !Object.hasOwn(value, 'lines')) return;
      clear(name); values[name] = { ...value }; const revision = revisions[name];
      const done = () => { if (revisions[name] !== revision) return; if (name === 'dialogue') screen.ownerDocument.body.classList.remove('dialogue-running'); onDone(); };
      if (name === 'dialogue' && value.lines?.length) screen.ownerDocument.body.classList.add('dialogue-running');
      const renderer = renderers[name];
      if (renderer) cleanups[name] = renderer({ root: roots[name], value, done });
      else if (name === 'dialogue') dialogue(value, done);
      else if (value.source) image(name, value);
      else done();
    }
    function play(source, handlers = {}) {
      const epoch = ++generation; removeVideo(pending); pending = null;
      const created = renderers.video?.({ root: roots.video, source }) || { video: screen.ownerDocument.createElement('video') };
      const video = created.video, element = created.element || video;
      if (!video || video.tagName !== 'VIDEO' || !element?.style) throw new Error('视频渲染器需要返回 video 元素与可选外层 element。');
      const record = { video, element, dispose: created.dispose, pauseHook: created.pause, resumeHook: created.resume, state: 'loading', frameCallback: undefined, resume: false };
      pending = record; video.playsInline = true; video.controls = true; video.preload = 'auto'; video.setAttribute('aria-label', handlers.label || '视频');
      element.style.opacity = '0'; element.dataset.canvasVideo = 'pending'; roots.video.append(element); video.src = source;
      const valid = () => epoch === generation && (pending === record || current === record);
      const show = () => {
        if (!valid() || pending !== record || !video.videoWidth || video.readyState < 2) return;
        const previous = current; current = record; pending = null; record.state = 'playing';
        element.style.opacity = '1'; element.dataset.canvasVideo = 'current'; removeVideo(previous); onEvent({ layer: 'video', phase: 'frame' }); handlers.onFrame?.();
      };
      if (video.requestVideoFrameCallback) record.frameCallback = video.requestVideoFrameCallback(show);
      else video.addEventListener('playing', show, { once: true });
      video.addEventListener('playing', () => { if (valid()) handlers.onPlaying?.(); });
      video.addEventListener('ended', () => {
        if (!valid()) return; show(); record.state = 'tail'; element.dataset.canvasVideo = 'tail'; video.controls = false; onEvent({ layer: 'video', phase: 'ended' }); handlers.onEnded?.();
      });
      video.addEventListener('error', () => { if (valid()) { onEvent({ layer: 'video', phase: 'error' }); handlers.onError?.(); } });
      const start = async () => {
        if (!valid()) return;
        try { await video.play(); } catch { if (valid()) { onEvent({ layer: 'video', phase: 'blocked' }); handlers.onBlocked?.(); } }
      };
      void start(); return { video, play: start };
    }
    function enter() {
      generation++; removeVideo(pending); pending = null;
      // Keep the visible media node/decoder, rather than redrawing its tail to a bitmap.
      if (current) { current.video.pause(); current.video.controls = false; current.state = 'tail'; current.element.dataset.canvasVideo = 'tail'; }
      clear('portrait'); clear('dialogue');
      if (paused) for (const cleanup of Object.values(cleanups)) cleanup?.resume?.();
      paused = false;
    }
    function reset() { for (const name of names) { clear(name); roots[name].removeAttribute('style'); } paused = false; }
    return {
      roots: Object.freeze({ ...roots }), enter, set, clear, play, reset,
      override(name, renderer) {
        if (!names.includes(name) || typeof renderer !== 'function') throw new Error('覆写需要有效图层和渲染函数。');
        renderers[name] = renderer;
      },
      pause() { paused = true; for (const cleanup of Object.values(cleanups)) cleanup?.pause?.(); for (const record of [current, pending]) if (record) { record.pauseHook?.(); record.resume = !record.video.paused && !record.video.ended; record.video.pause(); } },
      resume() { paused = false; for (const cleanup of Object.values(cleanups)) cleanup?.resume?.(); for (const record of [current, pending]) if (record) { record.resumeHook?.(); if (record.resume) { record.resume = false; void record.video.play().catch(() => notice('点击播放以恢复视频。')); } } },
      dispose() { reset(); for (const root of Object.values(roots)) root.remove(); },
      snapshot() { return { video: current?.state || 'empty', pendingVideo: !!pending, background: !!values.background, portrait: !!values.portrait, dialogue: !!roots.dialogue.childElementCount }; }
    };
  }
  globalThis.RusieCanvas = Object.freeze({ create });
})();
