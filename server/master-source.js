import { normalize } from '../shared/core.js';
import { searchSubtitles, httpUrl, limitedFetch } from './subtitle-provider.js';

function identity(type, requestedId, extra) {
  const params = new URLSearchParams(extra || ''), parts = (params.get('videoID') || params.get('videoId') || requestedId).split(':');
  if (!/^tt\d{1,12}$/.test(parts[0])) return null;
  if (type === 'series' && (!/^\d{1,4}$/.test(parts[1] || '') || !/^\d{1,5}$/.test(parts[2] || ''))) return null;
  const videoHash = params.get('videoHash') || params.get('fileHash') || '';
  const videoSize = params.get('videoSize') || params.get('fileSize') || '';
  return { id: parts[0], season: type === 'series' ? Number(parts[1]) : null, episode: type === 'series' ? Number(parts[2]) : null, filename: params.get('filename') || '', videoHash: /^[a-f\d]{16}$/i.test(videoHash) ? videoHash.toLowerCase() : '', videoSize: /^\d{6,15}$/.test(videoSize) ? videoSize : '' };
}
export async function searchLegacy(type, requestedId, extra = '', fetcher = fetch) {
  const item = identity(type, requestedId, extra); if (!item) return [];
  const numeric = item.id.replace(/^tt0*/, '');
  const imdbBase = type === 'series' ? `episode-${item.episode}/imdbid-${numeric}/season-${item.season}` : `imdbid-${numeric}`;
  const bases = [...(item.videoHash && item.videoSize ? [{ path: `moviebytesize-${item.videoSize}/moviehash-${item.videoHash}`, exactHash: true }] : []), { path: imdbBase, exactHash: false }];
  const settled = await Promise.allSettled(bases.flatMap(base => ['eng', 'pob', 'por'].map(async lang => {
    const fetchWithHeaders = (url, options) => fetcher(url, { ...options, headers: { ...options.headers, 'User-Agent': 'SceneLingo/1.3', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const bytes = await limitedFetch(`https://rest.opensubtitles.org/search/${base.path}/sublanguageid-${lang}`, 5 * 1024 * 1024, fetchWithHeaders);
    const rows = JSON.parse(bytes.toString('utf8')); if (!Array.isArray(rows)) return [];
    return rows.filter(row => row.SubDownloadLink && ['srt', 'vtt'].includes(String(row.SubFormat || 'srt').toLowerCase())).slice(0, 150).map(row => ({
      language: lang === 'eng' ? 'en' : 'pt', region: lang === 'pob' ? 'pt-BR' : lang === 'por' ? 'pt-PT' : 'en',
      url: httpUrl(row.SubDownloadLink).href, label: String(row.MovieReleaseName || row.SubFileName || row.MovieName || '').slice(0, 220),
      source: base.exactHash ? 'OpenSubtitles · arquivo exato' : 'OpenSubtitles direto', exactHash: base.exactHash,
      downloads: Number(row.SubDownloadsCnt) || 0, hearingImpaired: row.SubHearingImpaired === '1',
    }));
  })));
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
  const ignored = new Set(['the', 'and', 'uma', 'com', '1080p', '720p', '2160p', 'x264', 'x265', 'h264', 'h265', 'hevc', 'aac', 'ddp', 'web', 'dl']);
  const tokens = new Set(normalize(filename).split(' ').filter(token => token.length > 2 && !ignored.has(token))), seen = new Set();
  const tags = value => new Set((normalize(value).match(/\b(bluray|brrip|webrip|webdl|hdtv|dvdrip|remux|cam|telesync|proper|repack)\b/g) || []));
  const wantedTags = tags(filename);
  return results.filter(row => { if (!row.url || seen.has(row.url)) return false; seen.add(row.url); return true; }).map((row, index) => {
    const labelTokens = normalize(row.label).split(' '), rowTags = tags(row.label);
    const matches = labelTokens.reduce((sum, token) => sum + (tokens.has(token) ? 24 : 0), 0);
    const tagBonus = wantedTags.size ? [...wantedTags].some(tag => rowTags.has(tag)) ? 35 : rowTags.size ? -25 : 0 : 0;
    return { row, score: (row.exactHash ? 250 : 0) + matches + tagBonus + (row.region === 'pt-BR' ? 3 : 0) + Math.log10(1 + (Number(row.downloads) || 0)) - (row.hearingImpaired ? 1 : 0) - index * .00001 };
  }).sort((a, b) => b.score - a.score).map(item => item.row);
}
export async function searchMaster(primary, type, requestedId, fetcher = fetch, extra = '', env = {}) {
  const addonUrls = [...new Set([primary, 'https://opensubtitles-v3.strem.io/manifest.json', ...String(env.SUBTITLE_ADDON_URLS || '').split(',')].map(url => url?.trim()).filter(Boolean))].slice(0, 4);
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
