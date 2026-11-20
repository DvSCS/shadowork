import { Readable } from 'node:stream';
import { createHandler } from '../server/app.js';
import { createStorage } from '../server/storage.js';
export const SECRET = 'test-secret-with-more-than-32-characters-only';
export function fakeRedis() {
  const strings = new Map(), hashes = new Map(), commands = [];
  const hash = key => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const fetcher = async (url, options) => {
    const args = JSON.parse(options.body); commands.push(args);
    const [command, ...rest] = args; let result;
    if (command === 'GET') result = strings.get(rest[0]) || null;
    else if (command === 'HVALS') result = [...hash(rest[0]).values()];
    else if (command === 'EVAL') {
      const [script, number, ...values] = rest, keys = values.slice(0, number), argv = values.slice(number);
      if (script.includes("'HLEN'")) {
        if (hash(keys[1]).size >= 100) result = -1;
        else if (strings.has(keys[0])) result = 0;
        else { strings.set(keys[0], argv[1]); hash(keys[1]).set(argv[0], argv[2]); result = 1; }
      } else if (script.includes('cjson.decode')) {
        const prior = strings.get(keys[0]);
        if (!prior) result = 0;
        else if (JSON.parse(prior).revision !== Number(argv[0])) result = -1;
        else { strings.set(keys[0], argv[2]); hash(keys[1]).set(argv[1], argv[3]); result = 1; }
      } else if (script.includes("'INCR'")) { result = Number(strings.get(keys[0]) || 0) + 1; strings.set(keys[0], String(result)); }
      else if (script.includes("'DEL'")) { result = strings.delete(keys[0]) ? 1 : 0; hash(keys[1]).delete(argv[0]); }
      else throw new Error('Unknown Lua test fixture');
    } else throw new Error('Unsupported command in test fixture');
    return new Response(JSON.stringify({ result }));
  };
  return { fetcher, commands, strings, hashes };
}
export const environment = extra => ({ ADMIN_TOKEN: SECRET, UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'redis-test-token', ...extra });
export function setup(extra = {}, redis = fakeRedis()) {
  const env = environment(extra), storage = createStorage(env, redis.fetcher);
  return { env, storage, redis, handler: createHandler({ env, storage }) };
}
export async function request(handler, url, { method = 'GET', data, headers = {}, parsed = false } = {}) {
  const body = data === undefined ? undefined : JSON.stringify(data);
  const req = Readable.from(body ? [Buffer.from(body)] : []); req.method = method; req.url = url;
  req.headers = { host: 'localhost:7778', ...(body ? { 'content-type': 'application/json' } : {}), ...headers };
  req.socket = { remoteAddress: '127.0.0.1' }; if (parsed && data !== undefined) req.body = data;
  const result = { status: 0, headers: {}, text: '' };
  const res = { headersSent: false, writeHead(status, headers) { result.status = status; result.headers = headers; this.headersSent = true; }, end(text) { result.text = text || ''; } };
  await handler(req, res);
  try { result.json = JSON.parse(result.text); } catch { }
  return result;
}
export async function login(handler, options = {}) {
  const result = await request(handler, '/api/auth/login', { method: 'POST', data: { password: SECRET }, ...options });
  if (result.status !== 200) throw new Error(`Test login failed: ${result.text}`);
  return result.headers['Set-Cookie'].split(';')[0];
}
