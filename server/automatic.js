import { createHash } from 'node:crypto';
import { config, pairSubtitles, toSrt, normalize, synchronizeTranslation } from '../shared/core.js';
import { searchSubtitles, downloadSubtitles } from './subtitle-provider.js';
import { openTicket, sealCompressedTicket, openCompressedTicket, adminConfigured } from './security.js';
import { fail } from './domain.js';
import { searchMaster } from './master-source.js';

// Public SubSense profile with EN + PT-BR + PT-PT. It aggregates several
// providers and avoids relying on the Legacy endpoint from Vercel IPs.
export const DEFAULT_SOURCE = 'https://subsense.nepiraw.com/sceneln1-%7B%22languages%22%3A%5B%22eng%22%2C%22pob%22%2C%22por%22%5D%2C%22maxSubtitles%22%3A10%7D/manifest.json';
export const AUTO_MODES = ['progressive', 'delayed', 'bilingual', 'english'];
export function automaticConfig(env) {
  return config({ mode: env.AUTO_MODE || 'delayed', translationDelay: Number(env.AUTO_TRANSLATION_DELAY || 1000), showOriginal: env.AUTO_SHOW_ORIGINAL !== 'false', subtitleOffset: Number(env.AUTO_SUBTITLE_OFFSET || 0) });
}
export function addonSecret(env) {
  if (typeof env.ADDON_SECRET === 'string' && env.ADDON_SECRET.length >= 32) return env.ADDON_SECRET;
  if (adminConfigured(env)) return env.ADMIN_TOKEN;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (typeof redisToken === 'string' && redisToken.length >= 16) return createHash('sha256').update(`scenelingo-public-addon:${redisToken}`).digest('base64url');
  throw fail('Configure o Redis ou ADDON_SECRET para ativar os links do addon.', 503);
}
function choosePortuguese(english, portuguese, filename) {
  const ignored = new Set(['the', 'and', 'uma', 'com', '1080p', '720p', '2160p', 'x264', 'x265', 'h264', 'h265', 'hevc', 'aac', 'ddp']);
  const tokens = new Set(normalize(`${english.label} ${filename || ''}`).split(' ').filter(t => t.length > 2 && !ignored.has(t)));
  return portuguese.map((candidate, index) => ({ candidate, score: (candidate.exactHash === english.exactHash ? 100 : 0) + (candidate.exactHash ? 100 : 0) + normalize(candidate.label).split(' ').reduce((sum, token) => sum + (tokens.has(token) ? 8 : 0), 0) + (candidate.region === 'pt-BR' ? 3 : 0) - index * .001 })).sort((a, b) => b.score - a.score)[0]?.candidate;
}
function shortRelease(item, index) {
  if (item.exactHash) return '✓ arquivo';
  const text = normalize(item.label);
  const kind = text.includes('bluray') || text.includes('brrip') ? 'BluRay' : text.includes('web') ? 'WEB' : text.includes('hdtv') ? 'HDTV' : text.includes('dvd') ? 'DVD' : '';
  return `${index + 1}${kind ? ` ${kind}` : ''}`;
}
export function createAutomatic({ env, storage, search = searchMaster, download = downloadSubtitles }) {
  return {
    manifest(base) { return { id: 'community.scenelingo.automatic', version: '1.4.2', name: 'SceneLingo · Inglês automático', description: 'Busca inglês e português automaticamente para o filme ou episódio aberto. Instale uma vez; sem importar legendas ou cadastrar episódios. Disponibilidade e sincronia dependem da fonte.', resources: ['subtitles'], types: ['movie', 'series'], catalogs: [], logo: `${base}/assets/logo.svg`, behaviorHints: { configurable: false } }; },
    async options(type, requestedId, rawExtra, base) {
      const secret = addonSecret(env);
      if (!['movie', 'series'].includes(type) || !/^[\w:.-]{1,180}$/.test(requestedId)) throw fail('Vídeo inválido.');
      const extra = new URLSearchParams(rawExtra || '');
      const videoId = extra.get('videoID') || extra.get('videoId') || requestedId;
      // Preserve the incoming file hash/ID and extras; providers can match the release.
      const searchId = 'search-' + createHash('sha256').update(JSON.stringify({ source: env.SUBTITLE_ADDON_URL || DEFAULT_SOURCE, extraSources: env.SUBTITLE_ADDON_URLS || '', wyzie: env.WYZIE_API_KEY || '', type, requestedId, extra: extra.toString() })).digest('hex');
      let results;
      try { results = await storage.cacheGet(searchId); } catch { }
      if (!Array.isArray(results)) {
        results = await search(env.SUBTITLE_ADDON_URL || DEFAULT_SOURCE, type, requestedId, fetch, extra.toString(), env);
        try { await storage.cachePut(searchId, results, results.length ? 3600 : 120); } catch { }
      }
      const maxReleases = Math.min(3, Math.max(1, Number.parseInt(env.AUTO_MAX_RELEASES || '2', 10) || 2));
      const english = results.filter(item => item.language === 'en').slice(0, maxReleases), portuguese = results.filter(item => item.language === 'pt');
      const subtitles = [];
      for (const [index, en] of english.entries()) {
        const pt = choosePortuguese(en, portuguese, extra.get('filename'));
        const enFallbacks = english.filter(row => row.url !== en.url).map(row => row.url).slice(0, 2);
        const ptFallbacks = portuguese.filter(row => row.url !== pt?.url).map(row => row.url).slice(0, 2);
        const ticketData = { purpose: 'automatic-subtitle', type, videoId, en: en.url, pt: pt?.url || '', enFallbacks, ptFallbacks, config: automaticConfig(env) };
        // Prefer a short Redis-backed ID to keep the URL within player limits
        // (~2048 chars). Fall back to the self-contained compressed ticket
        // when Redis is unavailable or the write fails.
        let ticket;
        if (storage.configured) {
          const shortId = createHash('sha256').update(JSON.stringify(ticketData)).digest('hex').slice(0, 32);
          try { await storage.cachePut(`auto-ticket:${shortId}`, ticketData, 2 * 86400); ticket = shortId; } catch { /* fall through */ }
        }
        if (!ticket) ticket = sealCompressedTicket(ticketData, secret, Date.now(), 2 * 86400000);
        const modes = [automaticConfig(env).mode, ...AUTO_MODES].filter((m, i, all) => all.indexOf(m) === i && AUTO_MODES.includes(m));
        for (const mode of pt ? modes : ['english']) {
          const modeName = ({ progressive: 'Progressiva', delayed: 'Atraso EN→PT', bilingual: 'Dupla EN + PT', english: 'Só inglês' })[mode];
          const label = `SL ${shortRelease(en, index)} · ${modeName}`;
          subtitles.push({ id: `scenelingo-auto-${index}-${mode}`, lang: mode === 'english' ? 'eng' : 'por', label, name: label, url: `${base}/auto/${ticket}/${mode}.srt` });
        }
      }
      return { subtitles, cacheMaxAge: 0 };
    },
    async subtitle(ticket, mode) {
      const secret = addonSecret(env);
      if (!AUTO_MODES.includes(mode)) throw fail('Modo inválido.');
      let data;
      if (/^[\w-]{32}$/.test(ticket)) {
        try { data = await storage.cacheGet(`auto-ticket:${ticket}`); } catch { }
      }
      if (!data) {
        try { data = openCompressedTicket(ticket, secret); }
        catch { data = openTicket(ticket, secret); }
      }
      if (data.purpose !== 'automatic-subtitle' || typeof data.en !== 'string') throw fail('Link de legenda inválido.');
      // Bump the cache recipe whenever pairing/synchronization changes, so a new
      // deploy never keeps serving captions generated by an older buggy build.
      const id = createHash('sha256').update(JSON.stringify({ recipe: 'sync-v2', en: data.en, pt: data.pt })).digest('hex');
      let cues;
      try { cues = await storage.cacheGet(id); } catch { /* Cache failure does not prevent watching. */ }
      if (!cues) {
        const firstReadable = async urls => {
          let lastError;
          for (const url of [...new Set(urls.filter(Boolean))].slice(0, 3)) {
            try { const result = await download(url, (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(9000) })); if (result.length) return result; } catch (error) { lastError = error; }
          }
          throw lastError || fail('Nenhuma legenda legível foi encontrada.', 502);
        };
        const [en, pt] = await Promise.all([firstReadable([data.en, ...(data.enFallbacks || [])]), data.pt ? firstReadable([data.pt, ...(data.ptFallbacks || [])]).catch(() => []) : Promise.resolve([])]);
        const synchronized = synchronizeTranslation(en, pt);
        cues = pairSubtitles(en, synchronized.cues);
        try { if (Buffer.byteLength(JSON.stringify(cues)) <= 3000000) await storage.cachePut(id, cues); } catch { /* The fetched subtitles are still usable. */ }
      }
      return toSrt(cues, { ...data.config, mode });
    },
  };
}
