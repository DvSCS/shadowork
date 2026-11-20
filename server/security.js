import { createHmac, createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { fail } from './domain.js';
export const SESSION_COOKIE = 'scenelingo_session';
const SESSION_SECONDS = 7 * 86400;
const digest = text => createHash('sha256').update(String(text)).digest();
export function adminConfigured(env) { return typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length >= 32; }
export function sameSecret(a, b) { return timingSafeEqual(digest(a), digest(b)); }
export function signSession(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_SECONDS * 1000, purpose: 'admin' })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifySession(value, secret, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 2000 || !secret) return false;
  const [payload, mac, extra] = value.split('.'); if (!payload || !mac || extra) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!sameSecret(mac, expected)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.purpose === 'admin' && Number.isFinite(data.exp) && data.exp > now; } catch { return false; }
}
export function authenticated(req, env) {
  if (!adminConfigured(env)) return false;
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)));
  return verifySession(cookies[SESSION_COOKIE], env.ADMIN_TOKEN);
}
export function sessionCookie(value, secure = true, clear = false) { return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`; }
export function sealTicket(data, secret, now = Date.now()) {
  const key = digest(`scenelingo-tickets:${secret}`), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...data, exp: now + 900000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openTicket(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 16000) throw new Error();
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', digest(`scenelingo-tickets:${secret}`), bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    if (!Number.isFinite(value.exp) || value.exp <= now) throw new Error();
    return value;
  } catch { throw fail('Pesquisa inválida ou expirada. Busque as legendas novamente.'); }
}
export function requestOrigin(req, env) {
  const host = String(req.headers.host || '').trim();
  if (!/^[a-z0-9.\-]+(?::\d{1,5})?$/i.test(host)) throw fail('Host inválido.', 400);
  return `${env.VERCEL ? 'https' : 'http'}://${host}`;
}
export function checkOrigin(req, origin) {
  if (req.headers.origin && req.headers.origin !== origin) throw fail('Origem não autorizada.', 403);
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Origem não autorizada.', 403);
}
export function clientKey(req, secret) {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}
