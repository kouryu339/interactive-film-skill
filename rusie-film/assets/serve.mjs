// Shared HTTP transport; also copied into exported works as a standalone launcher.
import http from 'node:http';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
export function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}
export function shutdown(server) {
  return new Promise((resolve, reject) => {
    // Browsers may keep speculative sockets open without sending an HTTP request.
    const timer = setTimeout(() => server.closeAllConnections(), 250);
    server.close(error => { clearTimeout(timer); if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
    server.closeIdleConnections();
  });
}
export function componentHeaders(response, base, component) {
  const resource = `${base}/components/${component}/`; const sdk = `${base}/shared/component-sdk.js ${base}/shared/control-node.js`;
  response.setHeader('Access-Control-Allow-Origin', '*');
  // Opaque origin is enforced even if a package URL is opened outside its iframe.
  response.setHeader('Content-Security-Policy', `sandbox allow-scripts; default-src 'none'; script-src ${resource} ${sdk} 'unsafe-inline' 'unsafe-eval'; style-src ${resource} 'unsafe-inline'; img-src ${resource} data: blob:; media-src ${resource} blob:; font-src ${resource} data:; connect-src ${resource}; worker-src blob: ${resource}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
}
export async function sendFile(request, response, filename) {
  const stat = await fs.stat(filename); let start = 0; let end = stat.size - 1; let status = 200;
  const headers = { 'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1); response.writeHead(status, headers);
  if (request.method === 'HEAD' || !stat.size) { response.end(); return; }
  const stream = createReadStream(filename, { start, end }); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
}
export async function serveExport(directory, port) {
  const root = await fs.realpath(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'export-manifest.json'), 'utf8'));
  if (port === undefined) port = 35000 + createHash('sha256').update(String(manifest.project)).digest().readUInt16BE(0) % 20000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('启动端口需要是 0–65535 的整数。');
  const allowed = new Set(manifest.files); let origin;
  const server = http.createServer(async (request, response) => {
    secureHeaders(response);
    try {
      if (request.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(request.method)) throw new Error('请求不受支持。');
      const route = decodeURIComponent(new URL(request.url, origin).pathname).slice(1) || 'index.html';
      if (!allowed.has(route) || route.split('/').some(part => part === '..' || part === '.') || /[\\\x00]/.test(route)) throw new Error('文件未登记。');
      const filename = await fs.realpath(path.join(root, route)); const relative = path.relative(root, filename);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('文件不在作品内。');
      const component = /^components\/([a-zA-Z][a-zA-Z0-9_-]*)\//.exec(route);
      if (component) {
        const componentRoot = path.join(root, 'components', component[1]);
        if ((await fs.lstat(componentRoot)).isSymbolicLink()) throw new Error('扩展目录不能是链接。');
        const inside = path.relative(componentRoot, filename);
        if (!inside || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) throw new Error('扩展资源越界。');
        componentHeaders(response, origin, component[1]);
      }
      else {
        const publicSDK = ['shared/component-sdk.js', 'shared/control-node.js'].includes(route);
        if (request.headers.origin && request.headers.origin !== origin && !publicSDK) throw new Error('请求来源不受支持。');
        if (publicSDK) response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
      }
      await sendFile(request, response, filename);
    } catch (error) { if (!response.headersSent) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error.message); } else response.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: origin + '/', close: () => shutdown(server) };
}
const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() : entry === fileURLToPath(import.meta.url))) {
  const portIndex = process.argv.indexOf('--port');
  const running = await serveExport(path.dirname(fileURLToPath(import.meta.url)), portIndex < 0 ? undefined : Number(process.argv[portIndex + 1]));
  console.log(`作品已启动：${running.url}\n可以离线游玩。按 Ctrl+C 退出。`);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', running.url] : [running.url];
    spawn(command, args, { windowsHide: true, stdio: 'ignore' }).on('error', () => console.log('请手动打开上面的地址。'));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(running.server).then(() => { process.exitCode = 0; }));
}
