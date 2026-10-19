(() => {
  function create(ui) {
    const { el, button, field, input, select, typedInput, status } = ui;
    function jsonInput(value, change) {
      const control = el('textarea'); control.rows = 4; control.value = JSON.stringify(value, null, 2);
      control.addEventListener('input', () => {
        try { const next = JSON.parse(control.value); globalThis.RusieCustom.assertJSON(next); control.setCustomValidity(''); change(next); }
        catch { control.setCustomValidity('请填写有效的结构化数据。'); }
      }); return control;
    }
    function nodeFields(story, node, changed, refresh) {
      const host = el('section', 'custom-config');
      host.append(field('扩展包', select([['', '请选择已登记的扩展包'], ...(story.components || []).map(c => [c.id, c.label])], node.custom.component, value => { node.custom.component = value; changed(); })));
      host.append(field('执行方式', select([['web', '显示交互页面'], ['logic', '仅运行逻辑并返回结果']], node.custom.mode || 'web', value => { node.custom.mode = value; changed(); })));
      host.append(field('启动等待时间（秒）', input((node.custom.startTimeoutMs || 30000) / 1000, value => { node.custom.startTimeoutMs = Number(value) * 1000; changed(); }, 'number'), '大型引擎包可以延长等待，最多 120 秒。'));
      host.append(el('p', 'help', '只把这里勾选的数据交给节点，图与角色定义保留在项目中。'));
      for (const [scope, label, source] of [['graph', '图数据', story.data || {}], ['role', '当前角色数据', story.roles?.[story.playerRole]?.data || {}], ['state', '会话变量', story.variables]]) {
        const group = el('fieldset', 'binding-fields'); group.append(el('legend', '', label));
        for (const key of Object.keys(source)) {
          const check = el('input'); check.type = 'checkbox'; check.checked = node.custom.inputs[scope].includes(key);
          check.addEventListener('change', () => { node.custom.inputs[scope] = check.checked ? [...node.custom.inputs[scope], key] : node.custom.inputs[scope].filter(k => k !== key); changed(); });
          const item = el('label'); item.append(check, el('span', '', key)); group.append(item);
        }
        if (!Object.keys(source).length) group.append(el('p', 'help', '暂无字段，可在作品设置中添加。'));
        host.append(group);
      }
      host.append(field('节点专属配置', jsonInput(node.custom.config || {}, value => { node.custom.config = value; changed(); }), '只放该节点内部配置；公共规则优先放入图或角色数据。'));
      const heading = el('div', 'section-heading'); heading.append(el('h2', '', '返回结果字段'), button('＋ 添加', () => { let i = 1; while (Object.hasOwn(node.custom.result, 'result' + i)) i++; node.custom.result['result' + i] = { type: 'number' }; changed(); refresh(); })); host.append(heading);
      for (const [key, spec] of Object.entries(node.custom.result)) {
        const row = el('div', 'result-field'); const name = input(key, () => {}); name.setAttribute('aria-label', '结果字段名');
        name.addEventListener('change', () => {
          const next = name.value.trim(); if (next === key) return;
          if (!globalThis.RusieCustom.safeId(next) || Object.hasOwn(node.custom.result, next)) { name.value = key; status('结果字段名称无效或重复。'); return; }
          node.custom.result[next] = spec; delete node.custom.result[key];
          for (const choice of node.choices) {
            for (const [variable, source] of Object.entries(choice.capture || {})) if (source === key) choice.capture[variable] = next;
            if (choice.when?.source === 'lastNode.output' && choice.when.field === key) choice.when.field = next;
          }
          changed(); refresh();
        });
        const kind = select([['number', '数字'], ['boolean', '是 / 否'], ['string', '文字'], ['json', '结构化数据']], spec.type, value => {
          if (node.choices.some(c => Object.values(c.capture || {}).includes(key) || c.when?.source === 'lastNode.output' && c.when.field === key)) { status('请先解除结果写入映射与出边引用，再修改字段类型。'); refresh(); return; }
          node.custom.result[key] = { type: value }; changed(); refresh();
        });
        row.append(field('字段名', name), field('类型', kind), button('移除', () => {
          if (node.choices.some(c => Object.values(c.capture || {}).includes(key) || c.when?.source === 'lastNode.output' && c.when.field === key)) { status('该结果仍被写入映射或出边引用，请先解除引用。'); return; }
          delete node.custom.result[key]; changed(); refresh();
        }, 'text-button'));
        if (spec.type === 'number') for (const [limit, label] of [['min', '最小值'], ['max', '最大值']]) {
          row.append(field(label, input(spec[limit] ?? '', value => { if (!value.trim()) delete spec[limit]; else if (Number.isFinite(Number(value))) spec[limit] = Number(value); changed(); }, 'number')));
        }
        host.append(row);
      }
      return host;
    }
    function choiceFields(story, node, choice, changed) {
      const host = el('div'); const id = input(choice.id, value => { choice.id = value; changed(); }); host.append(field('结果出口标识', id, '可由 complete(output) 按出边条件匹配；也兼容 complete(出口名, output)。'));
      host.append(el('p', 'help', '将返回结果写入会话变量'));
      for (const [key, value] of Object.entries(story.variables)) {
        const results = Object.entries(node.custom.result).filter(([, spec]) => spec.type === typeof value);
        if (!results.length) continue;
        host.append(field(key, select([['', '不写入'], ...results.map(([id]) => [id, id])], choice.capture?.[key] || '', result => {
          if (result) { choice.capture = { ...choice.capture, [key]: result }; if (choice.set) delete choice.set[key]; }
          else if (choice.capture) { delete choice.capture[key]; if (!Object.keys(choice.capture).length) delete choice.capture; }
          changed();
        })));
      }
      return host;
    }
    function dataFields(data, scope, story, changed, refresh) {
      const host = el('div', 'data-fields');
      for (const [key, value] of Object.entries(data)) {
        const row = el('div', 'data-field'); const name = input(key, () => {});
        name.setAttribute('aria-label', '数据字段名称');
        name.addEventListener('change', () => {
          const next = name.value.trim(); if (next === key) return;
          if (!globalThis.RusieCustom.safeId(next) || Object.hasOwn(data, next)) { name.value = key; status('数据字段名需唯一，以英文字母开头。'); return; }
          data[next] = data[key]; delete data[key];
          if (scope) for (const node of story.nodes) if (node.custom) node.custom.inputs[scope] = node.custom.inputs[scope].map(k => k === key ? next : k);
          changed(); refresh();
        });
        const type = typeof value === 'object' ? 'json' : typeof value;
        const kind = select([['string', '文字'], ['number', '数字'], ['boolean', '是 / 否'], ['json', '结构化数据']], type, next => { data[key] = next === 'json' ? {} : next === 'string' ? '' : next === 'number' ? 0 : false; changed(); refresh(); });
        row.append(field('字段名称', name), field('数据类型', kind));
        row.append(field('内容', type === 'json' ? jsonInput(value, next => { data[key] = next; changed(); }) : typedInput(value, next => { data[key] = next; changed(); })));
        row.append(button('移除字段', () => {
          if (scope && story.nodes.some(n => n.custom?.inputs[scope].includes(key))) { status('此字段被自定义节点引用，请先取消其读取声明。'); return; }
          delete data[key]; changed(); refresh();
        }, 'text-button')); host.append(row);
      }
      host.append(button('＋ 添加数据字段', () => { let i = 1; while (Object.hasOwn(data, 'field' + i)) i++; data['field' + i] = ''; changed(); refresh(); })); return host;
    }
    function settings(story, changed, refresh) {
      const graph = el('section', 'settings-card'); graph.append(el('h2', '', '图数据 · 公共设定与规则'), el('p', 'help', '适合存放公共谜题、关卡与规则。自定义节点通过字段声明读取。'));
      const graphData = story.data || {};
      graph.append(dataFields(graphData, 'graph', story, () => { story.data = graphData; changed(); }, refresh));
      const roles = el('section', 'settings-card'); roles.append(el('h2', '', '角色定义'));
      const definitions = story.roles || {};
      roles.append(field('本次单人游玩的角色', select([['', '未指定角色'], ...Object.entries(definitions).map(([id, role]) => [id, role.name])], story.playerRole || '', value => { if (value) story.playerRole = value; else delete story.playerRole; changed(); refresh(); })));
      for (const [id, role] of Object.entries(definitions)) {
        const card = el('section', 'role-card'); card.append(field('角色名称', input(role.name, value => { role.name = value; changed(); })), el('p', 'help', id));
        card.append(dataFields(role.data, id === story.playerRole ? 'role' : null, story, changed, refresh));
        card.append(button('移除角色', () => { if (id === story.playerRole) { status('请先选择其他角色或取消当前角色。'); return; } if ((story.catalog || []).some(asset => asset.role === id)) { status('此角色仍被资产引用，请先解除资产的角色关联。'); return; } delete story.roles[id]; changed(); refresh(); }, 'text-button')); roles.append(card);
      }
      roles.append(button('＋ 添加角色', () => { story.roles ||= {}; let i = 1; while (Object.hasOwn(story.roles, 'role' + i)) i++; story.roles['role' + i] = { name: '新的角色', data: {} }; if (!story.playerRole) story.playerRole = 'role' + i; changed(); refresh(); }));
      return [graph, roles];
    }
    function components(story, onCreate, onRegister) {
      const host = el('div', 'component-catalog');
      for (const component of story.components || []) {
        const card = el('article', 'settings-card'); card.append(el('h2', '', component.label), el('p', 'help', `${component.runtime.name} ${component.runtime.version} · ${component.files.length} 个文件`), el('p', 'help', '入口：' + component.entry), button('添加到故事', () => onCreate(component))); host.append(card);
      }
      const register = el('section', 'settings-card'); register.append(el('h2', '', '登记本地扩展包'), el('p', 'help', '请让 AI 将用户提供的完整 Web 包放入项目 components/扩展包ID/，并生成 component.json。运行时与必要资源由提供者携带。'));
      const id = input('', () => {}); id.placeholder = '例如 signal-lock'; register.append(field('扩展包 ID', id), button('检查并登记', () => onRegister(id.value.trim()))); host.append(register); return host;
    }
    return { nodeFields, choiceFields, settings, components };
  }
  globalThis.RusieCustomEditor = Object.freeze({ create });
})();
