/* Canvas commands change presentation only; no graph/variable mutation is accepted. */
(() => {
  const layers = ['background', 'video', 'portrait', 'dialogue'];
  function normalize(command, { story, component, componentBase, source }) {
    const { object, assertJSON, safePath } = globalThis.RusieCustom; assertJSON(command);
    if (!object(command) || !layers.includes(command.layer) || !['set', 'clear'].includes(command.operation)) throw new Error('画布命令或图层无效。');
    if (Object.keys(command).some(key => !['operation', 'layer', 'patch'].includes(key))) throw new Error('画布命令包含未知字段。');
    if (command.operation === 'clear') { if (command.patch !== undefined) throw new Error('清空命令不能携带内容。'); return { ...command }; }
    const patch = command.patch, layer = command.layer;
    if (!object(patch) || Object.keys(patch).some(key => !['asset', 'source', 'alt', 'style', 'text', 'speaker', 'lines'].includes(key))) throw new Error('画布描述字段无效。');
    if (patch.asset !== undefined && patch.source !== undefined) throw new Error('画布资产和资源路径只能设置一个。');
    const value = {};
    if (patch.style !== undefined) {
      if (!object(patch.style) || Object.values(patch.style).some(item => typeof item !== 'string')) throw new Error('图层样式需要字符串属性值。');
      value.style = { ...patch.style };
    }
    if (patch.asset === null || patch.source === null) return { operation: 'clear', layer };
    if (patch.asset !== undefined) {
      const entry = layer === 'video' ? story.assets.find(item => item.id === patch.asset) : (story.catalog || []).find(item => item.id === patch.asset && item.kind === layer);
      if (!entry) throw new Error('画布资产未登记或分类不匹配。');
      if (layer === 'dialogue') value.lines = globalThis.RusieCatalog.dialogueLines(story, entry);
      else { value.source = source(entry.path); value.alt = entry.name || entry.label; }
    }
    if (patch.source !== undefined) {
      if (layer === 'dialogue' || typeof patch.source !== 'string') throw new Error('此图层不能使用资源路径。');
      const base = new URL(componentBase), url = new URL(patch.source, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) throw new Error('只能加载当前组件包内的资源。');
      const relative = decodeURIComponent(url.pathname.slice(base.pathname.length));
      if (!safePath(relative) || !component.files.includes(relative)) throw new Error('画布资源未列入当前组件清单。');
      value.source = url.href;
    }
    if (patch.alt !== undefined) { if (typeof patch.alt !== 'string') throw new Error('资产说明需要是文字。'); value.alt = patch.alt; }
    if (patch.text !== undefined || patch.speaker !== undefined || patch.lines !== undefined) {
      if (layer !== 'dialogue') throw new Error('台词只能设置在对话图层。');
      if (patch.text !== undefined && typeof patch.text !== 'string' || patch.speaker !== undefined && typeof patch.speaker !== 'string') throw new Error('台词和说话人需要是文字。');
      if (patch.lines !== undefined) value.lines = patch.lines;
      else value.lines = [{ name: patch.speaker || '', text: patch.text || '' }];
    }
    if (value.lines !== undefined && (!Array.isArray(value.lines) || value.lines.length > 500 || value.lines.some(line => !object(line) || typeof line.text !== 'string' || line.name !== undefined && typeof line.name !== 'string'))) throw new Error('对话需要有效台词数组，最多 500 句。');
    return { operation: 'set', layer, value };
  }
  globalThis.RusieCanvasProtocol = Object.freeze({ layers, normalize });
})();
