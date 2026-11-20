import { mkdir, cp, readFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/shared/', root), { recursive: true });
await cp(new URL('shared/', root), new URL('public/shared/', root), { recursive: true });
for (const file of ['public/index.html', 'public/app.js', 'public/style.css', 'api/index.js', 'server/app.js']) await access(new URL(file, root));
const manifest = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
if (manifest.outputDirectory !== 'public' || manifest.functions['api/index.js'].maxDuration !== 60) throw new Error('Configuração Vercel inesperada.');
console.log('SceneLingo pronto: assets estáticos em public/ e função Node.js em api/index.js.');
