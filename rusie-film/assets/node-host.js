(() => {
  function mount(options) {
    const { container, url, input, visit, onComplete, onCheckpoint, onError } = options;
    globalThis.RusieCustom.assertJSON(input);
    const frame = document.createElement('iframe'); frame.className = 'node-frame'; frame.title = options.title || '自定义交互';
    frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.allow = "camera 'none'; microphone 'none'; geolocation 'none'";
    let port, stopped = false, connected = false, loads = 0, started = false, paused = false;
    let windowStart = performance.now(), messages = 0; const seen = new Set();
    const startTimer = setTimeout(() => fail('扩展包未能启动。请检查入口、运行时文件和通信桥。'), options.startTimeoutMs || 30000);
    const runTimer = setTimeout(() => fail('自定义节点已超过设定的运行时间。'), options.timeoutMs || 1800000);
    function dispose() {
      if (stopped) return; stopped = true; clearTimeout(startTimer); clearTimeout(runTimer); window.removeEventListener('message', ready);
      if (port) { port.postMessage({ type: 'control', action: 'dispose' }); port.close(); }
      frame.remove();
    }
    function fail(message) { if (stopped) return; dispose(); onError(message); }
    function ready(event) {
      if (stopped || connected || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'rusie.node.ready' || event.data.protocol !== 1) return;
      connected = true;
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = async event => {
        if (stopped) return;
        const data = event.data;
        try {
          globalThis.RusieCustom.assertJSON(data);
          if (performance.now() - windowStart > 1000) { windowStart = performance.now(); messages = 0; }
          if (++messages > 30) throw new Error('节点消息过于频繁。');
          if (data.visit !== visit) throw new Error('节点访问已过期。');
          if (data.type === 'started') { if (started) throw new Error('重复启动消息。'); started = true; clearTimeout(startTimer); options.onReady?.(); return; }
          if (!started || !Number.isSafeInteger(data.requestId) || data.requestId < 1 || seen.has(data.requestId) || seen.size >= 10000) throw new Error('节点请求序号无效或重复。');
          seen.add(data.requestId);
          if (data.type === 'complete') {
            if (paused) throw new Error('节点已暂停。');
            // Validate/commit synchronously; close the bridge before a new visit starts.
            const next = onComplete(data.outcome, data.data);
            port.postMessage({ type: 'ack', requestId: data.requestId, ok: true }); dispose(); options.onCommitted?.(next); return;
          }
          if (data.type === 'canvas') {
            if (paused) throw new Error('节点已暂停。');
            if (!options.onCanvas) throw new Error('当前宿主没有开放画布接口。');
            options.onCanvas(data.command); port.postMessage({ type: 'ack', requestId: data.requestId, ok: true }); return;
          }
          if (data.type === 'checkpoint') { onCheckpoint(data.data); port.postMessage({ type: 'ack', requestId: data.requestId, ok: true }); return; }
          if (data.type === 'fail') { fail(typeof data.message === 'string' ? data.message.slice(0, 500) : '自定义节点报告运行失败。'); return; }
          throw new Error('未注册的节点请求。');
        } catch (error) {
          if (port && !stopped && Number.isSafeInteger(data?.requestId)) port.postMessage({ type: 'ack', requestId: data.requestId, ok: false, error: error.message });
          // A malformed result can be corrected by the component; flooding closes the channel.
          options.onRejected?.(error.message); if (messages > 30) fail(error.message);
        }
      };
      port.start(); frame.contentWindow.postMessage({ type: 'rusie.node.init', protocol: 1, input, visit }, '*', [channel.port2]);
    }
    frame.addEventListener('load', () => { if (++loads > 1) fail('扩展页面发生重新导航，节点连接已关闭。'); });
    window.addEventListener('message', ready); frame.src = url; container.append(frame);
    return { frame, dispose, notifyCanvas(event) { if (!stopped && started) port?.postMessage({ type: 'canvas-event', visit, event }); }, pause() { if (!stopped) { paused = true; port?.postMessage({ type: 'control', action: 'pause' }); } }, resume() { if (!stopped) { paused = false; port?.postMessage({ type: 'control', action: 'resume' }); } }, cancel() { fail('交互已取消。可以重新载入该节点。'); } };
  }
  globalThis.RusieNodeHost = Object.freeze({ mount });
})();
