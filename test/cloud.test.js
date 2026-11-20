import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, readBody } from '../server/app.js';
import { createStorage } from '../server/storage.js';
import { signSession, verifySession, sealTicket, openTicket } from '../server/security.js';
import { translateCues } from '../server/domain.js';
import { DEMO } from '../shared/demo.js';
import { setup, request, login, SECRET, fakeRedis } from './fixtures.js';

const profile = () => ({ title: 'Cloud episode', videoId: 'tt0903747:1:2', type: 'series', cues: DEMO.cues });
test('sem credenciais o deploy abre somente a demonstração, sem fingir persistência', async () => {
  const handler = createHandler({ env: {} });
  const state = await request(handler, '/api/state'); assert.equal(state.status, 200); assert.equal(state.json.readOnly, true); assert.equal(state.json.profiles.length, 1); assert.equal(state.json.profiles[0].cues, undefined);
  assert.equal((await request(handler, '/api/profiles/scenelingo-demo')).json.cues.length, 10);
  assert.equal((await request(handler, '/api/profiles', { method: 'POST', data: profile() })).status, 503);
});
test('chave curta falha fechada, mesmo com um banco configurado', async () => {
  const { handler, redis } = setup({ ADMIN_TOKEN: 'short' }); const response = await request(handler, '/api/state');
  assert.equal(response.json.readOnly, true); assert.equal(redis.commands.length, 0);
});
test('administração exige login, cookies HttpOnly e Secure na Vercel', async () => {
  const { handler } = setup({ VERCEL: '1' });
  assert.equal((await request(handler, '/api/state')).status, 401);
  const result = await request(handler, '/api/auth/login', { method: 'POST', parsed: true, data: { password: SECRET } });
  assert.equal(result.status, 200); assert.match(result.headers['Set-Cookie'], /HttpOnly/); assert.match(result.headers['Set-Cookie'], /Secure/); assert.match(result.headers['Set-Cookie'], /SameSite=Strict/);
  assert.ok(!result.headers['Set-Cookie'].includes(SECRET));
});
test('login inválido, limitação compartilhada e CSRF são rejeitados', async () => {
  const { handler } = setup();
  assert.equal((await request(handler, '/api/auth/login', { method: 'POST', data: { password: 'wrong' } })).status, 401);
  const rejected = await request(handler, '/api/auth/login', { method: 'POST', data: { password: SECRET }, headers: { origin: 'https://other.example' } }); assert.equal(rejected.status, 403);
  for (let i = 0; i < 7; i++) await request(handler, '/api/auth/login', { method: 'POST', data: { password: 'wrong' } });
  assert.equal((await request(handler, '/api/auth/login', { method: 'POST', data: { password: SECRET } })).status, 429);
});
test('sessões assinadas sobrevivem a cold starts e rejeitam adulteração/expiração', () => {
  const token = signSession(SECRET, 1000); assert.equal(verifySession(token, SECRET, 2000), true);
  assert.equal(verifySession(token + 'changed', SECRET, 2000), false); assert.equal(verifySession(token, 'another secret', 2000), false); assert.equal(verifySession(token, SECRET, 8 * 86400000), false);
});
test('criar, listar metadados, atualizar e apagar usam o banco entre instâncias', async () => {
  const first = setup(); const cookie = await login(first.handler);
  const created = await request(first.handler, '/api/profiles', { method: 'POST', data: profile(), headers: { cookie }, parsed: true }); assert.equal(created.status, 201); assert.equal(created.json.revision, 1);
  const second = setup({}, first.redis), id = created.json.id;
  const state = await request(second.handler, '/api/state', { headers: { cookie } }); assert.equal(state.json.profiles.length, 2); assert.ok(!state.json.profiles[1].cues);
  const fetched = await request(second.handler, `/api/profiles/${id}`, { headers: { cookie } }); assert.equal(fetched.json.cues.length, 10);
  const updated = await request(second.handler, `/api/profiles/${id}`, { method: 'PUT', data: { title: 'Updated', revision: 1 }, headers: { cookie } }); assert.equal(updated.json.revision, 2);
  const stale = await request(first.handler, `/api/profiles/${id}`, { method: 'PUT', data: { title: 'Stale', revision: 1 }, headers: { cookie } }); assert.equal(stale.status, 409);
  assert.equal((await request(first.handler, `/api/profiles/${id}`, { headers: { cookie } })).json.title, 'Updated');
  assert.equal((await request(second.handler, `/api/profiles/${id}`, { method: 'DELETE', headers: { cookie } })).status, 200);
  assert.equal((await request(first.handler, `/api/profiles/${id}`, { headers: { cookie } })).status, 404);
});
test('addon é público, usa HTTPS e funciona por rewrite da Vercel sem cookie', async () => {
  const { handler } = setup({ VERCEL: '1' }), cookie = await login(handler);
  const created = await request(handler, '/api/profiles', { method: 'POST', data: profile(), headers: { cookie } }), id = created.json.id;
  const manifest = await request(handler, `/api/index?__route=/a/${id}/manifest.json`, { headers: { host: 'scenelingo.vercel.app' } });
  assert.equal(manifest.status, 200); assert.equal(manifest.headers['Access-Control-Allow-Origin'], '*'); assert.match(manifest.json.logo, /^https:\/\/scenelingo.vercel.app/);
  const list = await request(handler, `/a/${id}/subtitles/series/tt0903747:1:2.json`); assert.equal(list.json.subtitles.length, 5); assert.match(list.json.subtitles[0].url, /^https:/);
  const pathExtras = await request(handler, `/a/${id}/subtitles/series/filehash/videoID=tt0903747%3A1%3A2&videoSize=123.json`); assert.equal(pathExtras.json.subtitles.length, 5);
  const rewrittenExtras = await request(handler, `/api/index?__route=/a/${id}/subtitles/series/filehash/videoSize=123&videoID=tt0903747%3A1%3A2.json`); assert.equal(rewrittenExtras.json.subtitles.length, 5);
  assert.equal((await request(handler, `/a/${id}/subtitles/series/tt0903747:1:1.json`)).json.subtitles.length, 0);
  const srt = await request(handler, `/a/${id}/progressive.srt`); assert.equal(srt.status, 200); assert.match(srt.text, /-->/);
  const head = await request(handler, `/a/${id}/manifest.json`, { method: 'HEAD' }); assert.equal(head.text, ''); assert.equal(head.status, 200);
});
test('tickets de legenda são cifrados, expiram e podem abrir em outra instância', () => {
  const source = { url: 'https://provider.example/secret-config/file.srt', type: 'series', videoId: 'tt1:1:1', language: 'en' };
  const token = sealTicket(source, SECRET, 1000); assert.ok(!token.includes('secret-config')); assert.equal(openTicket(token, SECRET, 2000).url, source.url);
  assert.throws(() => openTicket(token, SECRET, 1000000), /expirada/); assert.throws(() => openTicket(token.slice(0, -3) + 'xxx', SECRET, 2000));
});
test('busca e importação não dependem de cache na memória da função', async () => {
  const { env, storage } = setup({ SUBTITLE_ADDON_URL: 'https://provider.example/manifest.json' });
  const first = createHandler({ env, storage, search: async () => [{ url: 'https://provider.example/en.srt', language: 'en', label: 'EN' }] });
  const cookie = await login(first), found = await request(first, '/api/index?__route=/api/subtitle-search&type=movie&videoId=tt1', { headers: { cookie } });
  const second = createHandler({ env, storage, download: async () => [{ start: 100, end: 2000, text: 'Hello.' }] });
  const imported = await request(second, '/api/subtitle-import', { method: 'POST', headers: { cookie }, data: { englishToken: found.json.subtitles[0].token, title: 'Imported' } }); assert.equal(imported.status, 201); assert.equal(imported.json.cues[0].en, 'Hello.');
});
test('corpos pré-processados da Vercel, JSON inválido e tamanho são tratados', async () => {
  const req = { headers: { 'content-type': 'application/json' }, body: { a: 1 } }; assert.deepEqual(await readBody(req), { a: 1 });
  await assert.rejects(readBody({ headers: req.headers, body: '{' }), /JSON inválido/);
  await assert.rejects(readBody({ headers: req.headers, body: { text: 'x'.repeat(3500001) } }), /3,5 MB/);
});
test('banco indisponível retorna erro, sem fallback que perca sessões', async () => {
  const store = createStorage({ UPSTASH_REDIS_REST_URL: 'https://db.example', UPSTASH_REDIS_REST_TOKEN: 'test' }, async () => { throw new Error('offline'); });
  await assert.rejects(store.list(), /conectar ao banco/);
  const redis = fakeRedis(), { storage } = setup({}, redis); await assert.rejects(storage.create({ id: 'large', cues: [{ en: 'x'.repeat(3000001) }] }), /3 MB/);
});
test('tradução conserva alinhamentos e recusa inglês alterado', async () => {
  const cue = DEMO.cues[0], valid = async () => ({ message: { content: JSON.stringify({ cues: [{ en: cue.en, pt: cue.pt, segments: cue.segments }] }) } });
  assert.equal((await translateCues([cue], 'ollama', { OLLAMA_MODEL: 'test' }, valid))[0].en, cue.en);
  await assert.rejects(translateCues([cue], 'ollama', { OLLAMA_MODEL: 'test' }, async () => ({ message: { content: '{"cues":[{"en":"Changed"}]}' } })), /alterou/);
});
