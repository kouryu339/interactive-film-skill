import { calculateScore } from './runtime.js';
const $ = id => document.getElementById(id);
try {
  const labels = await (await fetch('./labels.json')).json();
  const api = await RusieNode.connect();
  const rules = api.input.graph.harbor;
  let attempts = api.input.checkpoint?.attempts || 0;
  let paused = false;
  $('description').textContent = labels.description;
  $('hint').textContent = api.input.role.observation >= 3 ? rules.hint : '你需要仔细观察码头留下的编号。';
  $('pin').value = api.input.checkpoint?.pin || '';
  const update = () => { $('attempts').textContent = `已尝试 ${attempts} / ${rules.maxAttempts} 次`; };
  const checkpoint = () => api.checkpoint({ attempts, pin: $('pin').value }).catch(error => { $('message').textContent = error.message; });
  $('pin').disabled = false; $('submit').disabled = false; $('give-up').disabled = false; update();
  $('pin').addEventListener('change', () => void checkpoint());
  $('submit').addEventListener('click', async () => {
    if (paused) return;
    $('submit').disabled = true; attempts++; update();
    try {
      if ($('pin').value === rules.code) { $('message').textContent = labels.success; await api.complete('solved', { score: calculateScore(attempts) }); }
      else if (attempts >= rules.maxAttempts) await api.complete('failed', { score: 0 });
      else { $('message').textContent = labels.failure; await checkpoint(); $('submit').disabled = false; }
    } catch (error) { $('message').textContent = error.message; $('submit').disabled = false; }
  });
  $('give-up').addEventListener('click', () => void api.complete('failed', { score: 0 }).catch(error => { $('message').textContent = error.message; }));
  api.onControl(action => { paused = action === 'pause'; $('pin').disabled = paused; $('submit').disabled = paused; $('give-up').disabled = paused; if (action === 'dispose') document.body.replaceChildren(); });
} catch (error) { $('description').textContent = '交互未能启动：' + error.message; }
