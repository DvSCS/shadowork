import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { searchSubtitles, downloadSubtitles, httpUrl } from '../server/subtitle-provider.js';
test('busca reaproveita um addon existente e filtra os idiomas', async () => {
  let requested;
  const result = await searchSubtitles('https://provider.example/config/manifest.json', 'series', 'tt0903747:1:1', async url => {
    requested = String(url);
    return new Response(JSON.stringify({ subtitles: [{ id: 'en-release', lang: 'eng', url: 'https://files.example/en.srt' }, { id: 'pt-release', lang: 'pob', url: 'https://files.example/pt.srt' }, { id: 'fr', lang: 'fre', url: 'https://files.example/fr.srt' }] }));
  });
  assert.match(requested, /config\/subtitles\/series\/tt0903747%3A1%3A1.json/);
  assert.equal(result.length, 2); assert.equal(result[0].language, 'en'); assert.equal(result[1].language, 'pt');
});
test('downloads aceitam SRT simples ou gzip, e recusam URLs não HTTP', async () => {
  const text = '1\n00:00:01,000 --> 00:00:02,000\nHello.\n';
  for (const bytes of [Buffer.from(text), gzipSync(text)]) { const result = await downloadSubtitles('https://files.example/a.srt', async () => new Response(bytes)); assert.equal(result[0].text, 'Hello.'); }
  assert.throws(() => httpUrl('file:///etc/passwd'));
  await assert.rejects(downloadSubtitles('https://files.example/a.zip', async () => new Response('not subtitles')), /SRT/);
});
test('legendas antigas preservam acentos em Windows-1252', async () => {
  const bytes = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nOl\xe1. Voc\xea est\xe1 a\xed?\n', 'latin1');
  const result = await downloadSubtitles('https://files.example/old.srt', async () => new Response(bytes));
  assert.equal(result[0].text, 'Olá. Você está aí?');
});
