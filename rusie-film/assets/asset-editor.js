(() => {
  function create(ui) {
    const { el, button, field, select, getStory, selectedNode, changed, save, status, renderVideos, previewComponent, openComponents, api, apply, setBusy, canImport } = ui;
    const $ = id => document.getElementById(id);
    const kinds = { mp4: 'MP4', html: globalThis.RusieCatalog.kinds.html, ...globalThis.RusieCatalog.kinds };
    let category = 'mp4', search = '', draft = null, editingId = null, draftDirty = false;
    const url = relative => `/media/${relative.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(new URLSearchParams(location.hash.slice(1)).get('token') || '')}`;
    const stopMedia = () => $('media-view').querySelectorAll('audio,video').forEach(media => media.pause());
    const textField = (label, key, multiline = false) => {
      const control = multiline ? el('textarea') : el('input'); control.value = draft[key] || ''; control.dataset.assetField = key;
      if (multiline) control.rows = key === 'text' ? 9 : 3;
      control.addEventListener('input', () => { draft[key] = control.value; draftDirty = true; changed(); });
      return field(label, control);
    };
    function rows() {
      const story = getStory();
      if (category === 'html') {
        const registered = (story.catalog || []).filter(asset => asset.kind === 'html');
        return [...registered, ...(story.components || []).filter(component => !registered.some(asset => asset.component === component.id)).map(component => ({ id: 'component-' + component.id, component: component.id, kind: 'html', name: component.label, virtual: true }))];
      }
      return (story.catalog || []).filter(asset => asset.kind === category);
    }
    function start(asset) {
      if (draftDirty && !confirm('放弃尚未保存的资产编辑？')) return;
      draft = asset ? structuredClone(asset) : { id: 'asset-' + crypto.randomUUID().slice(0, 8), kind: category, name: '', ...(['script', 'item', 'dialogue'].includes(category) ? { text: '' } : {}) };
      if (asset?.virtual) draft.id = 'asset-' + crypto.randomUUID().slice(0, 8);
      if (draft.kind === 'dialogue' && Array.isArray(draft.lines)) { draft.text = draft.lines.map(line => line.speaker + '：' + line.text).join('\n'); delete draft.lines; }
      editingId = asset?.virtual ? null : asset?.id || null; delete draft.virtual;
      draftDirty = false; renderForm(); $('asset-form').scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    function flush() {
      if (!draft || !draftDirty) return true;
      const story = getStory(), next = structuredClone(draft);
      if (!globalThis.RusieCustom.safeId(next.id)) { status('资产 code 需要以字母开头，只含字母、数字、下划线或短横线。'); return false; }
      if (editingId !== next.id && (story.catalog || []).some(asset => asset.id === next.id)) { status('资产 code 已存在。'); return false; }
      next.name = next.name.trim(); if (!next.name) { status('请填写资产名称。'); return false; }
      const candidate = structuredClone(story); candidate.format = 'rusie.film/2'; candidate.catalog = (candidate.catalog || []).filter(asset => asset.id !== editingId); candidate.catalog.push(next);
      const errors = globalThis.RusieStory.inspect(candidate).filter(issue => issue.level === 'error');
      if (errors.length) { status(errors.map(error => error.message).join('；')); return false; }
      story.format = candidate.format; story.catalog = candidate.catalog; editingId = next.id; draftDirty = false; changed(); return true;
    }
    function renderForm() {
      const host = $('asset-form'); host.replaceChildren(); host.hidden = !draft; if (!draft) return;
      const story = getStory(); const header = el('div', 'asset-form-header'); header.append(el('strong', '', editingId ? '编辑资产' : '新建资产'), button('关闭', () => {
        if (draftDirty && !confirm('放弃尚未保存的资产编辑？')) return; draft = null; draftDirty = false; renderForm();
      })); host.append(header);
      const fields = el('div', 'asset-fields');
      const needsFile = ['audio', 'background', 'portrait'].includes(category) && !draft.path;
      if (needsFile) fields.append(el('p', 'help', '先导入文件，系统将登记资产，再编辑名称和关联。'));
      else fields.append(textField('code', 'id'), textField('名称', 'name'));
      if (!needsFile && ['script', 'portrait', 'dialogue'].includes(category)) fields.append(field('所属角色', select([['', '公共 / 旁白'], ...Object.entries(story.roles || {}).map(([id, role]) => [id, role.name])], draft.role || '', value => { if (value) draft.role = value; else delete draft.role; draftDirty = true; changed(); })));
      if (['script', 'item', 'dialogue'].includes(category)) fields.append(textField(category === 'script' ? '故事／台本（Markdown）' : category === 'dialogue' ? '台词正文（每行可写：角色名：台词）' : '道具描述', 'text', true));
      if (category === 'html') {
        fields.append(field('完整 HTML／游戏组件包', select([['', '请选择已登记的组件'], ...(story.components || []).map(component => [component.id, component.label])], draft.component || '', value => { draft.component = value; draftDirty = true; changed(); })));
        fields.append(el('p', 'help', 'HTML 包含入口、脚本与资源，通过现有隔离节点预览和运行。可先到“扩展节点”登记完整目录，登记后会自动出现在这里。'));
        fields.append(button('登记组件包', openComponents));
      }
      if (globalThis.RusieCatalog.fileTypes[category]) {
        const label = el('label', 'field'); label.append(el('span', '', category === 'item' ? '道具图片（可选）' : '导入本地文件'));
        const file = el('input'); file.type = 'file'; file.dataset.assetField = 'file'; file.accept = globalThis.RusieCatalog.fileTypes[category].map(extension => '.' + extension).join(',');
        file.addEventListener('change', async () => {
          if (!file.files[0]) return;
          if (draftDirty) { status('请先保存当前资产文字，再导入或替换文件。'); file.value = ''; return; }
          await upload(file.files[0], draft.kind, true); file.value = '';
        }); label.append(file); fields.append(label);
        if (draft.path) fields.append(el('p', 'help path', draft.path));
      }
      if (['script', 'dialogue'].includes(category)) {
        const label = el('label', 'field'); label.append(el('span', '', '导入文本文件')); const file = el('input'); file.type = 'file'; file.accept = '.md,.txt';
        file.addEventListener('change', async () => { const source = file.files[0], target = draft; if (!source) return; if (source.size > 600000) { status('文本文件最多 600 KB。'); return; } const text = await source.text(); if (draft !== target) return; draft.text = text; if (!draft.name) draft.name = source.name; draftDirty = true; changed(); renderForm(); }); label.append(file); fields.append(label);
      }
      const nodes = el('fieldset', 'asset-node-bindings'); nodes.hidden = needsFile; nodes.append(el('legend', '', '关联剧情节点（创作参考）'));
      for (const node of story.nodes) {
        const check = el('input'); check.type = 'checkbox'; check.checked = (draft.nodes || []).includes(node.id);
        check.addEventListener('change', () => { draft.nodes = check.checked ? [...draft.nodes || [], node.id] : (draft.nodes || []).filter(id => id !== node.id); draftDirty = true; changed(); });
        const label = el('label'); label.append(check, el('span', '', node.title)); nodes.append(label);
      }
      host.append(fields, nodes, el('p', 'help', '这里的节点关联仅记录创作引用。背景、立绘和对话需在片段内容中选用才会显示；道具与音频仍由剧情或自定义节点控制。'));
      const footer = el('div', 'asset-form-footer'); const submit = button('保存资产', async () => { draftDirty = true; if (flush() && await save()) { draft = null; editingId = null; render(); status('资产已保存到项目。'); } }, 'button accent'); submit.disabled = needsFile; footer.append(submit);
      if (editingId) footer.append(button('删除资产记录', () => { if (story.nodes.some(node => Object.values(node.presentation || {}).includes(editingId))) { status('此资产正在片段中播放，请先在片段内容中解除配置。'); return; } if (!confirm('删除这条资产记录？磁盘源文件保留。')) return; story.catalog = (story.catalog || []).filter(asset => asset.id !== editingId); draft = null; editingId = null; draftDirty = false; changed(); render(); }, 'button danger'));
      host.append(footer);
    }
    async function upload(file, kind = category, replace = false) {
      if (!canImport()) { status('请先保存项目或处理版本冲突，再导入文件。'); return; }
      if (file.size > 64 * 1024 * 1024) { status('音频或图片最多 64 MB。'); return; }
      const previous = replace && draft ? structuredClone(draft) : null, previousId = editingId;
      setBusy(true);
      try {
        const result = await api(`/api/catalog-file?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Project-Revision': ui.revision() }, body: file });
        draft = null; draftDirty = false; apply(result);
        if (previous) {
          const story = getStory(); story.catalog = story.catalog.filter(asset => asset.id !== result.asset.id); previous.path = result.asset.path; previous.name ||= result.asset.name;
          if (previousId) story.catalog = story.catalog.filter(asset => asset.id !== previousId);
          story.catalog.push(previous); changed(); draft = previous; editingId = previous.id; draftDirty = false;
        } else { draft = structuredClone(result.asset); editingId = result.asset.id; }
        render(); status(previous ? '文件已导入，请保存更新后的资产关联。' : '文件已导入并登记，可继续编辑名称与关联。');
      } catch (error) { status(error.message); ui.onError(error); }
      finally { setBusy(false); }
    }
    function render() {
      const story = getStory(); if (!story) return; stopMedia();
      const tabs = $('asset-categories'); tabs.replaceChildren();
      for (const [kind, label] of Object.entries(kinds)) {
        const count = kind === 'mp4' ? story.assets.length : kind === 'html' ? (story.catalog || []).filter(asset => asset.kind === 'html').length + (story.components || []).filter(component => !(story.catalog || []).some(asset => asset.kind === 'html' && asset.component === component.id)).length : (story.catalog || []).filter(asset => asset.kind === kind).length;
        const tab = button('', () => {
          if (draftDirty && !confirm('放弃当前资产草稿并切换分类？')) return;
          category = kind; search = ''; $('asset-search').value = ''; draft = null; draftDirty = false; render();
        }); tab.dataset.assetKind = kind; tab.setAttribute('aria-pressed', String(kind === category)); tab.append(el('span', '', label), el('small', '', String(count))); tabs.append(tab);
      }
      $('asset-category-title').textContent = kinds[category];
      $('asset-description').textContent = category === 'html' ? '完整网页动画与游戏包，沿用隔离执行和节点结束协议。' : '项目中的创作素材，在故事中按需关联。';
      $('mp4-panel').hidden = category !== 'mp4'; $('catalog-grid').hidden = category === 'mp4'; $('add-catalog-asset').hidden = category === 'mp4';
      $('catalog-upload-label').hidden = !globalThis.RusieCatalog.fileTypes[category];
      $('catalog-upload').accept = (globalThis.RusieCatalog.fileTypes[category] || []).map(extension => '.' + extension).join(',');
      if (category === 'mp4') renderVideos();
      const grid = $('catalog-grid'); grid.replaceChildren();
      for (const asset of rows().filter(asset => (asset.name + asset.id).toLowerCase().includes(search.toLowerCase()))) {
        const card = el('article', 'catalog-card'); card.dataset.assetId = asset.id;
        let preview;
        if (asset.path && ['item', 'portrait', 'background'].includes(asset.kind)) { preview = el('img'); preview.src = url(asset.path); preview.alt = asset.name; preview.loading = 'lazy'; }
        else if (asset.kind === 'audio') { preview = el('audio'); preview.controls = true; preview.preload = 'metadata'; preview.src = url(asset.path); }
        else { preview = el('div', 'catalog-excerpt', asset.kind === 'html' ? '〈/〉 HTML / JS' : asset.text?.slice(0, 180) || '道具'); }
        const description = el('p', 'help', asset.kind === 'html' ? '隔离执行 · 依赖由组件包携带' : asset.role ? '角色：' + story.roles[asset.role].name : '公共素材');
        const references = (asset.nodes || []).map(id => story.nodes.find(node => node.id === id)?.title).filter(Boolean);
        const actions = el('div', 'catalog-actions'); actions.append(button('编辑', () => start(asset)));
        if (asset.kind === 'html') actions.append(button('预览', () => previewComponent(asset.component)));
        else if (['background', 'portrait', 'dialogue'].includes(asset.kind)) actions.append(button('用于当前片段', () => { if (draftDirty) { status('请先保存当前资产草稿。'); return; } const node = selectedNode(); if (!node) return; node.presentation ||= {}; node.presentation[asset.kind] = asset.id; changed(); render(); status('已设置片段' + kinds[asset.kind] + '，请保存项目。'); }));
        else actions.append(button('关联当前节点', () => { if (draftDirty) { status('请先保存当前资产草稿。'); return; } const node = selectedNode(); if (!node) return; asset.nodes = [...new Set([...asset.nodes || [], node.id])]; changed(); render(); status('已记录创作关联，请保存项目。'); }));
        card.append(preview, el('strong', '', asset.name), el('small', 'catalog-code', asset.id), description);
        if (references.length) card.append(el('p', 'help', '关联：' + references.join('、')));
        card.append(actions); grid.append(card);
      }
      if (!grid.childElementCount && category !== 'mp4') grid.append(el('p', 'catalog-empty', `暂无${kinds[category]}，点击“新建资产”添加。`));
      $('asset-count').textContent = story.assets.length + (story.catalog || []).filter(asset => asset.kind !== 'html').length + (story.components || []).length;
      renderForm();
    }
    $('asset-search').addEventListener('input', event => { search = event.target.value; render(); });
    $('add-catalog-asset').addEventListener('click', () => start());
    $('catalog-upload').addEventListener('change', async event => { const file = event.target.files[0]; event.target.value = ''; if (file) await upload(file); });
    return { render, flush, stopMedia, reset() { draft = null; draftDirty = false; editingId = null; }, hasDraft: () => draftDirty };
  }
  globalThis.RusieAssetEditor = Object.freeze({ create });
})();
