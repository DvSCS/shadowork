import { fail } from './domain.js';
export const MAX_PROFILE_BYTES = 3000000;
const CREATE = `local count=redis.call('HLEN',KEYS[2]); if count>=100 then return -1 end; if redis.call('EXISTS',KEYS[1])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); redis.call('HSET',KEYS[2],ARGV[1],ARGV[3]); return 1`;
const UPDATE = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local current=cjson.decode(raw); if tonumber(current.revision or 0)~=tonumber(ARGV[1]) then return -1 end; redis.call('SET',KEYS[1],ARGV[3]); redis.call('HSET',KEYS[2],ARGV[2],ARGV[4]); return 1`;
const DELETE = `local n=redis.call('DEL',KEYS[1]); redis.call('HDEL',KEYS[2],ARGV[1]); return n`;
const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
export function summarize(profile) { const { cues, ...metadata } = profile; return { ...metadata, cueCount: cues.length }; }
export function createStorage(env, fetcher = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const configured = Boolean(url && token), prefix = String(env.REDIS_PREFIX || 'scenelingo');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix)) throw fail('REDIS_PREFIX deve conter somente letras, números, _ e -.', 503);
  const base = `${prefix}:{scenelingo}`, index = `${base}:index`, key = id => `${base}:profile:${id}`;
  async function command(...args) {
    if (!configured) throw fail('Configure Upstash Redis nas variáveis da Vercel para salvar sessões.', 503);
    let response;
    try { response = await fetcher(String(url).replace(/\/$/, ''), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) }); }
    catch { throw fail('Não foi possível conectar ao banco de sessões.', 503); }
    if (!response.ok) throw fail('O banco de sessões recusou a conexão. Confira as variáveis de ambiente.', 503);
    let data; try { data = await response.json(); } catch { throw fail('O banco retornou uma resposta inválida.', 503); }
    if (data.error) throw fail('O banco não concluiu a operação.', 503);
    return data.result;
  }
  const json = profile => { const serialized = JSON.stringify(profile); if (Buffer.byteLength(serialized) > MAX_PROFILE_BYTES) throw fail('A sessão excede 3 MB. Divida a legenda em trechos menores.', 413); return serialized; };
  return {
    configured,
    async cacheGet(id) { if (!configured) return null; const raw = await command('GET', `${base}:auto:${id}`); return raw ? JSON.parse(raw) : null; },
    async cachePut(id, value, ttl = 604800) { if (configured) await command('SET', `${base}:auto:${id}`, JSON.stringify(value), 'EX', ttl); },
    async list() { const values = await command('HVALS', index); return (values || []).map(raw => JSON.parse(raw)).sort((a, b) => b.updatedAt - a.updatedAt); },
    async get(id) { const raw = await command('GET', key(id)); return raw ? JSON.parse(raw) : null; },
    async create(profile) {
      const value = { ...profile, revision: 1 };
      const result = await command('EVAL', CREATE, 2, key(profile.id), index, profile.id, json(value), JSON.stringify(summarize(value)));
      if (result === -1) throw fail('Limite de 100 sessões atingido.', 409);
      if (result !== 1) throw fail('A sessão já existe.', 409);
      return value;
    },
    async update(profile, expectedRevision) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw fail('Atualize a página antes de salvar esta sessão.', 409);
      const value = { ...profile, revision: expectedRevision + 1 };
      const result = await command('EVAL', UPDATE, 2, key(profile.id), index, expectedRevision, profile.id, json(value), JSON.stringify(summarize(value)));
      if (result === 0) throw fail('Sessão não encontrada.', 404);
      if (result !== 1) throw fail('Esta sessão mudou em outra aba. Exporte suas alterações e atualize a página antes de salvar.', 409);
      return value;
    },
    async delete(id) { if (!(await command('EVAL', DELETE, 2, key(id), index, id))) throw fail('Sessão não encontrada.', 404); },
    async allowLogin(client, max = 8) { return await command('EVAL', RATE, 1, `${base}:login:${client}`, 60) <= max; },
  };
}
