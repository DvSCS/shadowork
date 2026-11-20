import { normalize } from '../shared/core.js';
import { searchSubtitles, httpUrl, limitedFetch } from './subtitle-provider.js';

function identity(type, requestedId, extra) {
  const params = new URLSearchParams(extra || ''), parts = (params.get('videoID') || params.get('videoId') || requestedId).split(':');
  if (!/^tt\d{1,12}$/.test(parts[0])) return null;
  if (type === 'series' && (!/^\d{1,4}$/.test(parts[1] || '') || !/^\d{1,5}$/.test(parts[2] || ''))) return null;
  return { id: parts[0], season: type === 'series' ? Number(parts[1]) : null, episode: type === 'series' ? Number(parts[2]) : null, filename: params.get('filename') || '' };
}
export async function searchLegacy(type, requestedId, extra = '', fetcher = fetch) {
  const item = identity(type, requestedId, extra); if (!item) return [];
  const numeric = item.id.replace(/^tt0*/, '');
  const base = type === 'series' ? `episode-${item.episode}/imdbid-${numeric}/season-${item.season}` : `imdbid-${numeric}`;
  const settled = await Promise.allSettled(['eng', 'pob', 'por'].map(async lang => {
    const fetchWithHeaders = (url, options) => fetcher(url, { ...options, headers: { ...options.headers, 'User-Agent': 'SceneLingo/1.3', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const bytes = await limitedFetch(`https://rest.opensubtitles.org/search/${base}/sublanguageid-${lang}`, 5 * 1024 * 1024, fetchWithHeaders);
    const rows = JSON.parse(bytes.toString('utf8')); if (!Array.isArray(rows)) return [];
    return rows.filter(row => row.SubDownloadLink && ['srt', 'vtt'].includes(String(row.SubFormat || 'srt').toLowerCase())).slice(0, 150).map(row => ({
      language: lang === 'eng' ? 'en' : 'pt', region: lang === 'pob' ? 'pt-BR' : lang === 'por' ? 'pt-PT' : 'en',
      url: httpUrl(row.SubDownloadLink).href, label: String(row.MovieReleaseName || row.SubFileName || row.MovieName || '').slice(0, 220),
      source: 'OpenSubtitles direto', downloads: Number(row.SubDownloadsCnt) || 0, hearingImpaired: row.SubHearingImpaired === '1',
    }));
  }));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
export async function searchWyzie(type, requestedId, extra, key, fetcher = fetch) {
  const item = identity(type, requestedId, extra); if (!item || !key) return [];
  const url = new URL('https://sub.wyzie.io/search');
  url.search = new URLSearchParams({ id: item.id, key, language: 'en,pt,pt-br', format: 'srt', ...(item.season !== null ? { season: String(item.season), episode: String(item.episode) } : {}), ...(item.filename ? { video: item.filename } : {}) }).toString();
  const bytes = await limitedFetch(url.href, 5 * 1024 * 1024, (url, options) => fetcher(url, { ...options, signal: AbortSignal.timeout(8000) }));
  const rows = JSON.parse(bytes.toString('utf8')); if (!Array.isArray(rows)) return [];
  return rows.filter(row => row.url && /^(en|pt)(-|$)/i.test(row.language || '')).map(row => ({ url: httpUrl(row.url).href, language: /^en/i.test(row.language) ? 'en' : 'pt', region: row.language, label: String(row.fileName || row.matchedRelease || row.display || '').slice(0, 220), source: `Wyzie · ${row.source || 'agregador'}`, downloads: Number(row.downloadCount) || 0 }));
}
export function rankSources(results, filename = '') {
  const tokens = new Set(normalize(filename).split(' ').filter(token => token.length > 2)), seen = new Set();
  return results.filter(row => { if (!row.url || seen.has(row.url)) return false; seen.add(row.url); return true; }).map((row, index) => ({ row, score: normalize(row.label).split(' ').reduce((sum, token) => sum + (tokens.has(token) ? 20 : 0), 0) + (row.region === 'pt-BR' ? 3 : 0) + Math.log10(1 + (Number(row.downloads) || 0)) - (row.hearingImpaired ? 1 : 0) - index * .00001 })).sort((a, b) => b.score - a.score).map(item => item.row);
}
export async function searchMaster(primary, type, requestedId, fetcher = fetch, extra = '', env = {}) {
  const addonUrls = [...new Set([primary, ...String(env.SUBTITLE_ADDON_URLS || '').split(',')].map(url => url?.trim()).filter(Boolean))].slice(0, 4);
  const jobs = [searchLegacy(type, requestedId, extra, fetcher), ...addonUrls.map(async source => {
    const fastFetch = (url, options) => fetcher(url, { ...options, signal: AbortSignal.timeout(8000) });
    return (await searchSubtitles(source, type, requestedId, fastFetch, extra)).map(row => ({ ...row, source: 'Addon alternativo' }));
  })];
  if (env.WYZIE_API_KEY) jobs.push(searchWyzie(type, requestedId, extra, env.WYZIE_API_KEY, fetcher));
  const settled = await Promise.allSettled(jobs);
  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const filename = new URLSearchParams(extra).get('filename') || '';
  return rankSources(results, filename);
}
