import './component-sdk.js';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Stable transport and lifecycle. Rendering belongs to the inheriting component. */
export class BaseNode {
  #api; #input; #root; #paused = false; #disposed = false; #unsubscribe; #canvasUnsubscribe;
  constructor({ api, root }) {
    if (!api || !root) throw new Error('BaseNode requires a connected bridge and a root element.');
    this.#api = api; this.#root = root;
    this.#input = freeze(JSON.parse(JSON.stringify(api.input)));
    this.#unsubscribe = api.onControl(async action => {
      if (this.#disposed) return;
      if (action === 'pause') { this.#paused = true; await this.onPause(); }
      if (action === 'resume') { this.#paused = false; await this.onResume(); }
      if (action === 'dispose') {
        this.#disposed = true;
        try { await this.onDispose(); } finally { this.#unsubscribe?.(); this.#canvasUnsubscribe?.(); }
      }
    });
    this.#canvasUnsubscribe = api.onCanvas?.(event => { if (!this.#disposed) return this.onCanvasEvent(event); });
  }
  static async start({ root = document.body } = {}) {
    const node = new this({ api: await globalThis.RusieNode.connect(), root });
    try { await node.onStart(); if (!node.disposed) await node.render(node.input.config.view || {}); return node; }
    catch (error) { if (!node.disposed) void node.#api.fail(error.message).catch(() => {}); throw error; }
  }
  get root() { return this.#root; }
  get input() { return this.#input; }
  get definition() { return this.#input.definition; }
  get canvas() { return this.#api.canvas; }
  get paused() { return this.#paused; }
  get disposed() { return this.#disposed; }
  #active() { if (this.#disposed) throw new Error('节点已卸载。'); if (this.#paused) throw new Error('节点已暂停。'); }
  complete(output, result) { this.#active(); return arguments.length > 1 ? this.#api.complete(output, result) : this.#api.complete(output); }
  checkpoint(value) { this.#active(); return this.#api.checkpoint(value); }
  async fire(name, payload = null) {
    this.#active(); if (typeof name !== 'string' || !name || name.length > 120) throw new Error('事件需要 1–120 字符的名称。');
    return this.onEvent(name, payload);
  }
  asset(relative) {
    if (typeof relative !== 'string' || !relative || /[\\%?#:\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('资产需要组件包内相对路径。');
    const marker = '/components/' + encodeURIComponent(this.input.resources.component) + '/';
    const current = new URL(globalThis.location.href), offset = current.pathname.lastIndexOf(marker);
    if (offset < 0) throw new Error('当前页面不在组件目录内。');
    current.pathname = current.pathname.slice(0, offset + marker.length); current.search = ''; current.hash = '';
    return new URL(relative.split('/').map(encodeURIComponent).join('/'), current).href;
  }
  async onStart() {}
  async render() {}
  async onEvent() {}
  async onCanvasEvent(event) { return this.onEvent('canvas:' + event.phase, event); }
  async onPause() {}
  async onResume() {}
  async onDispose() {}
}

/** Public control node. Every view method can be overridden independently. */
export class ControlNode extends BaseNode {
  #fields = new Map(); #busy = false;
  view = {}; slots = {};
  render(view = {}) {
    this.view = view; this.#fields.clear(); this.root.replaceChildren(); this.slots = {};
    for (const name of ['styles', 'history', 'inventory', 'inputs', 'choices']) {
      const element = this.root.ownerDocument.createElement(name === 'styles' ? 'style' : 'section');
      element.dataset.controlSlot = name; this.root.append(element); this.slots[name] = element;
    }
    this.applyStyles(view.styles || '');
    this.renderHistory(view.history ?? this.input.history ?? []);
    this.renderInventory(view.inventory || []);
    this.renderInputs(view.inputs || []);
    this.renderChoices(view.choices ?? this.definition.choices);
  }
  applyStyles(css) { this.slots.styles.textContent = String(css); }
  renderHistory(records) { this.renderRecords(this.slots.history, records); }
  renderInventory(items) { this.renderRecords(this.slots.inventory, items); }
  renderRecords(container, records) {
    container.hidden = records.length === 0;
    for (const record of records) { const item = this.root.ownerDocument.createElement('p'); item.textContent = typeof record === 'string' ? record : JSON.stringify(record); container.append(item); }
  }
  renderInputs(fields) {
    this.slots.inputs.hidden = fields.length === 0;
    for (const field of fields) {
      const label = this.root.ownerDocument.createElement('label'); label.textContent = field.label || field.id;
      const input = this.root.ownerDocument.createElement(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea') input.type = field.type || 'text';
      input.name = field.id; input.required = !!field.required;
      if (input.type === 'checkbox') input.checked = !!field.value;
      else if (input.type !== 'file') input.value = field.value ?? '';
      this.#fields.set(field.id, input); label.append(input); this.slots.inputs.append(label);
    }
  }
  values() { return Object.fromEntries([...this.#fields].map(([id, input]) => [id, input.type === 'checkbox' ? input.checked : input.value])); }
  renderChoices(choices) {
    this.slots.choices.hidden = choices.length === 0;
    for (const choice of choices) {
      const button = this.root.ownerDocument.createElement('button'); button.type = 'button'; button.textContent = choice.label || choice.id; button.disabled = !!choice.disabled;
      button.addEventListener('click', async () => {
        if (this.paused || this.disposed || this.#busy) return;
        if ([...this.#fields.values()].some(input => !input.reportValidity())) return;
        this.#busy = true; button.disabled = true;
        try { await this.onChoice(choice, this.values()); }
        catch (error) { await this.onError(error); }
        finally { this.#busy = false; if (!this.disposed) button.disabled = !!choice.disabled; }
      });
      this.slots.choices.append(button);
    }
  }
  async onChoice(choice, values) {
    if (choice.output !== undefined) return choice.outcome ? this.complete(choice.outcome, choice.output) : this.complete(choice.output);
    return this.fire(choice.event || 'choose', { id: choice.id, values });
  }
  async onError(error) { console.error('ControlNode:', error); }
}
