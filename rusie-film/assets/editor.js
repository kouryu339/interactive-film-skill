(() => {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  let story, revision, directory, selected, dirty = false, busy = false, tab = 'story', conflict = false;
  let fileIssues = []; let drawing = false; let polling = false;
  let inspectorOpen = false, zoom = 1, graphWidth = 1, graphHeight = 1, fitted = false;
  let mediaPreviewVisit = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const status = message => { $('status').textContent = message; };
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function button(text, action, className = 'button small') { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node; }
  function field(label, control, help) { const wrap = el('label', 'field'); wrap.append(el('span', '', label), control); if (help) wrap.append(el('small', '', help)); return wrap; }
  function input(value, change, type = 'text') { const node = el('input'); node.type = type; node.value = String(value); node.addEventListener('input', () => change(node.value)); return node; }
  function select(entries, value, change) { const node = el('select'); for (const [id, label] of entries) { const option = el('option', '', label); option.value = id; node.append(option); } node.value = value; node.addEventListener('change', () => change(node.value)); return node; }
  function typedInput(value, change) {
    if (typeof value === 'boolean') return select([['true', '是 / true'], ['false', '否 / false']], String(value), v => change(v === 'true'));
    return input(value, v => { if (typeof value === 'number') { if (v.trim() && Number.isFinite(Number(v))) change(Number(v)); } else change(v); }, typeof value === 'number' ? 'number' : 'text');
  }
  function previewVideo(asset) {
    const visit = ++mediaPreviewVisit; assetUI.stopMedia();
    const video = $('media-preview-video'), message = $('media-preview-message');
    video.pause(); message.hidden = true; message.textContent = ''; $('media-preview-title').textContent = asset.label;
    video.src = `/media/${asset.path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
    $('media-preview-dialog').showModal();
    void video.play().catch(() => { if (visit !== mediaPreviewVisit || !$('media-preview-dialog').open || video.error) return; message.hidden = false; message.textContent = '点击播放按钮开始观看。'; });
  }
  const customUI = globalThis.RusieCustomEditor.create({ el, button, field, input, select, typedInput, status });
  const assetUI = globalThis.RusieAssetEditor.create({
    el, button, field, input, select, getStory: () => story, selectedNode: () => story?.nodes.find(node => node.id === selected), changed, save, status, renderVideos: renderMedia,
    openComponents: () => switchTab('components'), api, apply, setBusy, revision: () => revision, canImport: () => !dirty && !conflict,
    onError: error => { if (error.status === 409) showConflict(error.message); },
    previewComponent: component => { const node = story.nodes.find(node => node.custom?.component === component); if (!node) { status('请先在控件节点中添加并配置该组件的剧情节点，再预览。'); return; } selected = node.id; $('preview').click(); }
  });
  function changed() {
    if (story.data !== undefined || story.roles !== undefined || story.components !== undefined || story.catalog !== undefined || story.nodes.some(node => node.type === 'custom' || node.presentation !== undefined)) story.format = 'rusie.film/2';
    dirty = true; $('save-state').textContent = '有未保存修改';
    $('work-title').textContent = story.title; $('page-project').textContent = story.title; document.title = `${story.title} · Rusie`;
    if (!drawing) { drawing = true; requestAnimationFrame(() => { drawing = false; renderGraph(); renderOutline(); }); }
    $('issue-count').textContent = globalThis.RusieStory.inspect(story).length || '';
  }
  function setBusy(value) { busy = value; document.querySelector('main').inert = value; for (const id of ['save', 'preview', 'export', 'reload']) $(id).disabled = value; }
  function showConflict(message) { conflict = true; $('connection').hidden = false; $('conflict-message').textContent = message; }
  async function api(route, options = {}) {
    const response = await fetch(route, { ...options, headers: { 'X-Rusie-Token': token || '', ...options.headers } });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || '操作失败。'); error.status = response.status; throw error; }
    return result;
  }
  function apply(data) {
    if (!data.story || !Array.isArray(data.story.nodes) || !Array.isArray(data.story.assets) || !data.story.variables || typeof data.story.variables !== 'object') throw new Error('项目结构不完整，请让 Skill 修复 story.json 后重新载入。');
    assetUI.reset(); story = data.story; revision = data.revision; directory = data.directory || directory; fileIssues = data.issues || [];
    if (!story.nodes.some(n => n.id === selected)) selected = story.start;
    dirty = false; conflict = false; $('connection').hidden = true; $('save-state').textContent = '已保存到本地';
    $('work-title').textContent = story.title; $('page-project').textContent = story.title; document.title = `${story.title} · Rusie`;
    $('asset-count').textContent = story.assets.length + (story.catalog || []).filter(asset => asset.kind !== 'html').length + (story.components || []).length; $('node-count').textContent = String(story.nodes.length).padStart(2, '0');
    $('media-total').textContent = story.assets.length;
    $('issue-count').textContent = fileIssues.length || ''; renderOutline(); renderGraph(); renderInspector(); renderSettings();
    if (tab === 'media') assetUI.render(); if (tab === 'components') renderComponents();
  }
  async function load() { const data = await api('/api/project'); apply(data); status('已载入本地项目。可以编辑，也可以让 AI 修改同一份文件。'); }
  async function save() {
    if (!assetUI.flush()) return false;
    const invalid = document.querySelector('main :invalid');
    if (invalid) { invalid.reportValidity(); status('请先修正未完成的数据输入。'); return false; }
    if (!dirty) return true;
    if (conflict) { status('请先载入最新版本；可先下载草稿，交给 AI 合并。'); return false; }
    setBusy(true);
    try {
      const data = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story, revision }) });
      apply(data); status('项目已保存。'); return true;
    } catch (error) {
      status(error.message); if (error.status === 409) showConflict(error.message); return false;
    } finally { setBusy(false); }
  }
  function pick(id, toggle = false) { inspectorOpen = toggle && selected === id ? !inspectorOpen : true; selected = id; $('node-picker').open = false; renderOutline(); renderGraph(); renderInspector(); }
  function closeInspector(focus = false) { inspectorOpen = false; $('inspector').hidden = true; for (const card of $('cards').children) card.setAttribute('aria-expanded', 'false'); if (focus) [...$('cards').children].find(card => card.dataset.node === selected)?.focus({ preventScroll: true }); }
  function setZoom(next) {
    zoom = Math.max(.15, Math.min(2, next)); $('graph').style.transform = `scale(${zoom})`;
    $('graph-size').style.width = Math.ceil(graphWidth * zoom) + 'px'; $('graph-size').style.height = Math.ceil(graphHeight * zoom) + 'px';
    $('zoom-reset').textContent = Math.round(zoom * 100) + '%';
  }
  function fitGraph(initial = false) {
    const canvas = $('graph-scroll'); if (!canvas.clientWidth || !canvas.clientHeight) return;
    const fit = Math.min(1, (canvas.clientWidth - 36) / graphWidth, (canvas.clientHeight - 36) / graphHeight);
    setZoom(initial === true ? Math.max(.7, fit) : fit); canvas.scrollTo(0, 0); fitted = true;
  }
  function renderOutline() {
    if (!story) return; $('node-list').replaceChildren(); $('node-count').textContent = String(story.nodes.length).padStart(2, '0');
    story.nodes.forEach((node, index) => {
      const item = button('', () => pick(node.id), 'node-link'); item.setAttribute('aria-current', String(node.id === selected));
      item.append(el('span', '', String(index + 1).padStart(2, '0')), el('span', '', node.title), el('i', 'dot ' + (node.id === story.start ? 'start' : node.ending ? 'ending' : '')));
      $('node-list').append(item);
    });
  }
  function renderGraph() {
    if (!story) return;
    const depths = new Map([[story.start, 0]]); const queue = [story.start]; const nodes = new Map(story.nodes.map(n => [n.id, n]));
    while (queue.length) { const id = queue.shift(); for (const choice of nodes.get(id)?.choices || []) if (nodes.has(choice.target) && !depths.has(choice.target)) { depths.set(choice.target, Math.min(12, depths.get(id) + 1)); queue.push(choice.target); } }
    const rows = new Map(); const positions = new Map();
    for (const node of story.nodes) { const depth = depths.get(node.id) || 0; const row = rows.get(depth) || 0; positions.set(node.id, { x: 60 + depth * 500, y: 48 + row * 190 }); rows.set(depth, row + 1); }
    // Centre forks on their children while keeping each graph column collision-free.
    const maximumDepth = Math.max(...depths.values());
    for (let depth = maximumDepth; depth >= 0; depth--) {
      const column = story.nodes.filter(node => (depths.get(node.id) || 0) === depth);
      for (const node of column) {
        const children = [...new Set(node.choices.map(choice => choice.target))].filter(id => (depths.get(id) || 0) > depth);
        if (children.length) positions.get(node.id).y = children.reduce((total, id) => total + positions.get(id).y, 0) / children.length;
      }
      column.sort((a, b) => positions.get(a.id).y - positions.get(b.id).y);
      let last = -142;
      for (const node of column) { const position = positions.get(node.id); position.y = Math.max(position.y, last + 190); last = position.y; }
    }
    const width = Math.max(540, ...[...positions.values()].map(p => p.x + 370)); const height = Math.max(400, ...[...positions.values()].map(p => p.y + 180));
    graphWidth = width; graphHeight = height;
    $('graph').style.width = width + 'px'; $('graph').style.height = height + 'px';
    $('connections').setAttribute('width', width); $('connections').setAttribute('height', height); $('connections').replaceChildren(); $('cards').replaceChildren();
    $('edge-count').textContent = story.nodes.reduce((total, node) => total + node.choices.length, 0);
    const svg = (tag, values) => { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(values || {})) element.setAttribute(key, String(value)); return element; };
    const defs = svg('defs'); const marker = svg('marker', { id: 'edge-arrow', markerWidth: 9, markerHeight: 9, refX: 8, refY: 4, orient: 'auto' }); marker.append(svg('path', { d: 'M0,0 L8,4 L0,8', fill: '#9aab9d' })); defs.append(marker); $('connections').append(defs);
    for (const node of story.nodes) {
      const from = positions.get(node.id);
      for (const choice of node.choices || []) {
        const to = positions.get(choice.target); if (!to) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const sx = from.x + 310, sy = from.y + 66, tx = to.x, ty = to.y + 66;
        const bend = Math.max(30, Math.abs(tx - sx) * .5);
        line.setAttribute('d', `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`); line.setAttribute('marker-end', 'url(#edge-arrow)');
        if (node.id === selected || choice.target === selected) line.classList.add('active'); $('connections').append(line);
        const caption = choice.label.length > 10 ? choice.label.slice(0, 9) + '…' : choice.label;
        const labelWidth = Math.min(145, Math.max(60, caption.length * 11 + 20));
        const group = svg('g', { transform: `translate(${(sx + tx) / 2},${(sy + ty) / 2})` });
        group.append(svg('rect', { class: 'branch-label', x: -labelWidth / 2, y: -15, width: labelWidth, height: 27, rx: 13 }));
        const text = svg('text', { class: 'branch-text', 'text-anchor': 'middle', y: 3 }); text.textContent = caption;
        const title = svg('title'); title.textContent = choice.label; text.append(title); group.append(text); $('connections').append(group);
      }
      const card = button('', () => pick(node.id, true), 'node-card'); card.dataset.node = node.id; card.style.left = from.x + 'px'; card.style.top = from.y + 'px'; card.setAttribute('aria-pressed', String(node.id === selected)); card.setAttribute('aria-label', '查看节点：' + node.title); card.setAttribute('aria-expanded', String(node.id === selected && inspectorOpen));
      const meta = el('div', 'card-meta'); meta.append(el('i', 'dot ' + (node.id === story.start ? 'start' : node.ending ? 'ending' : '')), el('span', '', node.id === story.start ? '故事起点' : node.ending ? 'ENDING' : 'SCENE'));
      const bottom = el('div', 'card-bottom'); bottom.append(el('span', '', node.type === 'custom' ? '◇ 自定义节点' : node.video ? '▶ 已关联视频' : '文字片段'), el('span', '', node.ending ? '结局' : `${node.choices?.length || 0} 个${node.type === 'custom' ? '出口' : '选择'} ↗`));
      card.append(meta, el('h3', '', node.title), bottom); $('cards').append(card);
    }
    setZoom(zoom); if (!fitted && tab === 'story') requestAnimationFrame(() => fitGraph(true));
  }
  function renderInspector() {
    const node = story?.nodes.find(n => n.id === selected); const host = $('inspector');
    const opened = host.dataset.node === node?.id ? new Set([...host.querySelectorAll('details[open][data-section]')].map(details => details.dataset.section)) : new Set();
    host.replaceChildren(); host.hidden = !inspectorOpen; if (!node) return; host.dataset.node = node.id;
    const section = (key, label, className = '') => { const details = el('details', 'inspector-disclosure ' + className); details.dataset.section = key; details.open = opened.has(key); details.append(el('summary', '', label)); return details; };
    const heading = el('div', 'inspector-heading'); const close = button('×', () => closeInspector(true), 'inspector-close'); close.setAttribute('aria-label', '收起片段详情'); heading.append(el('h2', '', node.ending ? '结局内容' : '片段内容'), close); host.append(heading);
    host.append(field('片段标题', input(node.title, value => { node.title = value; changed(); })));
    const content = el('div', 'execution-summary');
    const row = (label, name, detail) => { const item = el('div', 'execution-row'); item.append(el('span', 'execution-label', label), el('strong', '', name)); if (detail) item.append(el('p', '', detail)); content.append(item); };
    const selectedVideo = story.assets.find(asset => asset.id === node.video);
    if (selectedVideo) {
      const item = el('div', 'execution-row'); item.append(el('span', 'execution-label', '播放视频'));
      const play = button('▶  ' + selectedVideo.label, () => previewVideo(selectedVideo), 'execution-play'); play.setAttribute('aria-label', '预览视频：' + selectedVideo.label);
      item.append(play); content.append(item);
    }
    const findAsset = id => (story.catalog || []).find(asset => asset.id === id);
    const background = findAsset(node.presentation?.background), portrait = findAsset(node.presentation?.portrait), dialogue = findAsset(node.presentation?.dialogue);
    if (background) row('设置背景', background.name);
    else if (node.presentation?.background === null) row('设置背景', '清空背景与上一视频尾帧');
    if (portrait) row('显示立绘', portrait.name);
    if (dialogue) { const lines = globalThis.RusieCatalog.dialogueLines(story, dialogue); row('经历对话', dialogue.name + ` · ${lines.length} 句`, lines.slice(0, 2).map(line => line.name + '：' + line.text).join('\n')); }
    else if (node.text) row(node.ending ? '结局文字' : '片段旁白', node.text.length > 90 ? node.text.slice(0, 90) + '…' : node.text);
    if (node.type === 'custom') row('进入交互', story.components?.find(component => component.id === node.custom.component)?.label || '尚未选择交互');
    if (!content.childElementCount) row('片段内容', '尚未配置画面或对话');
    host.append(content);
    const media = section('content', '编辑画面与对话', 'content-config');
    const videoSelect = select([['', '不播放视频'], ...story.assets.map(a => [a.id, a.label])], node.video || '', value => { node.video = value || null; changed(); renderInspector(); }); videoSelect.dataset.nodeField = 'video'; media.append(field('播放视频', videoSelect));
    for (const [kind, label] of [['background', '设置背景图'], ['portrait', '显示立绘'], ['dialogue', '经历对话']]) {
      const assets = (story.catalog || []).filter(asset => asset.kind === kind);
      const empty = kind === 'background' ? '沿用画布背景与视频尾帧' : '本节点不显示';
      const entries = [['', empty], ...(kind === 'background' ? [['__clear__', '清空背景与上一视频尾帧']] : []), ...assets.map(asset => [asset.id, asset.name])];
      const control = select(entries, kind === 'background' && node.presentation?.background === null ? '__clear__' : node.presentation?.[kind] || '', value => { node.presentation ||= {}; if (value === '__clear__') node.presentation[kind] = null; else if (value) node.presentation[kind] = value; else delete node.presentation[kind]; if (!Object.keys(node.presentation).length) delete node.presentation; changed(); renderInspector(); });
      control.dataset.nodeField = kind; media.append(field(label, control));
    }
    media.append(el('p', 'help', '未设置新背景时保留视频尾帧，直到下一视频首帧就绪。设置背景会在进入节点时切断上一尾帧。'), button('管理素材', () => switchTab('media'), 'text-button')); host.append(media);
    const advanced = section('advanced', '高级设置', 'node-advanced'); advanced.append(el('p', 'help', '节点标识：' + node.id));
    const text = el('textarea'); text.rows = 3; text.value = node.text; text.addEventListener('input', () => { node.text = text.value; changed(); }); advanced.append(field(node.ending ? '结局文字' : '片段旁白', text));
    advanced.append(field('片段类型', select([['scene', '剧情片段'], ['custom', '控件节点'], ['ending', '结局']], node.ending ? 'ending' : node.type === 'custom' ? 'custom' : 'scene', value => {
      if (value === 'ending' && node.choices.length && !confirm('改为结局将移除此片段的选项，继续吗？')) { renderInspector(); return; }
      node.ending = value === 'ending'; node.choices = node.ending ? [] : node.choices.length ? node.choices : [{ id: 'completed', label: '完成', target: story.start }];
      if (value === 'custom') { node.type = 'custom'; node.custom ||= { component: story.components?.[0]?.id || '', inputs: { graph: [], role: [], state: [] }, config: {}, result: {} }; }
      else { delete node.type; delete node.custom; for (const choice of node.choices) { delete choice.capture; if (choice.when?.source === 'lastNode.output') delete choice.when; } }
      changed(); renderInspector();
    })));
    if (node.type === 'custom') advanced.append(customUI.nodeFields(story, node, changed, renderInspector));
    if (!node.ending) {
      const choicesHeader = el('div', 'section-heading'); choicesHeader.append(el('h2', '', node.type === 'custom' ? '结果出口' : '观众的选择'), el('span', '', `${node.choices.length} / 20`)); host.append(choicesHeader);
      node.choices.forEach((choice, index) => {
        const panel = section('choice-' + choice.id, choice.label, 'choice-editor');
        const destination = story.nodes.find(target => target.id === choice.target)?.title || '目标未设置';
        panel.querySelector('summary').append(el('small', 'choice-destination', '→ ' + destination + (choice.when ? ' · 有条件' : '')));
        const fields = el('div', 'choice-fields'); const header = el('div', 'choice-heading');
        header.append(el('span', '', `选择 ${String(index + 1).padStart(2, '0')}`), button('移除', () => { node.choices.splice(index, 1); changed(); renderInspector(); }, 'text-button')); fields.append(header); panel.append(fields);
        fields.append(field('选项文字', input(choice.label, value => { choice.label = value; changed(); })));
        fields.append(field('前往片段', select(story.nodes.map(n => [n.id, n.title]), choice.target, value => { choice.target = value; changed(); })));
        const logic = section('logic-' + choice.id, '条件与变量', 'choice-logic');
        if (node.type === 'custom') logic.append(customUI.choiceFields(story, node, choice, changed));
        const outputFields = node.type === 'custom' ? Object.entries(node.custom.result).filter(([, spec]) => spec.type !== 'json') : [];
        const conditionValue = choice.when?.source === 'lastNode.output' ? 'output:' + choice.when.field : choice.when?.variable || '';
        logic.append(field(node.type === 'custom' ? '出边条件' : '显示条件', select([['', '始终匹配'], ...Object.keys(story.variables).map(key => [key, key + ' 等于…']), ...outputFields.map(([key]) => ['output:' + key, 'lastNode.output.' + key + ' 等于…'])], conditionValue, value => {
          if (value.startsWith('output:')) { const key = value.slice(7), type = node.custom.result[key].type; choice.when = { source: 'lastNode.output', field: key, equals: type === 'string' ? '' : type === 'number' ? 0 : false }; }
          else if (value) choice.when = { variable: value, equals: story.variables[value] }; else delete choice.when; changed(); renderInspector();
        })));
        if (choice.when) logic.append(field('条件值', typedInput(choice.when.equals, value => { choice.when.equals = value; changed(); })));
        const effects = el('div'); effects.append(el('p', 'help', '选择后修改变量'));
        for (const [key, value] of Object.entries(choice.set || {})) {
          const row = el('div', 'row'); const control = typedInput(value, next => { choice.set[key] = next; changed(); }); control.classList.add('inline-input');
          row.append(el('span', 'pill', key), control, button('移除', () => { delete choice.set[key]; if (!Object.keys(choice.set).length) delete choice.set; changed(); renderInspector(); }, 'text-button')); effects.append(row);
        }
        const remaining = Object.keys(story.variables).filter(key => !Object.hasOwn(choice.set || {}, key) && !Object.hasOwn(choice.capture || {}, key));
        if (remaining.length) { const add = select([['', '＋ 选择要修改的变量'], ...remaining.map(key => [key, key])], '', key => { if (!key) return; choice.set = { ...choice.set, [key]: story.variables[key] }; changed(); renderInspector(); }); add.className = 'inline-input'; effects.append(add); }
        logic.append(effects); fields.append(logic); host.append(panel);
      });
      const add = button('＋ 添加选项', () => { if (node.choices.length >= 20) return; node.choices.push({ id: 'choice-' + crypto.randomUUID().slice(0, 8), label: '新的选择', target: story.start }); changed(); renderInspector(); }); add.style.marginTop = '13px'; add.disabled = node.choices.length >= 20; host.append(add);
    } else host.append(el('p', 'help', '观众到达此片段后结束本次故事，可以重新开始探索其他分支。'));
    const actions = el('div', 'inspector-actions');
    actions.append(button('设为故事起点', () => { story.start = node.id; changed(); renderInspector(); }), button('删除片段', () => {
      if (story.start === node.id) { status('请先把其他片段设为故事起点。'); return; }
      const inbound = story.nodes.filter(n => n.id !== node.id && n.choices.some(c => c.target === node.id));
      if (inbound.length) { status(`请先修改指向此片段的选项：${inbound.map(n => n.title).join('、')}`); return; }
      if ((story.catalog || []).some(asset => asset.nodes?.includes(node.id))) { status('此节点仍被资产关联，请先在资产配置中解除关联。'); return; }
      if (!confirm(`删除“${node.title}”？`)) return;
      story.nodes = story.nodes.filter(n => n.id !== node.id); selected = story.start; changed(); renderInspector();
    }, 'button small danger')); advanced.append(actions); host.append(advanced);
  }
  function renderMedia() {
    $('media-grid').querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); }); $('media-grid').replaceChildren();
    if (!story.assets.length) { $('media-grid').append(el('div', 'media-empty', '还没有视频素材。\n导入 MP4 后，即可在片段详情中关联画面。')); return; }
    for (const asset of story.assets.filter(asset => (asset.label + asset.id).toLowerCase().includes($('asset-search').value.toLowerCase()))) {
      const card = el('article', 'media-card'); const video = el('video'); video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.setAttribute('aria-label', asset.label);
      video.src = `/media/${asset.path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
      const info = el('div', 'media-info'); const used = story.nodes.filter(n => n.video === asset.id);
      info.append(el('strong', '', asset.label), el('p', '', used.length ? `用于 ${used.map(n => n.title).join('、')}` : '尚未关联片段'));
      video.addEventListener('error', () => { info.append(el('p', 'help', '无法播放，请检查文件与编码。')); }, { once: true });
      info.append(button('播放视频', () => previewVideo(asset)), button('用于当前片段', () => { const node = story.nodes.find(n => n.id === selected); if (node) { node.video = asset.id; changed(); switchTab('story'); status(`已将视频关联到“${node.title}”，请保存。`); } }));
      card.append(video, info); $('media-grid').append(card);
    }
  }
  function renderSettings() {
    if (!story) return;
    $('project-fields').replaceChildren(field('作品名称', input(story.title, value => { story.title = value; changed(); })), field('故事起点', select(story.nodes.map(n => [n.id, n.title]), story.start, value => { story.start = value; changed(); })));
    $('project-directory').textContent = '项目目录：' + directory;
    $('variables').replaceChildren();
    for (const [key, value] of Object.entries(story.variables)) {
      const row = el('div', 'variable-row');
      const name = input(key, () => {}); name.className = 'inline-input'; name.setAttribute('aria-label', '变量名称');
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (next === key) return;
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(next) || ['constructor', 'prototype'].includes(next) || Object.hasOwn(story.variables, next)) { name.value = key; status('变量名需唯一，以英文字母开头，只含字母、数字、短横线或下划线。'); return; }
        story.variables[next] = story.variables[key]; delete story.variables[key];
        for (const node of story.nodes) {
          if (node.custom) node.custom.inputs.state = node.custom.inputs.state.map(k => k === key ? next : k);
          for (const choice of node.choices) { if (choice.when?.variable === key) choice.when.variable = next; if (choice.set && Object.hasOwn(choice.set, key)) { choice.set[next] = choice.set[key]; delete choice.set[key]; } if (choice.capture && Object.hasOwn(choice.capture, key)) { choice.capture[next] = choice.capture[key]; delete choice.capture[key]; } }
        }
        changed(); renderSettings(); renderInspector();
      });
      const type = select([['boolean', '是 / 否'], ['number', '数字'], ['string', '文字']], typeof value, next => {
        const used = story.nodes.some(n => n.custom?.inputs.state.includes(key) || n.choices.some(c => c.when?.variable === key || Object.hasOwn(c.set || {}, key) || Object.hasOwn(c.capture || {}, key)));
        if (used) { status('此变量正在被选项引用，请先移除引用再修改类型。'); renderSettings(); return; }
        story.variables[key] = next === 'boolean' ? false : next === 'number' ? 0 : ''; changed(); renderSettings(); renderInspector();
      }); type.className = 'inline-input'; type.setAttribute('aria-label', key + ' 的类型');
      const initial = typedInput(value, next => { story.variables[key] = next; changed(); }); initial.className = 'inline-input'; initial.setAttribute('aria-label', key + ' 的初始值');
      row.append(name, type, initial, button('×', () => {
        if (story.nodes.some(n => n.custom?.inputs.state.includes(key) || n.choices.some(c => c.when?.variable === key || Object.hasOwn(c.set || {}, key) || Object.hasOwn(c.capture || {}, key)))) { status('此变量仍被节点引用，请先移除条件、读取或赋值。'); return; }
        delete story.variables[key]; changed(); renderSettings(); renderInspector();
      }, 'text-button')); $('variables').append(row);
    }
    if (!Object.keys(story.variables).length) $('variables').append(el('p', 'help', '暂时没有变量。简单分支故事不需要变量。'));
    $('definition-settings').replaceChildren(...customUI.settings(story, changed, () => { renderSettings(); renderInspector(); }));
  }
  function renderComponents() {
    $('component-list').replaceChildren(customUI.components(story, component => {
      const id = 'custom-' + crypto.randomUUID().slice(0, 8);
      story.nodes.push({ id, title: component.label, text: '', video: null, ending: false, type: 'custom', custom: { component: component.id, inputs: { graph: [], role: [], state: [] }, config: {}, result: {} }, choices: [{ id: 'completed', label: '完成', target: story.start }] });
      selected = id; changed(); switchTab('story');
    }, async id => {
      if (dirty || conflict) { status('请先保存项目或处理冲突，再登记扩展包。'); return; }
      setBusy(true);
      try { const result = await api('/api/components/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, revision }) }); apply(result); status('扩展包已登记，可添加为自定义节点。'); }
      catch (error) { status(error.message); if (error.status === 409) showConflict(error.message); }
      finally { setBusy(false); }
    }));
  }
  function switchTab(next) {
    if (assetUI.hasDraft() && !assetUI.flush()) return;
    tab = next; for (const name of ['story', 'media', 'settings', 'components']) $(name + '-view').hidden = name !== next;
    document.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.tab === next)));
    $('page-title').textContent = { story: '故事全图', media: '资产配置', components: '控件节点', settings: '项目定义' }[next];
    if (next === 'media') assetUI.render(); else assetUI.stopMedia();
    if (next === 'settings') renderSettings(); if (next === 'story') renderInspector();
    if (next === 'components') renderComponents();
  }
  function showIssues(issues, draft = false) {
    $('issues').replaceChildren();
    if (!issues.length) $('issues').append(el('p', '', draft ? '草稿结构检查通过。保存后再次检查本地素材文件，并通过试玩确认实际播放。' : '检查通过。素材引用完整，剧情结构有效。浏览器实际播放仍需试玩确认。'));
    for (const issue of issues) {
      const item = el('div', 'issue ' + issue.level, `${issue.level === 'error' ? '需修复' : '提示'} · ${issue.message}`);
      if (issue.node) item.append(button('查看片段', () => { $('issues-dialog').close(); switchTab('story'); pick(issue.node); })); $('issues').append(item);
    }
    $('issues-dialog').showModal();
  }
  $('add-node').addEventListener('click', () => { if (!story) return; if (story.nodes.length >= 500) { status('最多支持 500 个片段。'); return; } const id = 'scene-' + crypto.randomUUID().slice(0, 8); story.nodes.push({ id, title: '新的片段', text: '', video: null, ending: true, choices: [] }); selected = id; inspectorOpen = true; changed(); renderInspector(); });
  $('add-variable').addEventListener('click', () => { if (Object.keys(story.variables).length >= 100) return; let n = 1; while (Object.hasOwn(story.variables, 'flag' + n)) n++; story.variables['flag' + n] = false; changed(); renderSettings(); renderInspector(); });
  $('save').addEventListener('click', () => void save());
  $('preview').addEventListener('click', async () => { if (!story || busy || !(await save())) return; $('preview-frame').src = `/player.html?preview=1#token=${encodeURIComponent(token)}&node=${encodeURIComponent(selected || story.start)}`; $('preview-dialog').showModal(); });
  $('preview-nav').addEventListener('click', () => $('preview').click());
  $('fit-graph').addEventListener('click', fitGraph);
  $('zoom-out').addEventListener('click', () => setZoom(zoom - .1));
  $('zoom-in').addEventListener('click', () => setZoom(zoom + .1));
  $('zoom-reset').addEventListener('click', () => setZoom(1));
  $('graph-scroll').addEventListener('click', event => { if (!event.target.closest('.node-card')) closeInspector(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeInspector(true); $('node-picker').open = false; } });
  $('close-preview').addEventListener('click', () => $('preview-dialog').close());
  $('preview-dialog').addEventListener('close', () => { $('preview-frame').src = 'about:blank'; });
  $('close-media-preview').addEventListener('click', () => $('media-preview-dialog').close());
  $('media-preview-dialog').addEventListener('close', () => { ++mediaPreviewVisit; const video = $('media-preview-video'); video.pause(); video.removeAttribute('src'); video.load(); });
  $('media-preview-video').addEventListener('error', () => { if (!$('media-preview-dialog').open) return; $('media-preview-message').hidden = false; $('media-preview-message').textContent = '视频无法播放，请检查素材文件和编码。'; });
  $('close-issues').addEventListener('click', () => $('issues-dialog').close());
  $('check').addEventListener('click', async () => {
    if (!story) return;
    if (dirty) { showIssues(globalThis.RusieStory.inspect(story), true); return; }
    try { const data = await api('/api/project'); if (data.revision !== revision) { showConflict('项目文件已更新，请先载入最新版本。'); return; } fileIssues = data.issues; showIssues(fileIssues); }
    catch (error) { status(error.message); }
  });
  $('export').addEventListener('click', async () => {
    if (!story || busy || !(await save())) return;
    setBusy(true); status('正在检查并复制作品素材…');
    try {
      const data = await api('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }) });
      $('issues').replaceChildren(el('h2', '', '作品已导出'), el('p', 'help', data.requiresHTTP ? '本作品包含自定义节点。请分享整个目录，使用“启动作品”入口；需要 Node.js 20+。部署到网站时按启动说明配置资源加载。' : '将整个目录分享给观众，打开 index.html 即可游玩。也可把该目录部署到静态网站。'), el('p', 'path', data.output));
      $('issues-dialog').showModal(); status('作品已导出：' + data.output);
    } catch (error) { status(error.message); if (error.status === 409) showConflict(error.message); }
    finally { setBusy(false); }
  });
  $('upload').addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
    if (dirty || conflict) { status('请先保存项目或处理版本冲突，再导入视频。'); return; }
    setBusy(true);
    try {
      for (const file of files) {
        if (file.size > 512 * 1024 * 1024) throw new Error(`${file.name} 超过 512 MB。`);
        status('正在导入：' + file.name);
        const result = await api('/api/media?name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-Project-Revision': revision }, body: file }); apply(result);
      }
      status('视频已复制到项目，选择一个素材即可关联到当前片段。');
    } catch (error) { status(error.message); if (error.status === 409) showConflict(error.message); }
    finally { setBusy(false); }
  });
  $('reload').addEventListener('click', async () => { if (dirty && !confirm('载入最新版本会放弃当前网页中的未保存修改。可先下载草稿。继续吗？')) return; try { assetUI.reset(); await load(); } catch (error) { status(error.message); } });
  $('download').addEventListener('click', () => { if (!story || !assetUI.flush()) return; const url = URL.createObjectURL(new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = 'rusie-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  document.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => { if (story) switchTab(node.dataset.tab); }));
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (story) switchTab('story'); });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!busy && story) void save(); } });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(async () => {
    if (busy || polling || !revision || conflict || document.hidden) return;
    polling = true;
    const requestedRevision = revision;
    try {
      const data = await api('/api/project?poll=1&revision=' + encodeURIComponent(requestedRevision));
      if (busy || conflict || revision !== requestedRevision) return;
      if (data.unchanged) return;
      if (data.revision !== revision) { if (dirty) showConflict('AI 或另一个窗口更新了项目。请保留草稿后载入最新版本。'); else { apply(data); status('已同步本地文件的最新修改。'); } }
    } catch (error) { status('本地连接或项目读取异常：' + error.message); }
    finally { polling = false; }
  }, 3000);
  void load().catch(error => { status(error.message); showConflict('无法读取项目。请确认启动工具仍在运行，并使用它给出的完整地址打开。'); });
})();
