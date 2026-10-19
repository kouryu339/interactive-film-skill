import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { bundle, containedFile, readProject, saveProject, validateProject, importMedia, importCatalogFile, exportProject, registerComponent, ProjectError } from './project.mjs';
import { sendFile, secureHeaders, componentHeaders, shutdown } from '../assets/serve.mjs';

const staticFiles = new Set(['editor.html', 'editor.js', 'editor.css', 'inspector.css', 'asset-editor.js', 'asset-editor.css', 'custom-editor.js', 'custom-editor.css', 'player.html', 'player.js', 'player.css', 'canvas-player.js', 'scene-player.js', 'node-host.js', 'node-host.css', 'shared/custom.js', 'shared/catalog.js', 'shared/story.js', 'shared/canvas-protocol.js', 'shared/component-sdk.js']);
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
async function readJSON(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4 * 1024 * 1024) throw new ProjectError('请求超过 4 MB。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError('请求不是有效 JSON。'); }
}
export async function startServer(root, port = 0) {
  const token = randomBytes(24).toString('hex'); let origin;
  let resourceCache;
  async function resourceDefinition() {
    const stat = await fs.stat(path.join(root, 'story.json'), { bigint: true });
    const key = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (resourceCache?.key !== key) resourceCache = { key, value: readProject(root) };
    return resourceCache.value;
  }
  const server = http.createServer(async (request, response) => {
    secureHeaders(response);
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    try {
      if (request.headers.host !== new URL(origin).host) throw new ProjectError('主机地址无效。', 403);
      const url = new URL(request.url, origin); const route = decodeURIComponent(url.pathname);
      const componentRoute = /^\/components\/([a-zA-Z][a-zA-Z0-9_-]*)\/(.+)$/.exec(route);
      if (componentRoute && ['GET', 'HEAD'].includes(request.method)) {
        const [, id, relative] = componentRoute;
        if (!globalThis.RusieCustom.safePath(relative)) throw new ProjectError('扩展资源路径无效。', 403);
        const { story } = await resourceDefinition(); const component = story.components?.find(c => c.id === id);
        if (!component?.files.includes(relative)) throw new ProjectError('扩展资源未登记。', 404);
        const componentRoot = path.join(root, 'components', id); const stat = await fs.lstat(componentRoot);
        if (stat.isSymbolicLink()) throw new ProjectError('扩展目录不能是链接。', 403);
        componentHeaders(response, origin, id);
        return await sendFile(request, response, await containedFile(componentRoot, relative));
      }
      if (['/shared/component-sdk.js', '/shared/control-node.js'].includes(route) && ['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Access-Control-Allow-Origin', '*'); return await sendFile(request, response, path.join(bundle, 'assets', route.slice(1)));
      }
      if (request.headers.origin && request.headers.origin !== origin) throw new ProjectError('仅允许当前编辑器访问项目。', 403);
      if (route.startsWith('/api/')) {
        if (request.headers['x-rusie-token'] !== token) throw new ProjectError('编辑器连接已失效，请使用启动时给出的地址重新打开。', 403);
        if (route === '/api/project' && request.method === 'GET') {
          const loaded = await readProject(root);
          if (url.searchParams.get('poll') === '1' && url.searchParams.get('revision') === loaded.revision) return json(response, 200, { unchanged: true, revision: loaded.revision });
          return json(response, 200, { ...loaded, issues: await validateProject(root, loaded.story), directory: root });
        }
        if (route === '/api/project' && request.method === 'PUT') {
          const body = await readJSON(request); const result = await saveProject(root, body.story, body.revision);
          process.stdout.write(`[save] ${new Date().toISOString()} ${result.revision}\n`); return json(response, 200, { ...result, issues: await validateProject(root, result.story) });
        }
        if (route === '/api/components/register' && request.method === 'POST') {
          const body = await readJSON(request); const result = await registerComponent(root, body.id, body.revision);
          process.stdout.write(`[component] ${new Date().toISOString()} ${body.id} ${result.revision}\n`); return json(response, 201, result);
        }
        if (route === '/api/catalog-file' && request.method === 'POST') {
          if (Number(request.headers['content-length']) > 64 * 1024 * 1024) throw new ProjectError('分类素材最多 64 MB。', 413);
          const result = await importCatalogFile(root, url.searchParams.get('name') || '', url.searchParams.get('kind'), request, request.headers['x-project-revision']);
          process.stdout.write(`[asset-import] ${new Date().toISOString()} ${result.asset.path}\n`); return json(response, 201, result);
        }
        if (route === '/api/media' && request.method === 'POST') {
          if (Number(request.headers['content-length']) > 512 * 1024 * 1024) throw new ProjectError('单个素材不能超过 512 MB。', 413);
          const result = await importMedia(root, url.searchParams.get('name') || '', request, request.headers['x-project-revision']);
          process.stdout.write(`[import] ${new Date().toISOString()} ${result.asset.path}\n`); return json(response, 201, result);
        }
        if (route === '/api/export' && request.method === 'POST') {
          const body = await readJSON(request);
          const folder = path.join(root, 'exports'); await fs.mkdir(folder, { recursive: true });
          if ((await fs.realpath(folder)) !== folder) throw new ProjectError('导出目录不能是符号链接。', 403);
          const name = 'film-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6);
          const result = await exportProject(root, path.join(folder, name), body.revision);
          process.stdout.write(`[export] ${new Date().toISOString()} ${result.output}\n`); return json(response, 201, result);
        }
        throw new ProjectError('接口不存在。', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new ProjectError('不支持此操作。', 405);
      if (route.startsWith('/media/')) {
        const relative = route.slice(7);
        // Media URLs carry a token because native video requests cannot set custom headers.
        if (url.searchParams.get('token') !== token) throw new ProjectError('素材访问连接已失效。', 403);
        const { story } = await resourceDefinition();
        const video = globalThis.RusieStory.mediaPath(relative) && story.assets?.some(asset => asset.path === relative);
        const catalog = story.catalog?.some(asset => asset.path === relative && globalThis.RusieCatalog.pathFor(asset.kind, relative));
        if (!video && !catalog) throw new ProjectError('素材未登记或路径无效。', 404);
        return await sendFile(request, response, await containedFile(root, relative));
      }
      const relative = route === '/' ? 'editor.html' : route.slice(1);
      if (!staticFiles.has(relative)) throw new ProjectError('页面不存在。', 404);
      await sendFile(request, response, path.join(bundle, 'assets', relative));
    } catch (error) {
      if (!response.headersSent) json(response, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.message });
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, token, origin, url: `${origin}/#token=${token}`, close: () => shutdown(server) };
}
