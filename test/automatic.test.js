import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomatic, DEFAULT_SOURCE } from '../server/automatic.js';
import { createHandler } from '../server/app.js';
import { request, setup, SECRET } from './fixtures.js';
const en = [{ start: 100, end: 3000, text: 'I work at a hospital.' }], pt = [{ start: 100, end: 3000, text: 'Eu trabalho em um hospital.' }];
function fixture() {
  const cache = new Map(), calls = [];
  const storage = { configured: true, cacheGet: async key => cache.get(key), cachePut: async (key, value) => cache.set(key, value) };
  const search = async (...args) => { calls.push(args); return [{ language: 'en', url: 'https://files.example/en.srt', label: '1080p BluRay' }, { language: 'pt', url: 'https://files.example/pt.srt', label: '1080p BluRay' }]; };
  let downloads = 0;
  const download = async url => { downloads++; return url.endsWith('en.srt') ? en : pt; };
  return { storage, search, download, calls, count: () => downloads };
}
test('um único manifesto serve qualquer filme ou episódio, sem sessão manual', async () => {
  const f = fixture(), auto = createAutomatic({ ...f, env: { ADMIN_TOKEN: SECRET } });
  assert.deepEqual(auto.manifest('https://example.com').resources, ['subtitles']);
  for (const [type, id] of [['movie', 'tt0241527'], ['series', 'tt0903747:1:1'], ['series', 'tt0903747:1:2']]) {
    const result = await auto.options(type, id, '', 'https://example.com'); assert.equal(result.subtitles.length, 4);
    assert.equal(f.calls.at(-1)[0], DEFAULT_SOURCE); assert.equal(f.calls.at(-1)[2], id);
  }
});
test('primeira reprodução baixa EN/PT, próxima usa cache em outra instância', async () => {
  const f = fixture(), env = { ADMIN_TOKEN: SECRET }, first = createAutomatic({ ...f, env });
  const result = await first.options('movie', 'tt0241527', 'filename=Harry.Potter.BluRay', 'https://example.com');
  const url = new URL(result.subtitles.find(s => s.id.endsWith('bilingual')).url), [, , ticket, mode] = url.pathname.split('/');
  const text = await first.subtitle(ticket, mode.slice(0, -4)); assert.match(text, /I work/); assert.match(text, /Eu trabalho/); assert.equal(f.count(), 2);
  await createAutomatic({ ...f, env }).subtitle(ticket, 'delayed'); assert.equal(f.count(), 2);
  await createAutomatic({ ...f, env }).options('movie', 'tt0241527', 'filename=Harry.Potter.BluRay', 'https://example.com'); assert.equal(f.calls.length, 1);
});
test('sem português oferece inglês, sem inglês não inventa legenda', async () => {
  const f = fixture(), env = { ADMIN_TOKEN: SECRET };
  const english = createAutomatic({ ...f, env, search: async () => [{ language: 'en', url: 'https://files.example/en.srt', label: 'EN' }] });
  assert.equal((await english.options('movie', 'tt1', '', 'https://example.com')).subtitles.length, 1);
  const empty = createAutomatic({ ...fixture(), env, search: async () => [] }); assert.equal((await empty.options('movie', 'tt1', '', 'https://example.com')).subtitles.length, 0);
});
test('hash e metadados chegam ao provedor; links não expõem credenciais', async () => {
  const f = fixture(), auto = createAutomatic({ ...f, env: { ADMIN_TOKEN: SECRET, SUBTITLE_ADDON_URL: 'https://provider.example/private/manifest.json' } });
  const result = await auto.options('series', 'hash123', 'videoID=tt0903747%3A1%3A1&videoSize=123', 'https://example.com');
  assert.equal(f.calls[0][2], 'hash123'); assert.match(f.calls[0][4], /videoID=/); assert.ok(!result.subtitles[0].url.includes('files.example'));
});
test('rotas públicas automáticas funcionam pelos rewrites da Vercel', async () => {
  const { env, storage } = setup(), f = fixture(), handler = createHandler({ env, storage, search: f.search, download: f.download });
  assert.equal((await request(handler, '/api/index?__route=/manifest.json')).json.id, 'community.scenelingo.automatic');
  const result = await request(handler, '/api/index?__route=/subtitles/movie/tt0241527.json'); assert.equal(result.json.subtitles.length, 4);
  const path = new URL(result.json.subtitles[0].url).pathname;
  const sub = await request(handler, `/api/index?__route=${path}`); assert.equal(sub.status, 200); assert.match(sub.text, /-->/);
});
test('addon público funciona com Redis sem ADMIN_TOKEN; variantes têm label oficial', async () => {
  const f = fixture(), env = { KV_REST_API_TOKEN: 'private-redis-token-test-with-32-characters' }, auto = createAutomatic({ ...f, env });
  const result = await auto.options('movie', 'tt0241527', '', 'https://example.com');
  const item = result.subtitles.find(s => s.id.endsWith('bilingual'));
  assert.equal(item.label, 'SL 1 BluRay · Dupla EN + PT'); assert.equal(item.lang, 'por');
  const [, , ticket] = new URL(item.url).pathname.split('/');
  assert.match(await auto.subtitle(ticket, 'bilingual'), /I work/);
  assert.ok(!item.url.includes(env.KV_REST_API_TOKEN));
  assert.ok(item.url.length < 160, `URL longa demais para players nativos: ${item.url.length}`);
});
