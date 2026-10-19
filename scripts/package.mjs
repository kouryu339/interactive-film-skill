import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'rusie-film');
const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)) throw new Error('Invalid skill package version.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/package.mjs [--out <new-directory>]');
const output = path.resolve(args[1] || path.join(root, 'dist', `rusie-film-v${metadata.version}`));
const relativeOutput = path.relative(source, output);
if (!relativeOutput || !relativeOutput.startsWith('..' + path.sep) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput)) throw new Error('Package output must be outside the skill source.');
await fs.mkdir(path.dirname(output), { recursive: true });
const realSource = await fs.realpath(source);
const realOutput = path.join(await fs.realpath(path.dirname(output)), path.basename(output));
const physicalRelative = path.relative(realSource, realOutput);
if (!physicalRelative || !physicalRelative.startsWith('..' + path.sep) && physicalRelative !== '..' && !path.isAbsolute(physicalRelative)) throw new Error('Package output resolves inside the skill source.');
await fs.mkdir(output); // Refuse existing releases, including incomplete previous attempts.
const destination = path.join(output, 'rusie-film');
await fs.mkdir(destination);
const files = [];
const excluded = new Set(['.test-output', 'node_modules', 'exports', '.git', '.rusie-write.lock']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function copy(relative) {
  const filename = path.join(source, relative), info = await fs.lstat(filename);
  if (excluded.has(path.basename(filename)) || /\.(?:upload|tmp|log)$/.test(filename)) return;
  if (info.isSymbolicLink()) throw new Error('Package source contains a symlink: ' + relative);
  if (info.isDirectory()) {
    await fs.mkdir(path.join(destination, relative));
    for (const entry of (await fs.readdir(filename)).sort()) await copy(path.join(relative, entry));
    return;
  }
  if (!info.isFile()) throw new Error('Unsupported package entry: ' + relative);
  const bytes = await fs.readFile(filename), target = path.join(destination, relative);
  await fs.writeFile(target, bytes, { flag: 'wx' });
  if (hash(await fs.readFile(target)) !== hash(bytes)) throw new Error('Package checksum mismatch: ' + relative);
  files.push({ path: relative.split(path.sep).join('/'), sha256: hash(bytes) });
}
for (const entry of ['assets', 'references', 'scripts', 'templates', 'package.json', 'README.md', 'SKILL.md']) await copy(entry);
await fs.writeFile(path.join(output, 'package-manifest.json'), JSON.stringify({ name: metadata.name, version: metadata.version, files }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, skill: destination, files: files.length, verified: true }, null, 2));
