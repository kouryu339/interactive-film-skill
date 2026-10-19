/* Shared by the authoring tools and the standalone player; no dependencies. */
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const scalar = value => ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value));
  const safeId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
  const mediaPath = value => typeof value === 'string' && /^assets\/.+\.mp4$/i.test(value) && !/[\\%?#:\x00-\x1f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
  function inspect(story) {
    const issues = [];
    const report = (level, message, node) => issues.push({ level, message, ...(node ? { node } : {}) });
    if (!object(story) || !['rusie.film/1', 'rusie.film/2'].includes(story.format)) return [{ level: 'error', message: '需要 rusie.film/1 或 rusie.film/2 格式的项目。' }];
    if (story.format === 'rusie.film/1' && (story.data !== undefined || story.roles !== undefined || story.playerRole !== undefined || story.components !== undefined || (Array.isArray(story.nodes) && story.nodes.some(node => node?.type === 'custom')))) report('error', '自定义节点、图数据和角色定义需要 rusie.film/2，避免旧播放器误读。');
    if (!safeId(story.id)) report('error', '项目 ID 需要以英文字母开头，只含字母、数字、下划线或短横线。');
    if (typeof story.title !== 'string' || !story.title.trim()) report('error', '请填写作品名称。');
    if (!object(story.variables) || Object.keys(story.variables).length > 100) report('error', '变量必须是对象，且不超过 100 个。');
    const variables = object(story.variables) ? story.variables : {};
    const components = globalThis.RusieCustom.inspectDefinitions(story, report);
    if (story.catalog !== undefined) {
      if (!globalThis.RusieCatalog) report('error', '缺少分类资产校验模块。');
      else globalThis.RusieCatalog.inspect(story, report);
    }
    for (const [key, value] of Object.entries(variables)) if (!safeId(key) || !scalar(value)) report('error', `变量 ${key} 的名称或初始值无效。`);
    if (!Array.isArray(story.assets) || story.assets.length > 500) report('error', '素材列表必须是数组，且不超过 500 项。');
    const assets = Array.isArray(story.assets) ? story.assets : [];
    const assetIds = new Set(); const paths = new Set();
    for (const asset of assets) {
      if (!object(asset) || !safeId(asset.id) || assetIds.has(asset.id)) { report('error', '素材 ID 无效或重复。'); continue; }
      assetIds.add(asset.id);
      if (!mediaPath(asset.path)) report('error', `素材 ${asset.id} 必须引用 assets/ 内的相对 MP4 路径。`);
      else if (paths.has(asset.path.toLowerCase())) report('error', `素材路径重复：${asset.path}`);
      else paths.add(asset.path.toLowerCase());
      if (typeof asset.label !== 'string') report('error', `素材 ${asset.id} 缺少名称。`);
    }
    if (!Array.isArray(story.nodes) || !story.nodes.length || story.nodes.length > 500) report('error', '作品需要 1–500 个节点。');
    const nodes = Array.isArray(story.nodes) ? story.nodes : [];
    const ids = new Set();
    for (const node of nodes) {
      if (!object(node) || !safeId(node.id) || ids.has(node.id)) { report('error', '节点 ID 无效或重复。'); continue; }
      ids.add(node.id);
    }
    if (!ids.has(story.start)) report('error', '开始节点不存在。');
    for (const node of nodes) {
      if (!object(node)) continue;
      const id = node.id;
      globalThis.RusieCustom.inspectNode(story, node, report, components);
      if (node.presentation !== undefined) {
        if (!globalThis.RusieCatalog) report('error', '缺少片段呈现校验模块。', id);
        else globalThis.RusieCatalog.inspectPresentation(story, node, report);
      }
      if (typeof node.title !== 'string' || !node.title.trim()) report('error', '节点需要标题。', id);
      if (typeof node.text !== 'string') report('error', '节点说明需要是文字。', id);
      if (node.video !== null && !assetIds.has(node.video)) report('error', '节点引用的视频不存在。', id);
      if (typeof node.ending !== 'boolean') report('error', '节点需要明确是否为结局。', id);
      if (!Array.isArray(node.choices) || node.choices.length > 20) { report('error', '每个节点最多支持 20 个选项。', id); continue; }
      if (node.ending && node.choices.length) report('error', '结局节点不能带有选项。', id);
      if (!node.ending && !node.choices.length) report('error', '普通节点至少需要一个选项。', id);
      const choiceIds = new Set(); let unconditional = false;
      for (const choice of node.choices) {
        if (!object(choice)) { report('error', '选项需要是对象。', id); continue; }
        if (!safeId(choice.id) || choiceIds.has(choice.id)) report('error', '选项 ID 无效或重复。', id);
        choiceIds.add(choice.id);
        if (typeof choice.label !== 'string' || !choice.label.trim()) report('error', '选项需要显示文字。', id);
        if (!ids.has(choice.target)) report('error', `选项的目标节点不存在：${choice.target}`, id);
        if (choice.when !== undefined) {
          if (object(choice.when) && choice.when.source === 'lastNode.output') {
            const spec = node.custom?.result?.[choice.when.field];
            if (node.type !== 'custom' || !safeId(choice.when.field) || !object(spec) || !scalar(choice.when.equals) || spec.type !== typeof choice.when.equals || Object.keys(choice.when).some(key => !['source', 'field', 'equals'].includes(key))) report('error', '出边只能读取当前自定义节点已声明的标量 output 字段，并保持值类型一致。', id);
          } else if (!object(choice.when) || choice.when.source !== undefined || !Object.hasOwn(variables, choice.when.variable) || !scalar(choice.when.equals) || typeof choice.when.equals !== typeof variables[choice.when.variable]) report('error', '选项条件需要引用已声明的变量，并保持值类型一致。', id);
        } else unconditional = true;
        if (choice.set !== undefined) {
          if (!object(choice.set)) report('error', '变量赋值需要是对象。', id);
          else for (const [key, value] of Object.entries(choice.set)) if (!Object.hasOwn(variables, key) || !scalar(value) || typeof value !== typeof variables[key]) report('error', `选项对变量 ${key} 的赋值无效或类型不匹配。`, id);
        }
      }
      if (!node.ending && !unconditional && !(node.type === 'custom' && node.choices.every(choice => choice.when?.source === 'lastNode.output'))) report('warning', '所有选项均有条件；某些状态下可能没有可选项。', id);
    }
    if (!issues.some(i => i.level === 'error')) {
      const byId = new Map(nodes.map(node => [node.id, node]));
      const reachable = new Set(); const queue = [story.start];
      while (queue.length) { const id = queue.shift(); if (reachable.has(id)) continue; reachable.add(id); queue.push(...byId.get(id).choices.map(c => c.target)); }
      for (const node of nodes) if (!reachable.has(node.id)) report('warning', '从开始节点无法到达此节点。', node.id);
      const canEnd = new Set(nodes.filter(n => n.ending).map(n => n.id));
      let changed = true;
      while (changed) { changed = false; for (const node of nodes) if (!canEnd.has(node.id) && node.choices.some(c => canEnd.has(c.target))) { canEnd.add(node.id); changed = true; } }
      for (const node of nodes) if (reachable.has(node.id) && !canEnd.has(node.id)) report('warning', '此路径无法到达任何结局。', node.id);
    }
    if (story.extensions !== undefined && !object(story.extensions)) report('error', 'extensions 必须是对象。');
    if (object(story.extensions) && Object.keys(story.extensions).length) report('warning', '扩展信息仅保存，不执行多人或权限规则。');
    return issues;
  }
  function assertStory(story) {
    const errors = inspect(story).filter(issue => issue.level === 'error');
    if (errors.length) throw new Error(errors.map(issue => `${issue.node ? issue.node + ': ' : ''}${issue.message}`).join('\n'));
  }
  // Session boundary: another adapter can own commits later; the current adapter is local only.
  function createLocalSession(story, start = story.start) {
    assertStory(story);
    const definition = clone(story); const nodes = new Map(definition.nodes.map(n => [n.id, n]));
    if (!nodes.has(start)) throw new Error('试玩起点不存在。');
    let current = start; let variables = clone(definition.variables); let history = []; let visit = 0; let checkpoint = null; let historyBytes = 0;
    const listeners = new Set();
    const lastCompleted = () => { const last = history.at(-1); return last ? { id: last.from, output: Object.hasOwn(last, 'result') ? clone(last.result) : null } : null; };
    const snapshot = () => ({ start, node: current, variables: clone(variables), history: clone(history), visit, role: definition.playerRole || null, checkpoint: clone(checkpoint), lastNode: lastCompleted() });
    const matches = (choice, state, output) => !choice.when || (choice.when.source === 'lastNode.output' ? output !== undefined && output[choice.when.field] === choice.when.equals : state[choice.when.variable] === choice.when.equals);
    const available = () => nodes.get(current).choices.filter(c => matches(c, variables, undefined)).map(clone);
    function commit(choiceId, result, expectedVisit, custom) {
      if (expectedVisit !== visit) throw new Error('选择已过期，请使用当前节点的选项。');
      if (history.length >= 10000) throw new Error('本次游玩的选择记录已达上限，请重新开始。');
      const node = nodes.get(current);
      if ((node.type === 'custom') !== custom) throw new Error('当前节点需要匹配的提交入口。');
      if (custom) globalThis.RusieCustom.validateResult(node, result);
      const eligible = node.choices.filter(c => matches(c, variables, custom ? result : undefined));
      if (custom && choiceId === undefined && eligible.length !== 1) throw new Error(eligible.length ? 'output 同时匹配多条出边，请消除条件冲突。' : 'output 没有匹配当前节点的出边。');
      const choice = custom && choiceId === undefined ? eligible[0] : eligible.find(c => c.id === choiceId);
      if (!choice) throw new Error('当前状态下无法选择此选项。');
      const from = current;
      const captured = custom ? Object.fromEntries(Object.entries(choice.capture || {}).map(([key, field]) => [key, result[field]])) : {};
      const event = { from, choice: choice.id, to: choice.target, ...(custom ? { result: clone(result), ...(choiceId === undefined ? { automatic: true } : {}) } : {}) };
      const size = new TextEncoder().encode(JSON.stringify(event)).length;
      if (historyBytes + size > 4 * 1024 * 1024) throw new Error('本次游玩的进度记录超过 4 MB，请重新开始。');
      variables = { ...variables, ...choice.set, ...captured }; current = choice.target; checkpoint = null;
      history.push(event); historyBytes += size; visit++;
      const state = snapshot(); for (const listener of listeners) { try { listener(clone(state)); } catch (error) { console.error('Rusie session listener:', error); } } return state;
    }
    function restore(saved) {
      if (!object(saved) || saved.start !== start || !Array.isArray(saved.history) || saved.history.length > 10000) throw new Error('存档无效。');
      if ((saved.role || null) !== (definition.playerRole || null)) throw new Error('存档角色不匹配。');
      // Replay without repeated history copies; failure cannot partly mutate this session.
      let nextNode = start; let nextVariables = clone(definition.variables); let nextBytes = 0;
      for (const event of saved.history) {
        if (!object(event) || nextNode !== event.from) throw new Error('存档路径无效。');
        const node = nodes.get(nextNode);
        if (Object.keys(event).some(key => !['from', 'choice', 'to', ...(node.type === 'custom' ? ['result', 'automatic'] : [])].includes(key)) || event.automatic !== undefined && event.automatic !== true) throw new Error('存档记录字段无效。');
        if (node.type === 'custom') globalThis.RusieCustom.validateResult(node, event.result);
        const eligible = node.choices.filter(c => matches(c, nextVariables, node.type === 'custom' ? event.result : undefined));
        if (event.automatic && eligible.length !== 1) throw new Error('存档 output 未唯一匹配出边。');
        const choice = eligible.find(c => c.id === event.choice);
        if (!choice || choice.target !== event.to) throw new Error('存档目标与作品不一致。');
        const captured = {};
        if (node.type === 'custom') { for (const [key, field] of Object.entries(choice.capture || {})) captured[key] = event.result[field]; }
        nextBytes += new TextEncoder().encode(JSON.stringify(event)).length;
        if (nextBytes > 4 * 1024 * 1024) throw new Error('存档记录超过 4 MB。');
        nextVariables = { ...nextVariables, ...choice.set, ...captured }; nextNode = choice.target;
      }
      let nextCheckpoint = null;
      if (saved.checkpoint !== undefined && saved.checkpoint !== null) {
        if (nodes.get(nextNode).type !== 'custom' || saved.node !== nextNode || saved.visit !== saved.history.length) throw new Error('进度检查点不属于当前节点。');
        globalThis.RusieCustom.assertJSON(saved.checkpoint); nextCheckpoint = clone(saved.checkpoint);
      }
      current = nextNode; variables = nextVariables; history = clone(saved.history); visit = history.length; checkpoint = nextCheckpoint; historyBytes = nextBytes;
      return snapshot();
    }
    return {
      snapshot, available, restore,
      choose: (id, expected) => commit(id, undefined, expected, false),
      complete: (id, result, expected) => commit(id, result, expected, true),
      finish: (output, expected) => commit(undefined, output, expected, true),
      input() { const node = nodes.get(current); if (node.type !== 'custom') throw new Error('当前节点没有自定义输入。'); return globalThis.RusieCustom.projectInput(definition, node, variables, checkpoint, history); },
      checkpoint(value, expected) { if (expected !== visit || nodes.get(current).type !== 'custom') throw new Error('进度检查点已过期。'); globalThis.RusieCustom.assertJSON(value); checkpoint = clone(value); return snapshot(); },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    };
  }
  globalThis.RusieStory = Object.freeze({ inspect, assertStory, createLocalSession, mediaPath });
})();
