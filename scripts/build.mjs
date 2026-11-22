import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const assets = (await readdir('app')).sort().map(name => 'app/' + name);
const sources = ['index.html', 'manifest.webmanifest', ...assets];
const worker = await readFile('sw.js', 'utf8');
const hash = createHash('sha256').update(worker);
for (const path of sources) hash.update(path).update(await readFile(path));

await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('manifest.webmanifest', 'dist/manifest.webmanifest');
await cp('app', 'dist/app', { recursive: true });
await writeFile('dist/sw.js', worker.replace('__BUILD_REVISION__', hash.digest('hex').slice(0, 16)));
