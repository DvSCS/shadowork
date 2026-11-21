import { config, pairSubtitles, toSrt } from '../shared/core.js';
import { DEMO } from '../shared/demo.js';
import { validateProfile, subtitleRequestMatches, translateCues, fail } from './domain.js';
import { createStorage, summarize } from './storage.js';
import { adminConfigured, authenticated, sameSecret, signSession, sessionCookie, requestOrigin, checkOrigin, clientKey, sealTicket, openTicket } from './security.js';
import { searchSubtitles, downloadSubtitles } from './subtitle-provider.js';
import { createAutomatic } from './automatic.js';

const MAX_BODY = 3500000;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const demo = () => ({ ...structuredClone(DEMO), config: config(), demo: true, revision: 0, createdAt: 0, updatedAt: 0 });
export async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail('Envie application/json.', 415);
  if (Number(req.headers['content-length']) > MAX_BODY) throw fail('Requisição maior que 3,5 MB. Divida a sessão em trechos menores.', 413);
  let value;
  try {
    // Vercel parses JSON into request.body. Native Node exposes a readable stream.
    const parsed = req.body;
    if (parsed !== undefined) {
      if (typeof parsed === 'object' && parsed !== null && !Buffer.isBuffer(parsed)) value = parsed;
      else value = JSON.parse(String(parsed));
    } else {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw fail('Requisição maior que 3,5 MB.', 413); chunks.push(chunk); }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
  } catch (error) { if (error.status) throw error; throw fail('JSON inválido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Envie um objeto JSON.');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BODY) throw fail('Requisição maior que 3,5 MB.', 413);
  return value;
}
function providers(env) {
  const remoteOllama = Boolean(env.OLLAMA_MODEL && env.OLLAMA_URL && (!env.VERCEL || !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(env.OLLAMA_URL)));
  return { ollama: remoteOllama, libretranslate: Boolean(env.LIBRETRANSLATE_URL), subtitles: Boolean(env.SUBTITLE_ADDON_URL) };
}
async function translationRequest(env, url, payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (env.OLLAMA_API_KEY && env.OLLAMA_URL && url.startsWith(env.OLLAMA_URL.replace(/\/$/, '') + '/')) headers.Authorization = `Bearer ${env.OLLAMA_API_KEY}`;
  let response;
  try { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) }); }
  catch { throw fail('O tradutor não respondeu em até 45 segundos. Tente um modelo mais rápido ou um lote menor.', 502); }
  if (!response.ok) throw fail(`O tradutor respondeu HTTP ${response.status}.`, 502);
  try { return await response.json(); } catch { throw fail('O tradutor retornou uma resposta inválida.', 502); }
}
export function createHandler({ env = process.env, storage = createStorage(env), search = searchSubtitles, download = downloadSubtitles } = {}) {
  const automatic = createAutomatic({ env, storage, search: search === searchSubtitles ? undefined : search, download });
  return async function handler(req, res) {
    let addon = false;
    function send(status, value, mime = 'application/json; charset=utf-8', headers = {}) {
      let text = typeof value === 'string' ? value : JSON.stringify(value);
      if (Buffer.byteLength(text) > 4000000) { status = 413; text = JSON.stringify({ error: 'A resposta excede 4 MB. Divida a sessão em trechos menores antes de importar.' }); mime = 'application/json; charset=utf-8'; }
      res.writeHead(status, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Vercel-CDN-Cache-Control': 'no-store', ...(addon ? { 'Access-Control-Allow-Origin': '*' } : {}), ...headers });
      res.end(req.method === 'HEAD' ? undefined : text);
    }
    try {
      const origin = requestOrigin(req, env), url = new URL(req.url, origin);
      for (const [key, value] of Object.entries(req.query || {})) if (typeof value === 'string' && !url.searchParams.has(key)) url.searchParams.set(key, value);
      const routedPath = url.searchParams.get('__route') || url.pathname;
      if (!routedPath.startsWith('/') || routedPath.includes('?') || routedPath.includes('#')) throw fail('Rota inválida.');
      const parts = routedPath.split('/').filter(Boolean).map(decodeURIComponent);
      addon = ['a', 'auto', 'subtitles'].includes(parts[0]) || parts[0] === 'manifest.json';
      if (req.method === 'OPTIONS') {
        if (!addon) return send(405, { error: 'Preflight não disponível para a administração.' });
        return send(204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Origin': '*' });
      }
      if (addon) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'O addon permite somente leitura.' }, undefined, { Allow: 'GET, HEAD, OPTIONS' });
        const automaticBase = (env.BASE_URL || origin).replace(/\/$/, '');
        if (parts[0] === 'manifest.json') return send(200, automatic.manifest(automaticBase));
        if (parts[0] === 'subtitles' && parts[2]) {
          const extra = new URLSearchParams((parts[3] || '').replace(/\.json$/, ''));
          for (const field of ['videoID', 'videoId', 'videoHash', 'videoSize', 'filename']) if (!extra.has(field) && url.searchParams.has(field)) extra.set(field, url.searchParams.get(field).replace(/\.json$/, ''));
          return send(200, await automatic.options(parts[1], parts[2].replace(/\.json$/, ''), extra.toString(), automaticBase));
        }
        if (parts[0] === 'auto' && parts[1] && parts[2]?.endsWith('.srt')) return send(200, await automatic.subtitle(parts[1], parts[2].slice(0, -4)), 'application/x-subrip; charset=utf-8');
        if (!ID.test(parts[1] || '')) throw fail('Sessão inválida.', 404);
        const profile = parts[1] === DEMO.id ? demo() : storage.configured ? await storage.get(parts[1]) : null;
        if (!profile) throw fail('Sessão não encontrada.', 404);
        const publicBase = (env.BASE_URL || origin).replace(/\/$/, ''), base = `${publicBase}/a/${profile.id}`;
        if (parts[2] === 'manifest.json') return send(200, { id: `community.scenelingo.${profile.id}`, version: '1.3.1', name: `SceneLingo · ${profile.title}`, description: 'Inglês com legendas progressivas, configuradas no estúdio SceneLingo.', resources: ['subtitles'], types: ['movie', 'series'], catalogs: [], behaviorHints: { configurable: true, configurationRequired: false }, logo: `${publicBase}/assets/logo.svg` });
        if (parts[2] === 'subtitles' && parts[4] && (parts[4].endsWith('.json') || parts.length >= 6)) {
          const extra = new URLSearchParams((parts[5] || '').replace(/\.json$/, ''));
          // Some proxies expose &-separated Stremio path extras as query fields.
          for (const field of ['videoID', 'videoId']) if (!extra.has(field) && url.searchParams.has(field)) extra.set(field, url.searchParams.get(field).replace(/\.json$/, ''));
          const matched = subtitleRequestMatches(profile, parts[3], parts[4].replace(/\.json$/, ''), extra.toString());
          const modes = [['configured', 'Seu modo configurado'], ['progressive', 'Progressiva EN → PT'], ['delayed', 'Tradução com atraso'], ['bilingual', 'Inglês e português'], ['english', 'Somente inglês']];
          return send(200, { subtitles: matched ? modes.map(([mode, name]) => ({ id: `scenelingo-${profile.id}-${mode}`, lang: `SceneLingo · ${name}`, url: `${base}/${mode}.srt` })) : [], cacheMaxAge: 0 });
        }
        if (parts[2]?.endsWith('.srt')) {
          const mode = parts[2].slice(0, -4); if (!['configured', 'progressive', 'delayed', 'bilingual', 'english'].includes(mode)) throw fail('Modo inválido.');
          return send(200, toSrt(profile.cues, { ...profile.config, ...(mode === 'configured' ? {} : { mode }) }), 'application/x-subrip; charset=utf-8');
        }
        if (parts[2] === 'configure') return send(302, '', 'text/plain', { Location: `/?profile=${profile.id}#integrations` });
        throw fail('Recurso não encontrado.', 404);
      }
      if (parts[0] !== 'api') throw fail('Rota não encontrada.', 404);
      if (parts[1] === 'health' && req.method === 'GET') return send(200, { name: 'SceneLingo', version: '1.3.1', runtime: 'vercel-node', storageConfigured: storage.configured, adminConfigured: adminConfigured(env) });
      const signedIn = authenticated(req, env), configured = adminConfigured(env);
      if (parts[1] === 'auth' && parts[2] === 'status' && req.method === 'GET') return send(200, { configured, authenticated: signedIn, storageConfigured: storage.configured, mode: configured && storage.configured ? 'cloud' : 'demo' });
      if (!['GET', 'HEAD'].includes(req.method)) checkOrigin(req, origin);
      if (parts[1] === 'auth' && parts[2] === 'login' && req.method === 'POST') {
        if (!configured) throw fail('Configure ADMIN_TOKEN com pelo menos 32 caracteres nas variáveis da Vercel.', 503);
        const input = await readBody(req);
        if (storage.configured && !(await storage.allowLogin(clientKey(req, env.ADMIN_TOKEN)))) return send(429, { error: 'Muitas tentativas. Aguarde um minuto.' }, undefined, { 'Retry-After': '60' });
        if (typeof input.password !== 'string' || input.password.length > 1024 || !sameSecret(input.password, env.ADMIN_TOKEN)) throw fail('Chave de administração inválida.', 401);
        return send(200, { ok: true }, undefined, { 'Set-Cookie': sessionCookie(signSession(env.ADMIN_TOKEN), Boolean(env.VERCEL)) });
      }
      if (parts[1] === 'auth' && parts[2] === 'logout' && req.method === 'POST') return send(200, { ok: true }, undefined, { 'Set-Cookie': sessionCookie('', Boolean(env.VERCEL), true) });
      // Without a valid admin secret, expose only the original read-only demonstration.
      if (configured && !signedIn) throw fail('Entre com sua chave de administração para continuar.', 401);
      if (parts[1] === 'state' && req.method === 'GET') {
        const profiles = configured && storage.configured ? await storage.list() : [];
        return send(200, { profiles: [summarize(demo()), ...profiles], providers: configured ? providers(env) : { ollama: false, libretranslate: false, subtitles: false }, baseUrl: env.BASE_URL || origin, readOnly: !configured || !storage.configured, authenticated: signedIn, storage: storage.configured ? 'redis' : 'demo' });
      }
      if (parts[1] === 'profiles' && parts[2] === DEMO.id && req.method === 'GET') return send(200, { ...demo(), format: 'scenelingo-session', version: 1 });
      if (!configured) throw fail('Modo demonstração. Configure ADMIN_TOKEN e Redis para administrar sessões.', 503);
      if (!storage.configured) throw fail('Configure Upstash Redis nas variáveis da Vercel para salvar sessões.', 503);
      if (parts[1] === 'profiles' && parts.length === 2 && req.method === 'POST') return send(201, await storage.create(validateProfile(await readBody(req))));
      if (parts[1] === 'profiles' && ID.test(parts[2] || '')) {
        if (parts[2] === DEMO.id) throw fail('A demonstração é temporária. Importe uma sessão própria para salvar permanentemente.', 409);
        const previous = await storage.get(parts[2]); if (!previous) throw fail('Sessão não encontrada.', 404);
        if (req.method === 'GET') return send(200, { ...previous, format: 'scenelingo-session', version: 1 });
        if (req.method === 'PUT') { const input = await readBody(req); return send(200, await storage.update(validateProfile(input, previous), input.revision)); }
        if (req.method === 'DELETE') { await storage.delete(parts[2]); return send(200, { ok: true }); }
      }
      if (parts[1] === 'subtitle-search' && req.method === 'GET') {
        if (!env.SUBTITLE_ADDON_URL) throw fail('Configure SUBTITLE_ADDON_URL nas variáveis da Vercel.');
        const type = url.searchParams.get('type'), videoId = url.searchParams.get('videoId');
        if (!['movie', 'series'].includes(type) || !/^[\w:.-]{1,160}$/.test(videoId || '')) throw fail('Informe o tipo e um ID válido.');
        const results = await search(env.SUBTITLE_ADDON_URL, type, videoId);
        return send(200, { subtitles: results.map(item => ({ token: sealTicket({ ...item, type, videoId }, env.ADMIN_TOKEN), language: item.language, label: item.label })) });
      }
      if (parts[1] === 'subtitle-import' && req.method === 'POST') {
        const input = await readBody(req), english = openTicket(input.englishToken, env.ADMIN_TOKEN), portuguese = input.portugueseToken ? openTicket(input.portugueseToken, env.ADMIN_TOKEN) : null;
        if (english.language !== 'en' || portuguese && (portuguese.language !== 'pt' || portuguese.type !== english.type || portuguese.videoId !== english.videoId)) throw fail('Selecione legendas em inglês e português do mesmo episódio.');
        const [en, pt] = await Promise.all([download(english.url), portuguese ? download(portuguese.url) : Promise.resolve([])]);
        const offset = Math.max(-60000, Math.min(60000, Number(input.translationOffset) || 0));
        return send(201, await storage.create(validateProfile({ title: input.title || english.videoId, type: english.type, videoId: english.videoId, cues: pairSubtitles(en, pt, offset), config: config() })));
      }
      if (parts[1] === 'translate' && req.method === 'POST') {
        const input = await readBody(req);
        if (!providers(env)[input.provider]) throw fail('Configure um tradutor acessível pela internet nas variáveis da Vercel. localhost não acessa o Ollama do seu computador.');
        return send(200, { cues: await translateCues(input.cues, input.provider, env, (url, payload) => translationRequest(env, url, payload)) });
      }
      throw fail('Rota ou método não encontrado.', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      send(error.status || 400, { error: error.status ? error.message : 'Não foi possível concluir. Confira os dados e a configuração do serviço.' });
    }
  };
}
