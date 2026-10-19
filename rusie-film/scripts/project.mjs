import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import '../assets/shared/custom.js';
import '../assets/shared/catalog.js';
import '../assets/shared/story.js';

export const bundle = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const { inspect, assertStory, mediaPath } = globalThis.RusieStory;
export class ProjectError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const revisionOf = bytes => createHash('sha256').update(bytes).digest('hex');
export async function openProject(directory) {
  const root = await fs.realpath(path.resolve(directory));
  if (!(await fs.stat(root)).isDirectory()) throw new ProjectError('项目目录不存在。');
  return root;
}
export async function containedFile(root, relative) {
  const resolved = await fs.realpath(path.resolve(root, relative));
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new ProjectError('文件必须位于项目目录内。', 403);
  if (!(await fs.stat(resolved)).isFile()) throw new ProjectError('请求的资源不是文件。');
  return resolved;
}
export async function readProject(root) {
  const filename = await containedFile(root, 'story.json');
  const stat = await fs.stat(filename);
  if (stat.size > 4 * 1024 * 1024) throw new ProjectError('剧情文件超过 4 MB。');
  const bytes = await fs.readFile(filename);
  let story; try { story = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw new ProjectError('story.json 不是有效 JSON。'); }
  const issues = inspect(story);
  // Invalid drafts can still be read and repaired, but cannot be played or exported.
  return { story, revision: revisionOf(bytes), issues };
}
export async function withLock(root, task) {
  const filename = path.join(root, '.rusie-write.lock');
  let handle;
  try { handle = await fs.open(filename, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new ProjectError('项目正在被另一个写入操作使用，请稍后重试。若上次进程异常退出，请确认其退出后清理 .rusie-write.lock。', 409); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, time: new Date().toISOString() })); return await task(); }
  finally { await handle.close(); await fs.unlink(filename); }
}
async function checkRevision(root, expected) {
  if (!expected || (await readProject(root)).revision !== expected) throw new ProjectError('项目已被其他窗口或 AI 修改。请重新读取最新版本，再合并修改。', 409);
}
async function writeUnlocked(root, story, expected) {
  assertStory(story);
  const bytes = Buffer.from(JSON.stringify(story, null, 2) + '\n');
  if (bytes.length > 4 * 1024 * 1024) throw new ProjectError('剧情文件超过 4 MB。');
  await checkRevision(root, expected);
  const temporary = path.join(root, `.rusie-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await checkRevision(root, expected);
    await fs.rename(temporary, path.join(root, 'story.json'));
  } finally { await fs.unlink(temporary).catch(() => {}); }
  return { story, revision: revisionOf(bytes), issues: inspect(story) };
}
export const saveProject = (root, story, expected) => withLock(root, () => writeUnlocked(root, story, expected));
export async function validateProject(root, story) {
  const issues = inspect(story);
  if (issues.some(i => i.level === 'error')) return issues;
  for (const asset of story.assets) {
    try { await containedFile(root, asset.path); }
    catch { issues.push({ level: 'error', message: `素材文件缺失或不在项目内：${asset.path}` }); }
  }
  for (const relative of globalThis.RusieCatalog.files(story)) {
    try { await containedFile(root, relative); }
    catch { issues.push({ level: 'error', message: `分类素材文件缺失或越界：${relative}` }); }
  }
  for (const component of story.components || []) {
    try { await listComponentFiles(root, component); }
    catch (error) { issues.push({ level: 'error', message: `扩展包 ${component.id}：${error.message}` }); }
  }
  return issues;
}
export async function listComponentFiles(root, component) {
  const directory = path.join(root, 'components', component.id);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectError('扩展包目录必须是项目内的真实文件夹。');
  const real = await fs.realpath(directory); const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new ProjectError('扩展包目录越界。');
  const entries = []; let total = 0;
  for (const file of component.files) {
    const filename = await containedFile(real, file); const stat = await fs.stat(filename); total += stat.size;
    if (stat.size > 512 * 1024 * 1024 || total > 2 * 1024 * 1024 * 1024) throw new ProjectError('扩展包单文件最多 512 MB，总大小最多 2 GB。');
    entries.push({ relative: `components/${component.id}/${file}`, filename });
  }
  return entries;
}
export async function registerComponent(root, id, expected) {
  if (!globalThis.RusieCustom.safeId(id)) throw new ProjectError('扩展包 ID 无效。');
  return withLock(root, async () => {
    await checkRevision(root, expected); const { story } = await readProject(root);
    const filename = await containedFile(root, `components/${id}/component.json`);
    if ((await fs.stat(filename)).size > 1024 * 1024) throw new ProjectError('扩展清单超过 1 MB。');
    const component = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (component.id !== id || (story.components || []).some(c => c.id === id)) throw new ProjectError('扩展包 ID 不一致或已经登记。');
    story.format = 'rusie.film/2'; story.components = [...story.components || [], component]; assertStory(story); await listComponentFiles(root, component);
    return writeUnlocked(root, story, expected);
  });
}
export async function importComponent(root, source, expected) {
  const origin = await fs.realpath(path.resolve(source)); const manifestFile = await containedFile(origin, 'component.json');
  if ((await fs.stat(manifestFile)).size > 1024 * 1024) throw new ProjectError('扩展清单超过 1 MB。');
  const component = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  return withLock(root, async () => {
    await checkRevision(root, expected); const { story } = await readProject(root);
    story.format = 'rusie.film/2'; story.components = [...story.components || [], component]; assertStory(story);
    const parent = path.join(root, 'components'); await fs.mkdir(parent, { recursive: true });
    if ((await fs.realpath(parent)) !== parent) throw new ProjectError('扩展包目录不能是符号链接。');
    const target = path.join(parent, component.id); await fs.mkdir(target); // Never replace another package.
    let total = 0;
    try {
      for (const file of [...new Set(['component.json', ...component.files])]) {
        const from = await containedFile(origin, file); const size = (await fs.stat(from)).size; total += size;
        if (size > 512 * 1024 * 1024 || total > 2 * 1024 * 1024 * 1024) throw new ProjectError('扩展包超过体积限制。');
        const to = path.join(target, file); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to);
      }
      return await writeUnlocked(root, story, expected);
    } catch (error) { const relative = path.relative(parent, target); if (relative === component.id && globalThis.RusieCustom.safeId(relative)) await fs.rm(target, { recursive: true, force: true }); throw error; }
  });
}
export async function importMedia(root, filename, input, expected) {
  const basename = path.basename(filename.replaceAll('\\', '/'));
  if (!/\.mp4$/i.test(basename)) throw new ProjectError('目前只接受 MP4 文件。');
  return withLock(root, async () => {
    await checkRevision(root, expected);
    const { story } = await readProject(root); assertStory(story);
    const folder = path.join(root, 'assets'); await fs.mkdir(folder, { recursive: true });
    if ((await fs.realpath(folder)) !== folder) throw new ProjectError('素材目录不能是符号链接。', 403);
    const id = 'media-' + randomUUID().slice(0, 12);
    const safeName = basename.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(-100);
    const relative = `assets/${id}-${safeName}`;
    const target = path.join(root, relative); const temporary = target + '.upload';
    let size = 0; let prefix = Buffer.alloc(0); const maximum = 512 * 1024 * 1024;
    const limit = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length;
      if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk]).subarray(0, 64);
      callback(size > maximum ? new ProjectError('单个素材不能超过 512 MB。', 413) : null, chunk);
    } });
    try {
      await pipeline(input, limit, createWriteStream(temporary, { flags: 'wx' }));
      if (size < 12 || prefix.toString('ascii', 4, 8) !== 'ftyp') throw new ProjectError('文件头不是支持的 MP4 容器。请检查素材格式。');
      await fs.rename(temporary, target);
      const asset = { id, label: basename, path: relative };
      story.assets.push(asset);
      const result = await writeUnlocked(root, story, expected);
      return { ...result, asset };
    } catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
    finally { await fs.unlink(temporary).catch(() => {}); }
  });
}
export async function importCatalogFile(root, filename, kind, input, expected) {
  const basename = path.basename(filename.replaceAll('\\', '/'));
  const extension = basename.split('.').at(-1).toLowerCase();
  if (!(globalThis.RusieCatalog.fileTypes[kind] || []).includes(extension)) throw new ProjectError('文件格式与资产分类不匹配。');
  return withLock(root, async () => {
    await checkRevision(root, expected); const { story } = await readProject(root); assertStory(story);
    const directory = path.join(root, 'assets'); await fs.mkdir(directory, { recursive: true });
    if ((await fs.realpath(directory)) !== directory) throw new ProjectError('素材目录不能为链接。');
    const id = 'asset-' + randomUUID().slice(0, 12), relative = `assets/${id}.${extension}`;
    const target = path.join(root, relative), temporary = target + '.upload';
    let size = 0, head = Buffer.alloc(0);
    const limiter = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length; if (head.length < 32) head = Buffer.concat([head, chunk]).subarray(0, 32);
      callback(size > 64 * 1024 * 1024 ? new ProjectError('音频或图片最多 64 MB。', 413) : null, chunk);
    } });
    try {
      await pipeline(input, limiter, createWriteStream(temporary, { flags: 'wx' }));
      const signatures = { png: head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpg: head[0] === 255 && head[1] === 216 && head[2] === 255, jpeg: head[0] === 255 && head[1] === 216 && head[2] === 255, webp: head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WEBP', wav: head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WAVE', ogg: head.toString('ascii',0,4) === 'OggS', mp3: head.toString('ascii',0,3) === 'ID3' || head[0] === 255 && (head[1] & 224) === 224 };
      if (size < 12 || !signatures[extension]) throw new ProjectError('文件头与格式不一致，未导入。');
      await fs.rename(temporary, target);
      const asset = { id, kind, name: basename.slice(0, 200), path: relative, ...(kind === 'item' ? { text: '' } : {}) };
      story.format = 'rusie.film/2'; story.catalog = [...story.catalog || [], asset];
      return { ...await writeUnlocked(root, story, expected), asset };
    } catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
    finally { await fs.unlink(temporary).catch(() => {}); }
  });
}
export async function initialize(directory, title) {
  const target = path.resolve(directory); await fs.mkdir(target, { recursive: true });
  const root = await openProject(target);
  const story = JSON.parse(await fs.readFile(path.join(bundle, 'templates/story.json'), 'utf8'));
  story.id = 'film-' + randomUUID().slice(0, 8); if (title) story.title = title;
  // Exclusive creation prevents an init command from overwriting an existing work.
  await fs.writeFile(path.join(root, 'story.json'), JSON.stringify(story, null, 2) + '\n', { flag: 'wx' });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  return root;
}
export async function exportProject(root, output, expected) {
  const loaded = await readProject(root);
  if (expected && loaded.revision !== expected) throw new ProjectError('项目已更新，请重新检查后导出。', 409);
  const issues = await validateProject(root, loaded.story);
  if (issues.some(i => i.level === 'error')) throw new ProjectError(issues.filter(i => i.level === 'error').map(i => i.message).join('\n'));
  const destination = path.resolve(output);
  // Exports are new directories, never merged into another project or previous export.
  const parent = await fs.realpath(path.dirname(destination));
  const actualDestination = path.join(parent, path.basename(destination));
  const rootRelative = path.relative(actualDestination, root);
  if (!rootRelative || (!rootRelative.startsWith('..' + path.sep) && rootRelative !== '..' && !path.isAbsolute(rootRelative))) throw new ProjectError('导出目录不能包含源项目。');
  await fs.mkdir(actualDestination); // fails on existing directory
  const copied = [];
  try {
    await fs.mkdir(path.join(actualDestination, 'shared'));
    const support = ['player.js', 'player.css', 'canvas-player.js', 'scene-player.js', 'node-host.css', 'shared/custom.js', 'shared/catalog.js', 'shared/story.js', 'shared/canvas-protocol.js'];
    if (loaded.story.nodes.some(node => node.type === 'custom')) support.push('node-host.js', 'shared/component-sdk.js', 'shared/control-node.js', 'serve.mjs');
    else support.push('node-host.js');
    for (const relative of support) await fs.copyFile(path.join(bundle, 'assets', relative), path.join(actualDestination, relative));
    const source = await fs.readFile(path.join(bundle, 'assets/player.html'), 'utf8');
    const data = JSON.stringify({ story: loaded.story, revision: loaded.revision }).replaceAll('<', '\\u003c');
    await fs.writeFile(path.join(actualDestination, 'index.html'), source.replace('<!--STORY_DATA-->', `<script type="application/json" id="story-data">${data}</script>`));
    for (const asset of loaded.story.assets) {
      const from = await containedFile(root, asset.path); const to = path.join(actualDestination, asset.path);
      await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); copied.push(asset.path);
    }
    for (const relative of globalThis.RusieCatalog.files(loaded.story)) {
      const from = await containedFile(root, relative); const to = path.join(actualDestination, relative);
      await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); copied.push(relative);
    }
    for (const component of loaded.story.components || []) for (const file of await listComponentFiles(root, component)) {
      const to = path.join(actualDestination, file.relative); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(file.filename, to); copied.push(file.relative);
    }
    const requiresHTTP = loaded.story.nodes.some(node => node.type === 'custom');
    if (requiresHTTP) {
      await fs.writeFile(path.join(actualDestination, '启动作品.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (echo Please install Node.js 20 or later. & pause & exit /b 1)\r\nnode serve.mjs --open\r\npause\r\n');
      copied.push('启动作品.cmd');
      await fs.writeFile(path.join(actualDestination, '启动说明.txt'), '本作品含自定义 Web 节点，需要通过 HTTP 运行。\nWindows：安装 Node.js 20+ 后双击“启动作品.cmd”。\n其他系统：在本目录运行 node serve.mjs --open。\n也可部署到静态网站；components/ 资源、shared/component-sdk.js 与 shared/control-node.js 需提供 Access-Control-Allow-Origin: *，组件 HTML 应设置 sandbox allow-scripts CSP。\n所有运行时由作品提供，可离线游玩；不要在组件文件中放置密钥或编辑器连接信息。\n'); copied.push('启动说明.txt');
    }
    if ((await readProject(root)).revision !== loaded.revision) throw new ProjectError('导出时项目发生变化，请使用最新版本重新导出。', 409);
    await fs.writeFile(path.join(actualDestination, 'export-manifest.json'), JSON.stringify({ format: 'rusie.export/1', project: loaded.story.id, revision: loaded.revision, requiresHTTP, createdAt: new Date().toISOString(), files: ['index.html', ...support, ...copied], warnings: issues.filter(i => i.level === 'warning') }, null, 2));
    return { output: actualDestination, revision: loaded.revision, requiresHTTP, issues };
  } catch (error) {
    // Only remove the directory created exclusively by this invocation.
    const rel = path.relative(parent, actualDestination);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) await fs.rm(actualDestination, { recursive: true, force: true });
    throw error;
  }
}
export { createReadStream };
