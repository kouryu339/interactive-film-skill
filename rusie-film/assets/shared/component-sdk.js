/* Public bridge for user-supplied HTML / game-engine Web builds. No host credentials. */
(() => {
  let connected = false;
  function connect() {
    if (connected) return Promise.reject(new Error('本页面已经建立节点连接。'));
    connected = true;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { window.removeEventListener('message', initialize); reject(new Error('没有收到解释器的节点输入。')); }, 15000);
      function initialize(event) {
        if (event.source !== parent || event.data?.type !== 'rusie.node.init' || event.data.protocol !== 1 || event.ports.length !== 1) return;
        window.removeEventListener('message', initialize); clearTimeout(timeout);
        const port = event.ports[0]; const visit = event.data.visit; let id = 0; let stopped = false;
        const pending = new Map(); const controls = new Set(); const canvasListeners = new Set();
        function request(type, body) {
          if (stopped) return Promise.reject(new Error('节点连接已关闭。'));
          const requestId = ++id;
          return new Promise((done, fail) => {
            const timer = setTimeout(() => { pending.delete(requestId); fail(new Error('解释器未确认请求。')); }, 10000);
            pending.set(requestId, { done, fail, timer }); port.postMessage({ type, visit, requestId, ...body });
          });
        }
        port.onmessage = async message => {
          const data = message.data;
          if (data?.type === 'ack') {
            const item = pending.get(data.requestId); if (!item) return; pending.delete(data.requestId); clearTimeout(item.timer);
            if (data.ok) item.done(); else item.fail(new Error(data.error || '节点请求被拒绝。'));
          } else if (data?.type === 'canvas-event' && data.visit === visit) {
            for (const listener of canvasListeners) { try { await listener(data.event); } catch (error) { console.error('Canvas event:', error); } }
          } else if (data?.type === 'control') {
            for (const listener of controls) { try { await listener(data.action); } catch (error) { console.error('Node control:', error); } }
            if (data.action === 'dispose') {
              stopped = true; for (const item of pending.values()) { clearTimeout(item.timer); item.fail(new Error('节点已卸载。')); } pending.clear(); port.close();
            }
          }
        };
        port.start(); port.postMessage({ type: 'started', visit });
        const input = event.data.input;
        const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
        resolve(Object.freeze({
          input: freeze(input),
          canvas: Object.freeze({ set: (layer, patch) => request('canvas', { command: { operation: 'set', layer, patch } }), clear: layer => request('canvas', { command: { operation: 'clear', layer } }) }),
          complete: (outcome, data = {}) => outcome !== null && typeof outcome === 'object' && !Array.isArray(outcome) ? request('complete', { data: outcome }) : request('complete', { outcome, data }),
          checkpoint: data => request('checkpoint', { data }),
          fail: message => request('fail', { message: String(message).slice(0, 500) }),
          onControl(listener) { controls.add(listener); return () => controls.delete(listener); },
          onCanvas(listener) { canvasListeners.add(listener); return () => canvasListeners.delete(listener); }
        }));
      }
      window.addEventListener('message', initialize);
      parent.postMessage({ type: 'rusie.node.ready', protocol: 1 }, '*');
    });
  }
  globalThis.RusieNode = Object.freeze({ connect });
})();
