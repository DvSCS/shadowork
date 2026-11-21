import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLegacy, searchMaster, rankSources, searchWyzie } from '../server/master-source.js';
test('busca direta encontra EN e PT-BR e identifica temporada e episódio', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(String(url)); const english = String(url).endsWith('eng'); return new Response(JSON.stringify([{ SubDownloadLink: `https://files.example/${english ? 'en' : 'pt'}.gz`, SubFormat: 'srt', SubFileName: 'release.srt', SubDownloadsCnt: '100' }])); };
  const results = await searchLegacy('series', 'tt0903747:2:3', '', fetcher);
  assert.ok(urls.every(url => url.includes('episode-3/imdbid-903747/season-2')));
  assert.ok(results.some(row => row.language === 'en')); assert.ok(results.some(row => row.region === 'pt-BR'));
});
test('hash e tamanho do vídeo têm prioridade sobre uma busca apenas por IMDb', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(String(url)); return new Response(JSON.stringify([{ SubDownloadLink: `https://files.example/${urls.length}.gz`, SubFormat: 'srt', MovieReleaseName: 'release' }])); };
  const results = await searchLegacy('movie', 'tt0241527', 'videoHash=0123456789abcdef&videoSize=123456789', fetcher);
  assert.ok(urls.some(url => url.includes('moviebytesize-123456789/moviehash-0123456789abcdef')));
  assert.equal(rankSources(results)[0].exactHash, true);
});
test('fonte secundária indisponível não impede os resultados da principal', async () => {
  const fetcher = async url => {
    if (String(url).includes('addon.example')) return new Response('offline', { status: 503 });
    return new Response(JSON.stringify([{ SubDownloadLink: 'https://files.example/test.gz', SubFormat: 'srt', MovieReleaseName: 'BluRay' }]));
  };
  const results = await searchMaster('https://addon.example/manifest.json', 'movie', 'tt0241527', fetcher);
  assert.equal(results.length, 1); assert.equal(results[0].source, 'OpenSubtitles direto');
});
test('prioriza versão do vídeo e remove arquivos duplicados', () => {
  const results = rankSources([{ url: 'a', label: 'WEB DL', downloads: 100 }, { url: 'b', label: 'BluRay ReleaseGroup', downloads: 2 }, { url: 'a', label: 'duplicate' }], 'Movie.BluRay.ReleaseGroup.mkv');
  assert.equal(results.length, 2); assert.equal(results[0].url, 'b');
});
test('Wyzie recebe chave do operador e episódio, sem criar credenciais', async () => {
  let requested;
  const results = await searchWyzie('series', 'tt0903747:1:2', '', 'operator-test-key', async url => { requested = new URL(url); return new Response(JSON.stringify([{ url: 'https://sub.wyzie.io/c/example?tok=opaque', language: 'pt-br', fileName: 'episode.srt' }])); });
  assert.equal(requested.searchParams.get('season'), '1'); assert.equal(requested.searchParams.get('episode'), '2'); assert.equal(requested.searchParams.get('key'), 'operator-test-key'); assert.equal(results[0].language, 'pt');
});
