export const DEFAULT_CONFIG = Object.freeze({
  mode: 'progressive', reveal: 'rolling', direction: 'en-pt', granularity: 'word',
  translationDelay: 650, initialEnglish: 0, finalHold: 450,
  subtitleOffset: 0, translationOffset: 0, showOriginal: true,
  fontSize: 30, subtitlePosition: 12, backgroundOpacity: 78,
  englishColor: '#f8f7f4', portugueseColor: '#a9edce',
  speed: 1, repeatCount: 3, pauseAfter: false, echoGap: 2500,
  loopPadding: 180, hideKnown: false, clozeEvery: 4,
  dailyGoal: 15, volume: 1, voiceRate: 0.85,
});
export const MODES = {
  progressive: { name: 'Tradução progressiva', short: 'Progressiva', description: 'O inglês aparece e se transforma em português, unidade por unidade.' },
  delayed: { name: 'Tradução com atraso', short: 'Com atraso', description: 'Tente entender o inglês antes de receber a tradução da frase.' },
  bilingual: { name: 'Legendas duplas', short: 'Duplas', description: 'Inglês e português juntos, para conferir o significado.' },
  english: { name: 'Só inglês', short: 'Só inglês', description: 'Associe o que você escuta à forma escrita, sem tradução automática.' },
  karaoke: { name: 'Karaokê em inglês', short: 'Karaokê', description: 'Acompanhe as palavras. Tempos estimados quando não há marcação por palavra.' },
  listening: { name: 'Escuta sem legenda', short: 'Escuta', description: 'Ouça primeiro. Use Revelar para conferir depois.' },
  cloze: { name: 'Complete a fala', short: 'Lacunas', description: 'Recupere as palavras que faltam e confira a resposta.' },
};
export const PRESETS = {
  beginner: { name: 'Primeiros passos · A1–A2', mode: 'bilingual', speed: .85, translationDelay: 900, showOriginal: true, repeatCount: 3, echoGap: 4000 },
  bridge: { name: 'Construir confiança · A2–B1', mode: 'progressive', reveal: 'rolling', speed: .95, translationDelay: 650, showOriginal: true, repeatCount: 3, echoGap: 3000 },
  independent: { name: 'Mais autonomia · B1–B2', mode: 'delayed', speed: 1, translationDelay: 1800, showOriginal: false, repeatCount: 2, echoGap: 2500 },
  immersion: { name: 'Imersão · B2+', mode: 'listening', speed: 1, showOriginal: false, repeatCount: 2, echoGap: 1800 },
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function config(input = {}) {
  const out = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'boolean' && typeof input[key] === 'boolean') out[key] = input[key];
    else if (typeof out[key] === 'number' && Number.isFinite(input[key])) out[key] = input[key];
    else if (typeof out[key] === 'string' && typeof input[key] === 'string') out[key] = input[key];
  }
  if (!MODES[out.mode]) out.mode = 'progressive';
  if (!['rolling', 'full'].includes(out.reveal)) out.reveal = 'rolling';
  if (!['en-pt', 'pt-en'].includes(out.direction)) out.direction = 'en-pt';
  if (!['word', 'chunk'].includes(out.granularity)) out.granularity = 'word';
  const bounds = { translationDelay: [0, 10000], initialEnglish: [0, 5000], finalHold: [0, 3000], subtitleOffset: [-60000, 60000], translationOffset: [-60000, 60000], fontSize: [16, 64], subtitlePosition: [2, 65], backgroundOpacity: [0, 100], speed: [.5, 1.5], repeatCount: [1, 10], echoGap: [500, 15000], loopPadding: [0, 1500], clozeEvery: [2, 10], dailyGoal: [1, 120], volume: [0, 1], voiceRate: [.5, 1.5] };
  for (const [key, [a, b]] of Object.entries(bounds)) out[key] = clamp(out[key], a, b);
  for (const key of ['repeatCount', 'clozeEvery']) out[key] = Math.round(out[key]);
  for (const key of ['englishColor', 'portugueseColor']) if (!/^#[\da-f]{6}$/i.test(out[key])) out[key] = DEFAULT_CONFIG[key];
  return out;
}
export function cleanText(text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\u0000/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
export function normalize(text) {
  return cleanText(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function parseTime(value) {
  const parts = String(value).trim().replace(',', '.').split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return NaN;
  return Math.round((parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]) * 1000);
}
export function parseSubtitles(raw) {
  const blocks = String(raw).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0 || /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const [a, b] = lines[index].split('-->');
    const start = parseTime(a), end = parseTime(b.trim().split(/\s/)[0]);
    const text = cleanText(lines.slice(index + 1).join(' '));
    if (Number.isFinite(start) && end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}
export function pairSubtitles(english, portuguese, offset = 0) {
  // Match intervals, not line numbers: PT may split or combine source cues.
  let cursor = 0;
  return english.map((cue, i) => {
    while (cursor < portuguese.length && portuguese[cursor].end + offset <= cue.start) cursor++;
    const matches = [];
    for (let j = cursor; j < portuguese.length && portuguese[j].start + offset < cue.end; j++) {
      const overlap = Math.min(cue.end, portuguese[j].end + offset) - Math.max(cue.start, portuguese[j].start + offset);
      if (overlap > 0 && overlap / Math.min(cue.end - cue.start, portuguese[j].end - portuguese[j].start) >= .2) matches.push(portuguese[j].text);
    }
    return { id: `cue-${i + 1}`, start: cue.start, end: cue.end, en: cue.text, pt: [...new Set(matches)].join(' '), segments: [], timing: 'estimated', alignment: 'sentence' };
  });
}

function nearestDistance(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  return Math.min(lo < sorted.length ? Math.abs(sorted[lo] - value) : Infinity, lo ? Math.abs(sorted[lo - 1] - value) : Infinity);
}
function timingScore(reference, candidate, scale, offset) {
  const ref = reference.map(c => (c.start + c.end) / 2), other = candidate.map(c => ((c.start + c.end) / 2) * scale + offset);
  if (!ref.length || !other.length) return 0;
  const oneWay = (from, to) => from.reduce((sum, time) => {
    const distance = nearestDistance(to, time);
    return sum + (distance <= 900 ? 1 : distance <= 2200 ? .55 : distance <= 4000 ? .15 : 0);
  }, 0) / from.length;
  return (oneWay(other, ref) + oneWay(ref, other)) / 2;
}
function quantile(values, ratio) { return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)))]; }

// Corrects fixed delay and the common 23.976/25 fps drift between EN and PT.
// This aligns subtitle releases to each other; it does not claim audio alignment.
export function synchronizeTranslation(english, portuguese) {
  if (english.length < 8 || portuguese.length < 8) return { cues: portuguese, scale: 1, offset: 0, score: 0, changed: false };
  const en = english.map(c => (c.start + c.end) / 2), pt = portuguese.map(c => (c.start + c.end) / 2);
  const enSpan = quantile(en, .9) - quantile(en, .1), ptSpan = quantile(pt, .9) - quantile(pt, .1);
  const ratio = ptSpan > 10000 ? enSpan / ptSpan : 1;
  const scales = [...new Set([1, 25 / 23.976, 23.976 / 25, ratio].filter(n => n >= .94 && n <= 1.06).map(n => Math.round(n * 100000) / 100000))];
  const baseline = timingScore(english, portuguese, 1, 0);
  let best = { scale: 1, offset: 0, score: baseline };
  for (const scale of scales) {
    const offsets = new Set([0]);
    for (const q of [.05, .1, .25, .5, .75, .9, .95]) {
      const center = quantile(en, q) - quantile(pt, q) * scale;
      for (const delta of [-2000, -1000, 0, 1000, 2000]) offsets.add(Math.round((center + delta) / 250) * 250);
    }
    for (const offset of offsets) {
      if (Math.abs(offset) > 180000) continue;
      const score = timingScore(english, portuguese, scale, offset);
      if (score > best.score) best = { scale, offset, score };
    }
  }
  if (best.score < baseline + .06 || best.score < .32) return { cues: portuguese, scale: 1, offset: 0, score: baseline, changed: false };
  return {
    cues: portuguese.map(cue => ({ ...cue, start: Math.max(0, Math.round(cue.start * best.scale + best.offset)), end: Math.max(1, Math.round(cue.end * best.scale + best.offset)) })).filter(cue => cue.end > cue.start),
    ...best, changed: true,
  };
}
export function validateCues(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 15000) throw new Error('Use de 1 a 15.000 falas.');
  return input.map((cue, i) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > 86400000) throw new Error(`Tempo inválido na fala ${i + 1}.`);
    const en = cleanText(cue.en), pt = cleanText(cue.pt);
    if (!en || en.length > 2000 || pt.length > 3000) throw new Error(`Texto inválido na fala ${i + 1}.`);
    const segments = Array.isArray(cue.segments) ? cue.segments.map(s => ({ en: cleanText(s.en), pt: cleanText(s.pt), ...(Number.isFinite(s.start) ? { start: s.start } : {}) })) : [];
    if (segments.length > 150 || segments.some(s => !s.en || s.en.length > 2000 || s.pt.length > 3000)) throw new Error(`Blocos inválidos na fala ${i + 1}.`);
    if (segments.length && normalize(segments.map(s => s.en).join(' ')) !== normalize(en)) throw new Error(`Os blocos em inglês não recompõem a fala ${i + 1}.`);
    if (segments.length && normalize(segments.map(s => s.pt).join(' ')) !== normalize(pt)) throw new Error(`Os blocos em português não recompõem a tradução da fala ${i + 1}.`);
    const timed = segments.length > 0 && segments.every(s => Number.isFinite(s.start));
    if (segments.some(s => s.start !== undefined) && (!timed || segments.some((s, j) => s.start < 0 || s.start >= cue.end - cue.start || j > 0 && s.start <= segments[j - 1].start))) throw new Error(`Os tempos dos blocos devem ser crescentes, relativos à fala, e menores que sua duração (fala ${i + 1}).`);
    return { id: String(cue.id || `cue-${i + 1}`).slice(0, 100), start: cue.start, end: cue.end, en, pt, segments, timing: timed ? 'provided' : 'estimated', alignment: segments.length ? 'aligned' : 'sentence' };
  }).sort((a, b) => a.start - b.start);
}
export function activeCue(cues, time, offset = 0) {
  const t = time - offset;
  let lo = 0, hi = cues.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  // Support overlapping captions, preferring the most recent active line.
  for (let i = found; i >= 0; i--) { if (cues[i].end > t) return { cue: cues[i], index: i }; }
  return null;
}
export function unitsFor(cue, cfg) {
  const segments = cue.segments?.length ? cue.segments : [{ en: cue.en, pt: cue.pt }];
  // Phrasal verbs/expressions remain indivisible. Never invent a word alignment.
  if (cfg.granularity === 'chunk' && segments.length > 1) {
    const result = [];
    for (let i = 0; i < segments.length; i += 2) result.push({ en: segments.slice(i, i + 2).map(s => s.en).join(' '), pt: segments.slice(i, i + 2).map(s => s.pt).join(' '), start: segments[i].start });
    return result;
  }
  return segments;
}
export function unitSchedule(cue, cfg) {
  const units = unitsFor(cue, cfg);
  const duration = cue.end - cue.start;
  const lead = Math.min(cfg.initialEnglish, duration * .4);
  const available = Math.max(1, duration - lead - Math.min(cfg.finalHold, duration * .25) - Math.min(cfg.translationDelay, duration * .3));
  const total = units.reduce((sum, s) => sum + Math.max(1, s.en.length), 0);
  let accumulated = 0;
  return units.map(s => { const at = Number.isFinite(s.start) ? lead + s.start * (duration - lead) / duration : lead + available * accumulated / total; accumulated += Math.max(1, s.en.length); return { ...s, at }; });
}
export function subtitleFrame(cue, elapsed, input = {}, { revealed = false, known = [] } = {}) {
  const cfg = config(input), hasPt = Boolean(cue.pt), reverse = cfg.direction === 'pt-en';
  const original = cue.en;
  const frame = { parts: [], secondary: '', original, timing: cue.timing || 'estimated', aligned: Boolean(cue.segments?.length), mode: cfg.mode };
  if (cfg.mode === 'listening') { if (revealed) frame.parts = [{ text: cue.en, lang: 'en' }]; return frame; }
  if (cfg.mode === 'bilingual') { frame.parts = [{ text: cue.en, lang: 'en' }]; frame.secondary = cue.pt; return frame; }
  if (cfg.mode === 'english' || !hasPt && ['delayed', 'progressive'].includes(cfg.mode)) { frame.parts = [{ text: cue.en, lang: 'en' }]; return frame; }
  if (cfg.mode === 'delayed') { frame.parts = [{ text: cue.en, lang: 'en' }]; frame.secondary = revealed || elapsed >= cfg.translationDelay ? cue.pt : ''; return frame; }
  if (cfg.mode === 'cloze' || cfg.mode === 'karaoke') {
    const words = cue.en.split(/\s+/), span = (cue.end - cue.start) / words.length;
    frame.parts = words.map((word, i) => ({ text: cfg.mode === 'cloze' && !revealed && (i + 1) % cfg.clozeEvery === 0 ? '____' : word, lang: 'en', active: cfg.mode === 'karaoke' && elapsed >= i * span && elapsed < (i + 1) * span }));
    if (revealed) frame.secondary = cue.pt;
    return frame;
  }
  if (!revealed && elapsed < Math.min(cfg.initialEnglish, (cue.end - cue.start) * .4)) {
    frame.parts = [{ text: reverse ? cue.pt : cue.en, lang: reverse ? 'pt' : 'en' }];
    return frame;
  }
  const schedule = unitSchedule(cue, cfg);
  const knownSet = new Set(known.map(normalize));
  for (const s of schedule) {
    if (cfg.reveal === 'rolling' && elapsed < s.at) continue;
    const translated = revealed || elapsed >= s.at + cfg.translationDelay;
    const useTranslated = translated && !(cfg.hideKnown && knownSet.has(normalize(s.en)));
    const text = reverse ? useTranslated ? s.en : s.pt : useTranslated ? s.pt : s.en;
    if (text) frame.parts.push({ text, lang: reverse ? useTranslated ? 'en' : 'pt' : useTranslated ? 'pt' : 'en', active: elapsed >= s.at && elapsed < s.at + cfg.translationDelay });
  }
  if (cfg.showOriginal) frame.secondary = reverse ? cue.pt : cue.en;
  return frame;
}
export function frameText(frame) { return frame.parts.map(p => p.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'); }
export function formatTime(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
export function srtTime(ms) { const n = Math.max(0, Math.round(ms)); return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`; }
export function subtitleEvents(cues, input = {}, options = {}) {
  const cfg = config(input), events = [];
  for (const cue of cues) {
    const duration = cue.end - cue.start, times = new Set([0, duration]);
    if (cfg.mode === 'progressive') for (const s of unitSchedule(cue, cfg)) { times.add(clamp(Math.round(s.at), 0, duration)); times.add(clamp(Math.round(s.at + cfg.translationDelay), 0, duration)); }
    if (cfg.mode === 'delayed') times.add(clamp(cfg.translationDelay, 0, duration));
    if (cfg.mode === 'karaoke') cue.en.split(/\s+/).forEach((_, i, words) => times.add(Math.round(duration * i / words.length)));
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const frame = subtitleFrame(cue, sorted[i] + .01, cfg, options);
      let text = frameText(frame);
      if (frame.secondary) text += `\n${frame.secondary}`;
      // Plain SRT does not support reliable per-word highlighting across clients.
      const start = Math.max(0, cue.start + sorted[i] + cfg.subtitleOffset), end = cue.start + sorted[i + 1] + cfg.subtitleOffset;
      if (text.trim() && end > start) {
        const previous = events.at(-1);
        if (previous && previous.end === start && previous.text === text) previous.end = end;
        else events.push({ start, end, text });
      }
    }
  }
  return events;
}
export function toSrt(cues, cfg = {}, options = {}) { return subtitleEvents(cues, cfg, options).map((event, i) => `${i + 1}\n${srtTime(event.start)} --> ${srtTime(event.end)}\n${event.text}`).join('\n\n') + '\n'; }
export function compareTranscript(expected, actual) {
  const a = normalize(expected).split(' ').filter(Boolean), b = normalize(actual).split(' ').filter(Boolean);
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { similarity: a.length ? Math.round(Math.max(0, 1 - matrix[a.length][b.length] / a.length) * 100) : 0, missing: a.filter(word => !b.includes(word)) };
}
export function reviewCard(card, rating, now = Date.now()) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Avaliação inválida.');
  const prior = Math.max(0, Number(card.interval) || 0), ease = clamp(Number(card.ease) || 2.5, 1.3, 3.5);
  const interval = rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, prior * 1.2) : rating === 'easy' ? Math.max(4, prior * ease * 1.3) : Math.max(1, prior ? prior * ease : 1);
  return { ...card, interval: Math.round(interval * 100) / 100, ease: clamp(ease + ({ again: -.2, hard: -.15, good: 0, easy: .15 })[rating], 1.3, 3.5), reviews: (card.reviews || 0) + 1, due: now + (rating === 'again' ? 600000 : interval * 86400000), lastReview: now };
}
export function escapeHtml(text) { return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
