import test from 'node:test';
import assert from 'node:assert/strict';
import { config, parseSubtitles, pairSubtitles, validateCues, activeCue, subtitleFrame, frameText, toSrt, subtitleEvents, reviewCard, compareTranscript } from '../shared/core.js';
import { DEMO } from '../shared/demo.js';

const cue = { id: '1', start: 0, end: 4000, en: 'Work at a hospital.', pt: 'Trabalha em um hospital.', segments: [{ en: 'Work', pt: 'Trabalha', start: 0 }, { en: 'at', pt: 'em', start: 800 }, { en: 'a', pt: 'um', start: 1600 }, { en: 'hospital.', pt: 'hospital.', start: 2400 }] };
test('progressiva produz a sequência pedida, sem inventar correspondências', () => {
  const cfg = { translationDelay: 800, showOriginal: false };
  assert.deepEqual([0, 800, 1600, 2400, 3200].map(t => frameText(subtitleFrame(cue, t, cfg))), ['Work', 'Trabalha at', 'Trabalha em a', 'Trabalha em um hospital.', 'Trabalha em um hospital.']);
});
test('atraso é independente da revelação e a frase inteira pode vir primeiro', () => {
  assert.equal(frameText(subtitleFrame(cue, 0, { reveal: 'full' })), cue.en);
  assert.equal(subtitleFrame(cue, 400, { mode: 'delayed', translationDelay: 500 }).secondary, '');
  assert.equal(subtitleFrame(cue, 500, { mode: 'delayed', translationDelay: 500 }).secondary, cue.pt);
});
test('direção reversa e palavras conhecidas', () => {
  assert.equal(frameText(subtitleFrame(cue, 0, { direction: 'pt-en' })), 'Trabalha');
  assert.equal(frameText(subtitleFrame(cue, 800, { translationDelay: 800, hideKnown: true }, { known: ['Work'] })), 'Work at');
});
test('exposição inicial mantém o inglês antes de iniciar a transformação', () => {
  assert.equal(frameText(subtitleFrame(cue, 100, { initialEnglish: 500 })), cue.en);
  assert.equal(frameText(subtitleFrame(cue, 500, { initialEnglish: 500 })), 'Work');
  const events = subtitleEvents([cue], { initialEnglish: 500, showOriginal: false });
  assert.equal(events[0].text, cue.en); assert.equal(events[0].end, 500);
});
test('todos os modos, incluindo escuta e lacunas, funcionam sem português', () => {
  for (const mode of ['progressive', 'delayed', 'bilingual', 'english', 'karaoke', 'cloze', 'listening']) assert.doesNotThrow(() => subtitleFrame({ ...cue, pt: '' }, 500, { mode }));
  assert.equal(frameText(subtitleFrame(cue, 0, { mode: 'listening' })), '');
  assert.equal(frameText(subtitleFrame(cue, 0, { mode: 'listening' }, { revealed: true })), cue.en);
  assert.match(frameText(subtitleFrame(cue, 0, { mode: 'cloze', clozeEvery: 2 })), /____/);
});
test('frases sem alinhamento permanecem inteiras', () => {
  const unaligned = { ...cue, segments: [] };
  assert.equal(frameText(subtitleFrame(unaligned, 0)), cue.en);
  assert.equal(frameText(subtitleFrame(unaligned, 1000)), cue.pt);
});
test('parser lida com SRT, VTT, BOM, tags e linhas multilinha', () => {
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld!\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nGoodbye.';
  assert.deepEqual(parseSubtitles(srt)[0], { start: 1000, end: 2500, text: 'Hello world!' });
  assert.equal(parseSubtitles('WEBVTT\n\nNOTE metadata\nignored\n\ncue-id\n00:01.000 --> 00:02.000 align:start\nHi.')[0].text, 'Hi.');
  assert.equal(parseSubtitles('not a subtitle').length, 0);
});
test('legendas combinam por tempo, aceitando divisões diferentes e offset', () => {
  const en = [{ start: 1000, end: 3000, text: 'Hello, world.' }];
  const pt = [{ start: 0, end: 1000, text: 'Olá,' }, { start: 1000, end: 2000, text: 'mundo.' }];
  assert.equal(pairSubtitles(en, pt, 1000)[0].pt, 'Olá, mundo.');
});
test('validação recusa alinhamento errado e marcações parciais', () => {
  assert.equal(validateCues([cue])[0].timing, 'provided');
  assert.throws(() => validateCues([{ ...cue, segments: [{ en: 'Work', pt: 'Tudo' }] }]), /recompõem/);
  assert.throws(() => validateCues([{ ...cue, segments: cue.segments.map((s, i) => i ? { en: s.en, pt: s.pt } : s) }]), /tempos/);
  assert.throws(() => validateCues([{ ...cue, end: -1 }]), /Tempo/);
  assert.doesNotThrow(() => validateCues(DEMO.cues));
});
test('busca respeita lacunas, tempos exatos, sobreposição e offset', () => {
  const list = [{ start: 1000, end: 4000 }, { start: 2000, end: 2500 }, { start: 6000, end: 7000 }];
  assert.equal(activeCue(list, 0), null);
  assert.equal(activeCue(list, 2200).index, 1);
  assert.equal(activeCue(list, 2600).index, 0);
  assert.equal(activeCue(list, 4000), null);
  assert.equal(activeCue(list, 1500, 500).index, 0);
});
test('SRT preserva transições e tempos, inclusive ajuste negativo', () => {
  const srt = toSrt([cue], { translationDelay: 800, showOriginal: false });
  assert.match(srt, /00:00:00,800 --> 00:00:01,600\nTrabalha at/);
  const events = subtitleEvents([cue], { subtitleOffset: -500, translationDelay: 800 });
  assert.ok(events.every(e => e.start >= 0 && e.end > e.start));
  assert.equal(parseSubtitles(toSrt([cue], { mode: 'bilingual' }))[0].text, `${cue.en} ${cue.pt}`);
});
test('configuração limita valores e cores vindos de JSON', () => {
  const c = config({ speed: 90, fontSize: -50, mode: 'x', englishColor: '"><script>', showOriginal: 'false', repeatCount: 2.7 });
  assert.equal(c.speed, 1.5); assert.equal(c.fontSize, 16); assert.equal(c.mode, 'progressive'); assert.equal(c.englishColor, '#f8f7f4'); assert.equal(c.showOriginal, true); assert.equal(c.repeatCount, 3);
});
test('revisões usam memória individual e aumentam o intervalo', () => {
  const now = 1000000, card = { front: 'a hand', interval: 0, reviews: 0 };
  const first = reviewCard(card, 'good', now), second = reviewCard(first, 'good', now);
  assert.equal(first.interval, 1); assert.ok(second.interval > first.interval);
  assert.equal(reviewCard(card, 'again', now).due, now + 600000);
  assert.equal(card.reviews, 0); assert.throws(() => reviewCard(card, 'invalid'));
});
test('comparação textual não é uma nota de pronúncia', () => { assert.equal(compareTranscript('Hello world', 'hello world!').similarity, 100); assert.equal(compareTranscript('one two', '').similarity, 0); });
