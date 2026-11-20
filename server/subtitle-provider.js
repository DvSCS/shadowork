import { gunzipSync } from 'node:zlib';
import { parseSubtitles } from '../shared/core.js';

export function httpUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('O provedor retornou uma URL inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('O provedor deve usar uma URL HTTP/HTTPS sem credenciais de navegador.');
  return url;
}
export async function limitedFetch(url, maxBytes, fetcher = fetch) {
  const response = await fetcher(httpUrl(url), { signal: AbortSignal.timeout(20000), headers: { Accept: '*/*' } });
  if (!response.ok) throw new Error(`O provedor de legendas respondeu HTTP ${response.status}.`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) { throw new Error('A resposta do provedor excedeu o tamanho permitido.'); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export async function searchSubtitles(manifestUrl, type, videoId, fetcher = fetch, extra = '') {
  const manifest = httpUrl(manifestUrl);
  if (!manifest.pathname.endsWith('/manifest.json')) throw new Error('SUBTITLE_ADDON_URL deve terminar em /manifest.json.');
  manifest.pathname = manifest.pathname.replace(/\/manifest\.json$/, `/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(videoId)}${extra ? '/' + extra : ''}.json`);
  const raw = await limitedFetch(manifest.href, 2 * 1024 * 1024, fetcher);
  let data; try { data = JSON.parse(raw.toString('utf8')); } catch { throw new Error('O addon de origem não retornou um JSON de legendas.'); }
  if (!Array.isArray(data.subtitles)) throw new Error('O addon não retornou o recurso subtitles.');
  return data.subtitles.slice(0, 500).filter(s => typeof s.url === 'string' && typeof s.lang === 'string').map(s => {
    const lang = s.lang.toLowerCase().replace(/_/g, '-');
    const language = ['en', 'eng', 'english'].includes(lang) || /^en-/.test(lang) ? 'en' : ['pt', 'por', 'pob', 'pb', 'portuguese', 'brazilian portuguese'].includes(lang) || /^pt-/.test(lang) ? 'pt' : null;
    return { url: httpUrl(s.url).href, language, label: String(s.name || s.label || s.id || s.lang).slice(0, 220) };
  }).filter(s => s.language);
}
export async function downloadSubtitles(url, fetcher = fetch) {
  let bytes = await limitedFetch(url, 8 * 1024 * 1024, fetcher);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 });
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1252').decode(bytes); } }
  const cues = parseSubtitles(text);
  if (!cues.length) throw new Error('A legenda não está em SRT/VTT UTF-8. ZIP, ASS e legendas em imagem precisam ser convertidos antes de importar.');
  return cues;
}
