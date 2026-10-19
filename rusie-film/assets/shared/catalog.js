/* Authoring asset library. Catalog records do not execute or grant inventory. */
(() => {
  const kinds = Object.freeze({ script: '角色故事／台本', item: '道具', audio: 'MP3／音频', background: '背景图', portrait: '角色立绘', dialogue: '台词', html: 'HTML 动画' });
  const fileTypes = Object.freeze({ audio: ['mp3', 'wav', 'ogg'], background: ['png', 'jpg', 'jpeg', 'webp'], portrait: ['png', 'jpg', 'jpeg', 'webp'], item: ['png', 'jpg', 'jpeg', 'webp'] });
  const pathFor = (kind, value) => typeof value === 'string' && globalThis.RusieCustom.safePath(value) && value.startsWith('assets/') && (fileTypes[kind] || []).includes(value.split('.').at(-1).toLowerCase());
  function inspect(story, report) {
    if (story.catalog === undefined) return;
    const error = message => report('error', message);
    if (!Array.isArray(story.catalog) || story.catalog.length > 500) { error('资产目录必须为数组，最多 500 项。'); return; }
    if (story.format !== 'rusie.film/2') error('分类资产目录需要 rusie.film/2。');
    const ids = new Set();
    for (const asset of story.catalog) {
      if (!globalThis.RusieCustom.object(asset) || !globalThis.RusieCustom.safeId(asset.id) || ids.has(asset.id) || !Object.hasOwn(kinds, asset.kind)) { error('资产目录 ID、类型无效或重复。'); continue; }
      ids.add(asset.id);
      if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 200) error(`资产 ${asset.id} 需要名称，最多 200 字。`);
      if (asset.role !== undefined && !Object.hasOwn(story.roles || {}, asset.role)) error(`资产 ${asset.id} 引用的角色不存在。`);
      if (asset.nodes !== undefined && (!Array.isArray(asset.nodes) || asset.nodes.length > 500 || new Set(asset.nodes).size !== asset.nodes.length || asset.nodes.some(id => !(Array.isArray(story.nodes) ? story.nodes : []).some(node => node?.id === id)))) error(`资产 ${asset.id} 的关联节点无效。`);
      if (asset.path !== undefined && !pathFor(asset.kind, asset.path)) error(`资产 ${asset.id} 的文件必须是项目内受支持的音频或图片。`);
      if (['audio', 'background', 'portrait'].includes(asset.kind) && !asset.path) error(`资产 ${asset.id} 缺少文件。`);
      if (['script', 'dialogue', 'item'].includes(asset.kind) && (typeof asset.text !== 'string' || asset.text.length > 200000)) error(`资产 ${asset.id} 需要文字内容，最多 20 万字。`);
      if (asset.kind === 'html' && !(Array.isArray(story.components) ? story.components : []).some(component => component?.id === asset.component)) error(`HTML 资产 ${asset.id} 需要已登记的完整组件包。`);
      if (asset.lines !== undefined && (asset.kind !== 'dialogue' || !Array.isArray(asset.lines) || asset.lines.length > 2000 || asset.lines.some(line => !globalThis.RusieCustom.object(line) || typeof line.text !== 'string' || line.speaker !== 'narrator' && !Object.hasOwn(story.roles || {}, line.speaker)))) error(`台词 ${asset.id} 的说话人或内容无效。`);
      try { globalThis.RusieCustom.assertJSON(asset, 1048576); } catch (cause) { error(`资产 ${asset.id}：${cause.message}`); }
    }
  }
  const files = story => [...new Set((story.catalog || []).map(asset => asset.path).filter(Boolean))];
  function dialogueLines(story, asset) {
    if (!asset) return [];
    const name = speaker => speaker === 'narrator' ? '旁白' : story.roles?.[speaker]?.name || '旁白';
    if (Array.isArray(asset.lines)) return asset.lines.filter(line => globalThis.RusieCustom.object(line) && typeof line.text === 'string').map(line => ({ ...line, name: name(line.speaker) }));
    if (typeof asset.text !== 'string') return [];
    return asset.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(text => {
      const parts = /^([^:：]{1,100})[:：]\s*(.*)$/.exec(text);
      const speaker = parts && (parts[1] === '旁白' || parts[1] === 'narrator') ? 'narrator' : parts && Object.entries(story.roles || {}).find(([id, role]) => id === parts[1] || role.name === parts[1])?.[0];
      const owner = speaker || asset.role || 'narrator';
      return { speaker: owner, name: name(owner), text: speaker ? parts[2] : text };
    });
  }
  function inspectPresentation(story, node, report) {
    if (node.presentation === undefined) return;
    const error = message => report('error', message, node.id);
    if (story.format !== 'rusie.film/2') error('背景与对话编排需要 rusie.film/2。');
    if (!globalThis.RusieCustom.object(node.presentation)) { error('片段呈现配置需要是对象。'); return; }
    for (const [key, id] of Object.entries(node.presentation)) {
      if (['background', 'portrait', 'dialogue'].includes(key) && id === null) continue;
      if (!['background', 'portrait', 'dialogue'].includes(key) || typeof id !== 'string' || !(Array.isArray(story.catalog) ? story.catalog : []).some(asset => asset?.id === id && asset.kind === key)) error(`片段 ${key} 必须引用对应分类的资产。`);
    }
    const dialogue = (Array.isArray(story.catalog) ? story.catalog : []).find(asset => asset?.id === node.presentation.dialogue);
    if (dialogue?.kind === 'dialogue' && (dialogue.lines || typeof dialogue.text === 'string')) {
      const lines = dialogueLines(story, dialogue);
      if (!lines.length || lines.length > 2000 || lines.some(line => !line.text.trim())) error('关联的对话需要 1–2000 条非空台词。');
    }
  }
  globalThis.RusieCatalog = Object.freeze({ kinds, fileTypes, pathFor, inspect, files, dialogueLines, inspectPresentation });
})();
