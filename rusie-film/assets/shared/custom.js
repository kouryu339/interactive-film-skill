/* Data contracts for untrusted Web nodes. No code from a project is evaluated here. */
(() => {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const safeId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) && !forbidden.has(value);
  const safePath = value => typeof value === 'string' && value.length <= 240 && !/[\\%?#:\x00-\x1f<>"|]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
  const clone = value => JSON.parse(JSON.stringify(value));
  function assertJSON(value, maximum = 65536) {
    let entries = 0;
    function visit(item, depth) {
      if (++entries > 5000 || depth > 16) throw new Error('数据层级或条目数超过限制。');
      if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
      if (typeof item === 'number' && Number.isFinite(item)) return;
      if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
      if (object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
        for (const [key, child] of Object.entries(item)) { if (forbidden.has(key)) throw new Error('数据包含受限字段名。'); visit(child, depth + 1); } return;
      }
      throw new Error('只接受可序列化的 JSON 数据。');
    }
    visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(value)).length > maximum) throw new Error(`数据超过 ${maximum} 字节限制。`);
  }
  function checkData(value, report, label) {
    if (!object(value)) { report('error', `${label}需要是对象。`); return; }
    try { assertJSON(value, 262144); } catch (error) { report('error', `${label}：${error.message}`); }
  }
  function inspectDefinitions(story, report) {
    if (story.data !== undefined) checkData(story.data, report, '图数据');
    const roles = story.roles === undefined ? {} : story.roles;
    if (!object(roles) || Object.keys(roles).length > 100) report('error', '角色定义必须是对象，最多 100 个。');
    else for (const [id, role] of Object.entries(roles)) {
      if (!safeId(id) || !object(role) || typeof role.name !== 'string' || !role.name.trim()) { report('error', `角色 ${id} 的定义无效。`); continue; }
      checkData(role.data, report, `角色 ${id} 的数据`);
    }
    if (story.playerRole !== undefined && (!safeId(story.playerRole) || !object(roles) || !Object.hasOwn(roles, story.playerRole))) report('error', '当前单人角色不存在。');
    if (story.components !== undefined && (!Array.isArray(story.components) || story.components.length > 100)) report('error', '扩展包列表必须是数组，最多 100 个。');
    const components = new Map();
    for (const component of Array.isArray(story.components) ? story.components : []) {
      if (!object(component) || !safeId(component.id) || components.has(component.id)) { report('error', '扩展包 ID 无效或重复。'); continue; }
      components.set(component.id, component);
      if (typeof component.label !== 'string' || !component.label.trim()) report('error', `扩展包 ${component.id} 缺少名称。`);
      const files = Array.isArray(component.files) ? component.files : [];
      if (!Array.isArray(component.files) || !files.length || files.length > 10000 || files.some(file => !safePath(file)) || new Set(files.map(f => typeof f === 'string' ? f.toLowerCase() : null)).size !== files.length) report('error', `扩展包 ${component.id} 的文件清单无效或重复。`);
      if (!safePath(component.entry) || !/\.html?$/i.test(component.entry) || !files.includes(component.entry)) report('error', `扩展包 ${component.id} 的 HTML 入口未登记。`);
      const runtime = component.runtime;
      if (!object(runtime) || typeof runtime.name !== 'string' || !runtime.name.trim() || typeof runtime.version !== 'string' || !runtime.version.trim() || !Array.isArray(runtime.files) || !runtime.files.length || runtime.files.some(file => !files.includes(file))) report('error', `扩展包 ${component.id} 必须声明运行时名称、版本及随包提供的必要文件。`);
    }
    return components;
  }
  function inspectNode(story, node, report, components) {
    const emit = message => report('error', message, node.id);
    const choices = Array.isArray(node.choices) ? node.choices : [];
    if (node.type !== undefined && !['scene', 'custom'].includes(node.type)) emit('未知节点执行类型。');
    if (node.type !== 'custom') { if (node.custom !== undefined) emit('普通片段不能携带自定义执行配置。'); for (const choice of choices) if (choice?.capture !== undefined) emit('普通选项不能捕获自定义结果。'); return; }
    if (node.ending) emit('自定义节点需要通过结果出口进入结局。');
    const config = node.custom;
    if (!object(config)) { emit('自定义节点缺少执行配置。'); return; }
    if (!components.has(config.component)) emit('自定义节点引用的扩展包不存在。');
    if (config.mode !== undefined && !['web', 'logic'].includes(config.mode)) emit('自定义节点模式需要为 web 或 logic。');
    if (!object(config.inputs)) emit('自定义节点需要明确声明图、角色与状态的读取范围。');
    else for (const scope of ['graph', 'role', 'state']) {
      const keys = config.inputs[scope];
      const source = scope === 'graph' ? story.data || {} : scope === 'state' ? story.variables || {} : story.roles?.[typeof story.playerRole === 'string' ? story.playerRole : '']?.data || {};
      if (!Array.isArray(keys) || keys.length > 100 || keys.some(key => !safeId(key) || !Object.hasOwn(source, key)) || new Set(keys).size !== keys.length) emit(`${scope} 输入字段未声明、重复或不存在。`);
    }
    if (config.inputs?.history !== undefined && typeof config.inputs.history !== 'boolean') emit('history 输入开关需要是布尔值。');
    if (config.config !== undefined) { try { assertJSON(config.config); } catch (error) { emit('节点配置：' + error.message); } }
    if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 3600000)) emit('交互超时需要在 1 秒至 1 小时之间。');
    if (config.startTimeoutMs !== undefined && (!Number.isInteger(config.startTimeoutMs) || config.startTimeoutMs < 1000 || config.startTimeoutMs > 120000)) emit('启动超时需要在 1 秒至 2 分钟之间。');
    const fields = config.result;
    if (!object(fields) || Object.keys(fields).length > 100) { emit('结果字段定义必须是对象，最多 100 个。'); return; }
    for (const [key, field] of Object.entries(fields)) {
      if (!safeId(key) || !object(field) || !['number', 'string', 'boolean', 'json'].includes(field.type)) { emit(`结果字段 ${key} 的类型无效。`); continue; }
      if (field.min !== undefined && (field.type !== 'number' || !Number.isFinite(field.min))) emit(`结果字段 ${key} 的最小值无效。`);
      if (field.max !== undefined && (field.type !== 'number' || !Number.isFinite(field.max))) emit(`结果字段 ${key} 的最大值无效。`);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) emit(`结果字段 ${key} 的范围无效。`);
      if (field.maxLength !== undefined && (field.type !== 'string' || !Number.isInteger(field.maxLength) || field.maxLength < 0 || field.maxLength > 65536)) emit(`结果字段 ${key} 的文字长度限制无效。`);
    }
    for (const choice of choices) {
      if (!object(choice)) continue;
      if (choice.capture !== undefined) {
        if (!object(choice.capture)) { emit('结果写入映射必须是对象。'); continue; }
        for (const [variable, resultKey] of Object.entries(choice.capture)) {
          if (!safeId(resultKey)) { emit('结果映射引用了无效字段。'); continue; }
          const result = fields[resultKey];
          if (!Object.hasOwn(story.variables || {}, variable) || !Object.hasOwn(fields, resultKey) || !object(result) || result.type !== typeof story.variables[variable] || Object.hasOwn(choice.set || {}, variable)) emit(`结果写入 ${variable} 的字段、类型或赋值范围有冲突。`);
        }
      }
    }
  }
  function validateResult(node, value) {
    assertJSON(value);
    const fields = node.custom.result;
    if (!object(value) || Object.keys(value).length !== Object.keys(fields).length || Object.keys(value).some(key => !Object.hasOwn(fields, key))) throw new Error('自定义结果字段与节点声明不一致。');
    for (const [key, field] of Object.entries(fields)) {
      const item = value[key];
      if (field.type !== 'json' && typeof item !== field.type) throw new Error(`结果 ${key} 类型不匹配。`);
      if (field.type === 'number' && ((field.min !== undefined && item < field.min) || (field.max !== undefined && item > field.max))) throw new Error(`结果 ${key} 超出允许范围。`);
      if (field.type === 'string' && field.maxLength !== undefined && item.length > field.maxLength) throw new Error(`结果 ${key} 的文字过长。`);
    }
  }
  function projectInput(story, node, variables, checkpoint, history = []) {
    const subset = (source, keys) => Object.fromEntries(keys.map(key => [key, clone(source[key])]));
    const result = {
      graph: subset(story.data || {}, node.custom.inputs.graph),
      role: subset(story.roles?.[story.playerRole]?.data || {}, node.custom.inputs.role),
      state: subset(variables, node.custom.inputs.state),
      config: clone(node.custom.config ?? {}), checkpoint: clone(checkpoint),
      definition: { id: node.id, kind: 'control', inputs: clone(node.custom.inputs), result: clone(node.custom.result), choices: node.choices.map(choice => ({ id: choice.id, label: choice.label })) },
      resources: { component: node.custom.component }
    };
    if (node.custom.inputs.history) result.history = history.slice(-50).map(item => ({ from: item.from, choice: item.choice, to: item.to }));
    assertJSON(result); return result;
  }
  globalThis.RusieCustom = Object.freeze({ object, safeId, safePath, clone, assertJSON, inspectDefinitions, inspectNode, validateResult, projectInput });
})();
