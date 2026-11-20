import { createHash } from 'node:crypto';
import { config, pairSubtitles, toSrt, normalize } from '../shared/core.js';
import { searchSubtitles, downloadSubtitles } from './subtitle-provider.js';
import { sealTicket, openTicket, adminConfigured } from './security.js';
import { fail } from './domain.js';
import { searchMaster } from './master-source.js';

export const DEFAULT_SOURCE = 'https://opensubtitles-v3.strem.io/manifest.json';
export const AUTO_MODES = ['progressive', 'delayed', 'bilingual', 'english'];
export function automaticConfig(env) {
  return config({ mode: env.AUTO_MODE || 'delayed', translationDelay: Number(env.AUTO_TRANSLATION_DELAY || 1000), showOriginal: env.AUTO_SHOW_ORIGINAL !== 'false', subtitleOffset: Number(env.AUTO_SUBTITLE_OFFSET || 0) });
}
function requireSecret(env) { if (!adminConfigured(env)) throw fail('Configure ADMIN_TOKEN uma única vez para ativar o addon automático.', 503); }
function choosePortuguese(english, portuguese, filename) {
  const tokens = new Set(normalize(`${english.label} ${filename || ''}`).split(' ').filter(t => t.length > 2));
  return portuguese.map((candidate, index) => ({ candidate, score: normalize(candidate.label).split(' ').reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0) - index * .001 })).sort((a, b) => b.score - a.score)[0]?.candidate;
}
export function createAutomatic({ env, storage, search = searchMaster, download = downloadSubtitles }) {
  return {
    manifest(base) { return { id: 'community.scenelingo.automatic', version: '1.3.0', name: 'SceneLingo · Inglês automático', description: 'Busca inglês e português automaticamente para o filme ou episódio aberto. Instale uma vez; sem importar legendas ou cadastrar episódios. Disponibilidade e sincronia dependem da fonte.', resources: ['subtitles'], types: ['movie', 'series'], catalogs: [], logo: `${base}/assets/logo.svg`, behaviorHints: { configurable: false } }; },
    async options(type, requestedId, rawExtra, base) {
      requireSecret(env);
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
      const english = results.filter(item => item.language === 'en').slice(0, 3), portuguese = results.filter(item => item.language === 'pt');
      const subtitles = [];
      for (const [index, en] of english.entries()) {
        const pt = choosePortuguese(en, portuguese, extra.get('filename'));
        const enFallbacks = english.filter(row => row.url !== en.url).map(row => row.url).slice(0, 2);
        const ptFallbacks = portuguese.filter(row => row.url !== pt?.url).map(row => row.url).slice(0, 2);
        const ticket = sealTicket({ purpose: 'automatic-subtitle', type, videoId, en: en.url, pt: pt?.url || '', enFallbacks, ptFallbacks, config: automaticConfig(env) }, env.ADMIN_TOKEN, Date.now(), 2 * 86400000);
        const modes = [automaticConfig(env).mode, ...AUTO_MODES].filter((m, i, all) => all.indexOf(m) === i && AUTO_MODES.includes(m));
        for (const mode of pt ? modes : ['english']) subtitles.push({ id: `scenelingo-auto-${index}-${mode}`, lang: mode === 'english' ? 'eng' : 'por', name: `SceneLingo · ${({ progressive: 'Progressiva por frases', delayed: 'Inglês → português com atraso', bilingual: 'Inglês + português', english: 'Somente inglês' })[mode]} · ${en.source || 'opção ' + (index + 1)}`, url: `${base}/auto/${ticket}/${mode}.srt` });
      }
      return { subtitles, cacheMaxAge: 0 };
    },
    async subtitle(ticket, mode) {
      requireSecret(env);
      if (!AUTO_MODES.includes(mode)) throw fail('Modo inválido.');
      const data = openTicket(ticket, env.ADMIN_TOKEN);
      if (data.purpose !== 'automatic-subtitle' || typeof data.en !== 'string') throw fail('Link de legenda inválido.');
      const id = createHash('sha256').update(JSON.stringify({ en: data.en, pt: data.pt })).digest('hex');
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
        cues = pairSubtitles(en, pt);
        try { if (Buffer.byteLength(JSON.stringify(cues)) <= 3000000) await storage.cachePut(id, cues); } catch { /* The fetched subtitles are still usable. */ }
      }
      return toSrt(cues, { ...data.config, mode });
    },
  };
}
