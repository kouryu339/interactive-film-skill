import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { initialize } from '../rusie-film/scripts/project.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, 'rusie-film/scripts/rusie.mjs');
const args = process.argv.slice(2);
if (!args.includes('--project')) {
  const project = path.join(root, '.local/project');
  try { await fs.stat(path.join(project, 'story.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await initialize(project); }
  args.unshift('--project', project);
}
process.argv = [process.execPath, cli, 'serve', ...args];
await import(pathToFileURL(cli));
