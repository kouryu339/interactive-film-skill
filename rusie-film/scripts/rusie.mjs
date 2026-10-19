#!/usr/bin/env node
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { initialize, openProject, readProject, saveProject, validateProject, exportProject, importComponent, importCatalogFile } from './project.mjs';
import { startServer } from './server.mjs';

const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith('--') || args[i + 1] === undefined) { process.stderr.write('参数格式：--project "目录" --port 5198\n'); process.exit(1); }
  options[args[i].slice(2)] = args[i + 1];
}
try {
  if (!options.project || !['init', 'serve', 'read', 'save', 'validate', 'export', 'component-import', 'asset-import'].includes(command)) {
    throw new Error('用法：node scripts/rusie.mjs init|serve|read|save|validate|export|component-import --project "项目目录"\ninit: --title "作品名"；serve: --port 5198（默认随机端口）；save: --from "修改后的 JSON" --revision "读取版本"；component-import: --from "提供者包目录" --revision "读取版本"；export: --out "新的输出目录"');
  }
  if (command === 'init') console.log(JSON.stringify({ directory: await initialize(options.project, options.title) }, null, 2));
  else {
    const root = await openProject(options.project);
    if (command === 'serve') {
      const port = options.port === undefined ? 0 : Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口需要是 0–65535 的整数。');
      const running = await startServer(root, port);
      console.log(`Rusie 本地编辑器\n项目：${root}\n打开：${running.url}\n仅在本机提供服务；按 Ctrl+C 退出。`);
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void running.close().then(() => { process.exitCode = 0; }));
    } else if (command === 'asset-import') {
      if (!options.from || !options.kind || !options.revision) throw new Error('资产导入需要 --from、--kind（audio/background/portrait/item）、--revision。');
      const source = path.resolve(options.from); await fs.access(source);
      console.log(JSON.stringify(await importCatalogFile(root, path.basename(source), options.kind, createReadStream(source), options.revision), null, 2));
    } else if (command === 'component-import') {
      if (!options.from || !options.revision) throw new Error('导入扩展包需要 --from "包目录" 和 --revision。');
      console.log(JSON.stringify(await importComponent(root, options.from, options.revision), null, 2));
    } else if (command === 'read') console.log(JSON.stringify(await readProject(root), null, 2));
    else if (command === 'save') {
      if (!options.from || !options.revision) throw new Error('保存需要 --from 和 --revision。');
      const story = JSON.parse((await fs.readFile(path.resolve(options.from), 'utf8')).replace(/^\uFEFF/, ''));
      console.log(JSON.stringify(await saveProject(root, story, options.revision), null, 2));
    } else if (command === 'validate') {
      const { story, revision } = await readProject(root); const issues = await validateProject(root, story);
      console.log(JSON.stringify({ revision, issues }, null, 2)); if (issues.some(i => i.level === 'error')) process.exitCode = 1;
    } else {
      if (!options.out) throw new Error('导出需要 --out，且输出目录不能已存在。');
      console.log(JSON.stringify(await exportProject(root, options.out, options.revision), null, 2));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
