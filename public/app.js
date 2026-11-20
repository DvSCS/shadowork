import { DEFAULT_CONFIG, MODES, PRESETS, config, parseSubtitles, pairSubtitles, validateCues, activeCue, subtitleFrame, frameText, formatTime, toSrt, reviewCard, normalize, escapeHtml as esc } from '/shared/core.js';
import { cloudFetch, showCloudState } from '/cloud.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`scenelingo-${key}`)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(`scenelingo-${key}`, JSON.stringify(value)); } catch { toast('O armazenamento está cheio. Exporte um backup do vocabulário.'); } };
const state = { profiles: [], profile: null, baseUrl: location.origin, providers: {}, playing: false, position: 0, lastTick: 0, lastCue: -1, selected: 0, revealed: false, mediaUrl: null, practice: null, practiceTimer: null, recorder: null, recordUrl: null, editing: null, transcriptPage: 0, cards: load('cards', []), stats: load('stats', {}), reviewRevealed: false, currentReviewId: null, lastFrame: '', lastStatsStore: 0, saving: Promise.resolve() };
if (!Array.isArray(state.cards)) state.cards = [];
const sourcePanel = document.createElement('article'); sourcePanel.className = 'feature-card spaced';
sourcePanel.innerHTML = `<span class="step-tag">04 · SUAS FONTES DE LEGENDAS</span><h2>Traga as legendas do seu addon</h2><p>Você também pode reaproveitar um addon de legendas que já utiliza. Configure seu manifesto em SUBTITLE_ADDON_URL nas variáveis da Vercel, preencha o ID do vídeo acima e busque as opções em inglês e português. Escolha versões correspondentes ao seu vídeo.</p><button id="search-provider" class="button secondary">Buscar legendas para o ID acima</button><div id="provider-results" hidden><label class="field-label" for="provider-title">NOME DA NOVA SESSÃO</label><input id="provider-title" placeholder="Minha série · episódio 1"><label class="field-label" for="provider-en">LEGENDA EM INGLÊS</label><select id="provider-en"></select><label class="field-label" for="provider-pt">LEGENDA EM PORTUGUÊS</label><select id="provider-pt"></select><label class="form-row">Ajuste EN/PT (ms)<input id="provider-offset" type="number" value="0" min="-60000" max="60000" step="100"></label><button id="import-provider" class="button primary spaced">Criar sessão com estas legendas</button></div><p id="provider-search-status" class="muted small" role="status">Busca opcional. Sem provedor, importe arquivos SRT/VTT.</p>`;
$('#view-integrations').append(sourcePanel);
const alignButton = document.createElement('button'); alignButton.id = 'align-session'; alignButton.className = 'button secondary spaced'; alignButton.textContent = 'Alinhar traduções existentes · Ollama'; $('#translate-session').after(alignButton);
let toastTimer, saveTimer;
const revisions = new Map();
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4800); }
async function api(url, { method = 'GET', data } = {}) {
  const id = url.match(/^\/api\/profiles\/([^/?]+)$/)?.[1];
  if (method === 'PUT' && id && data) data = { ...data, revision: revisions.get(id) ?? data.revision };
  const body = data ? JSON.stringify(data) : undefined;
  if (body && new TextEncoder().encode(body).length > 3500000) throw new Error('A sessão excede 3,5 MB. Divida a legenda em trechos menores antes de importar.');
  const response = await cloudFetch(url, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body });
  let value;
  try { value = await response.json(); } catch { throw new Error(response.status === 413 ? 'A sessão excedeu o limite de tamanho da hospedagem. Divida a legenda em trechos menores.' : 'O servidor retornou uma resposta inesperada. Tente novamente.'); }
  if (!response.ok) throw new Error(value.error || 'Não foi possível concluir.');
  if (value.id && Number.isInteger(value.revision)) revisions.set(value.id, value.revision);
  return value;
}
function download(filename, content, mime = 'application/json') { const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
const slug = text => normalize(text).replace(/\s+/g, '-').slice(0, 65) || 'sessao';
function persistProfile() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.profile) return Promise.resolve();
  if (state.readOnly || state.profile.demo) { $('#save-status').textContent = 'Demonstração · ajustes temporários'; return Promise.resolve(state.profile); }
  const snapshot = structuredClone(state.profile);
  $('#save-status').textContent = 'Salvando…';
  const result = state.saving.catch(() => {}).then(() => api(`/api/profiles/${snapshot.id}`, { method: 'PUT', data: snapshot }));
  state.saving = result;
  result.then(() => { if (state.profile?.id === snapshot.id) $('#save-status').textContent = 'Configurações salvas'; }).catch(error => { $('#save-status').textContent = 'Não salvo — tente novamente'; toast(error.message); });
  return result;
}
function scheduleSave() { $('#save-status').textContent = 'Alterações pendentes…'; clearTimeout(saveTimer); saveTimer = setTimeout(persistProfile, 500); }
function cfg() { return state.profile?.config || config(); }
function selectedCue() { return state.profile?.cues[state.selected] || state.profile?.cues[0]; }
function knownWords() { return state.cards.filter(c => c.known).map(c => c.front); }
function setConfig(patch) {
  state.profile.config = config({ ...cfg(), ...patch });
  if (state.practice) stopPractice();
  applySettings(); scheduleSave(); state.lastFrame = ''; renderFrame();
}
function applySettings() {
  const c = cfg();
  for (const input of $$('[data-setting]')) { const value = c[input.dataset.setting]; if (input.type === 'checkbox') input.checked = value; else input.value = value; }
  const units = { translationDelay: 'ms', initialEnglish: 'ms', finalHold: 'ms', echoGap: 'ms', loopPadding: 'ms', fontSize: 'px', subtitlePosition: '%', backgroundOpacity: '%' };
  for (const out of $$('[data-output]')) { const k = out.dataset.output; out.textContent = k === 'volume' ? `${Math.round(c[k] * 100)}%` : k === 'voiceRate' ? `${c[k].toFixed(2)}×` : `${c[k]}${units[k] ? ` ${units[k]}` : ''}`; }
  if (![...$('#speed-quick').options].some(o => +o.value === c.speed)) { const option = document.createElement('option'); option.value = c.speed; option.textContent = `${c.speed}×`; $('#speed-quick').append(option); }
  $('#speed-quick').value = c.speed;
  $('#video').playbackRate = c.speed; $('#video').volume = c.volume;
  for (const button of $$('.mode-button')) { button.classList.toggle('selected', button.dataset.mode === c.mode); button.setAttribute('aria-pressed', String(button.dataset.mode === c.mode)); }
  $('#mode-description').textContent = MODES[c.mode].description;
  const area = $('#subtitle-area'); area.style.fontSize = `${c.fontSize}px`; area.style.bottom = `${c.subtitlePosition}%`; area.style.setProperty('--sub-bg', `rgba(6,12,9,${c.backgroundOpacity / 100})`); area.style.setProperty('--english-color', c.englishColor); area.style.setProperty('--portuguese-color', c.portugueseColor);
  renderGoal();
}
function renderSessions() { $('#session-select').innerHTML = state.profiles.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join(''); if (state.profile) $('#session-select').value = state.profile.id; }
async function selectProfile(id) {
  pause(); stopPractice();
  const target = state.profiles.find(p => p.id === id) || state.profiles[0];
  if (target && !target.cues) Object.assign(target, await api(`/api/profiles/${target.id}`));
  state.profile = target;
  if (!state.profile) return;
  state.profile.config = config(state.profile.config); state.position = 0; state.lastCue = -1; state.selected = 0; state.revealed = false; state.lastFrame = ''; state.transcriptPage = 0;
  if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
  state.mediaUrl = null; $('#video').removeAttribute('src'); $('#video').load(); $('#video').hidden = true; $('#demo-scene').hidden = false;
  $('#scene-kind').textContent = state.profile.demo ? 'CENA AUTORAL · DEMONSTRAÇÃO' : 'SESSÃO IMPORTADA · CARREGUE SEU VÍDEO';
  $('.scene-title>strong').innerHTML = state.profile.demo ? 'A little<br><i>everyday English.</i>' : `${esc(state.profile.title)}<br><i>Seu próximo passo.</i>`;
  $('.scene-title>small').textContent = state.profile.demo ? 'Conversa original · voz sintetizada no navegador' : 'Use “Seu vídeo” para reproduzir o arquivo local';
  $('.scene-title>span').textContent = state.profile.demo ? 'THE EVERYDAY SESSIONS' : 'A SUA PRÓXIMA CENA';
  $('#timeline').max = duration(); $('#session-select').value = state.profile.id; $('#preset').value = ''; $('#transcript-search').value = '';
  store('last-profile', state.profile.id); applySettings(); renderTranscript(); renderIntegrations(); renderFrame(); renderTransport();
  $('#save-status').textContent = state.profile.demo ? 'Demonstração · ajustes temporários' : 'Configurações salvas';
  $('#alignment-note').textContent = state.profile.cues.some(c => c.segments.length) ? '✦ Expressões são preservadas em blocos. Tempos estimados, salvo marcações fornecidas.' : '✦ Sem alinhamento: tradução da frase inteira. Use o editor ou Ollama para os blocos por palavra.';
}
function duration() { return state.mediaUrl && Number.isFinite($('#video').duration) ? $('#video').duration * 1000 : (state.profile?.cues.at(-1)?.end || 57000) + 800; }
function speak(cue) {
  if (state.mediaUrl || !state.profile?.demo || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(cue.en); utterance.lang = 'en-US';
  const voices = speechSynthesis.getVoices(); utterance.voice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  utterance.rate = cfg().voiceRate * cfg().speed; utterance.volume = cfg().volume; speechSynthesis.speak(utterance);
}
async function play() {
  if (!state.profile) return;
  if (state.position >= duration() - 50) seek(0);
  if (state.mediaUrl) { try { await $('#video').play(); } catch { toast('Não foi possível reproduzir. Verifique o formato do vídeo.'); return; } }
  state.playing = true; state.lastTick = performance.now();
  const active = activeCue(state.profile.cues, state.position, cfg().subtitleOffset);
  if (active && !state.mediaUrl && state.lastCue === active.index) speak(active.cue);
  renderTransport();
}
function pause() { state.playing = false; $('#video').pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); renderTransport(); }
function seek(ms, { preservePractice = false } = {}) {
  if (!preservePractice) stopPractice();
  state.position = Math.max(0, Math.min(duration(), ms));
  if (state.mediaUrl && Number.isFinite($('#video').duration)) $('#video').currentTime = state.position / 1000;
  state.lastCue = -1; state.lastFrame = ''; state.revealed = false;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  renderFrame(); renderTransport();
}
function jump(index) { index = Math.max(0, Math.min(state.profile.cues.length - 1, index)); state.selected = index; state.transcriptPage = Math.floor(index / 60); seek(state.profile.cues[index].start + cfg().subtitleOffset); renderTranscript(); }
function renderTransport() { if (!state.profile) return; $('#play').textContent = state.playing ? 'Ⅱ' : '▶'; $('#play').setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproduzir'); $('#timeline').value = state.position; $('#time-label').textContent = `${formatTime(state.position)} / ${formatTime(duration())}`; }
function effectiveConfig() { return state.practice?.method === 'ladder' ? { ...cfg(), mode: ['bilingual', 'english', 'listening'][Math.min(2, state.practice.round)] } : cfg(); }
function renderFrame() {
  if (!state.profile) return;
  const active = activeCue(state.profile.cues, state.position, cfg().subtitleOffset);
  if (!active) { if (state.lastFrame !== 'empty') { $('#subtitle-main').replaceChildren(); $('#subtitle-secondary').textContent = ''; state.lastFrame = 'empty'; } return; }
  const { cue, index } = active;
  if (state.lastCue !== index) {
    state.lastCue = index; state.selected = index; state.revealed = false;
    $('#scene-index').textContent = `${String(index + 1).padStart(2, '0')} / ${String(state.profile.cues.length).padStart(2, '0')}`;
    for (const row of $$('.transcript-row')) row.classList.toggle('current', +row.dataset.index === index);
    if (state.playing) speak(cue);
  }
  const frame = subtitleFrame(cue, state.position - cue.start - cfg().subtitleOffset, effectiveConfig(), { revealed: state.revealed, known: knownWords() });
  const key = JSON.stringify(frame);
  if (key === state.lastFrame) return;
  state.lastFrame = key;
  $('#subtitle-main').innerHTML = frame.parts.map(part => `<span data-text="${esc(part.text)}" class="lang-${part.lang} ${part.active ? 'active' : ''}">${esc(part.text)}</span>`).join(' ');
  $('#subtitle-secondary').textContent = frame.secondary;
}
function tick(timestamp) {
  const delta = Math.min(200, timestamp - (state.lastTick || timestamp)); state.lastTick = timestamp;
  if (state.playing && state.profile) {
    const previousPosition = state.position;
    state.position = state.mediaUrl ? $('#video').currentTime * 1000 : state.position + delta * cfg().speed;
    // Count actual foreground playback time, not pauses, buffering or a hidden tab.
    if (!document.hidden && (!state.mediaUrl || !$('#video').seeking && $('#video').readyState >= 3)) {
      const day = new Date().toLocaleDateString('en-CA'), add = Math.min(delta, Math.max(0, (state.position - previousPosition) / cfg().speed));
      state.stats[day] = (state.stats[day] || 0) + add;
      if (timestamp - state.lastStatsStore > 5000) { state.lastStatsStore = timestamp; store('stats', state.stats); renderGoal(); }
    }
    const c = cfg(), practice = state.practice;
    if (practice) {
      const end = practice.cue.end + c.subtitleOffset + c.loopPadding;
      if (state.position >= end && !practice.waiting) {
        practice.waiting = true; pause();
        const isEcho = practice.method === 'echo';
        if (isEcho) { $('#phase-badge').hidden = false; $('#phase-badge').textContent = 'Sua vez · repita a fala'; state.position = practice.cue.end - 1 + c.subtitleOffset; state.revealed = true; state.lastFrame = ''; renderFrame(); }
        const nextRound = () => {
          if (state.practice !== practice) return;
          practice.round++;
          if (practice.round >= practice.total) { stopPractice(); $('#practice-feedback').textContent = 'Prática concluída. Tente dizer a fala mais uma vez sem olhar.'; return; }
          practice.waiting = false; seek(Math.max(0, practice.cue.start + c.subtitleOffset - c.loopPadding), { preservePractice: true }); updatePracticeLabel(); play();
        };
        state.practiceTimer = setTimeout(nextRound, isEcho ? c.echoGap : 450);
      }
    } else if (c.pauseAfter) {
      const completed = state.profile.cues.find(cue => previousPosition < cue.end + c.subtitleOffset && state.position >= cue.end + c.subtitleOffset);
      if (completed) { state.position = completed.end + c.subtitleOffset + 1; pause(); }
    }
    if (state.position >= duration()) { state.position = duration(); pause(); stopPractice(); }
    renderFrame(); renderTransport();
  }
  requestAnimationFrame(tick);
}
function renderGoal() { const day = new Date().toLocaleDateString('en-CA'), minutes = (state.stats[day] || 0) / 60000; $('#daily-progress').max = cfg().dailyGoal; $('#daily-progress').value = minutes; $('#goal-label').textContent = `${cfg().dailyGoal} min`; $('#daily-label').textContent = `${Math.floor(minutes)} de ${cfg().dailyGoal} minutos hoje`; }
function updatePracticeLabel() { if (!state.practice) return; const p = state.practice; $('#phase-badge').hidden = false; $('#phase-badge').textContent = `${p.method === 'echo' ? 'Escute' : p.method === 'ladder' ? ['Com tradução', 'Só inglês', 'Sem legenda'][Math.min(2, p.round)] : 'Repita junto'} · ${p.round + 1}/${p.total}`; $('#shadow').textContent = '■ Encerrar prática'; }
function stopPractice() { clearTimeout(state.practiceTimer); state.practice = null; $('#phase-badge').hidden = true; $('#shadow').textContent = '◉ Shadowing'; }
function startPractice(method) {
  if (state.practice) { pause(); stopPractice(); return; }
  const cue = selectedCue(); if (!cue) return;
  state.practice = { method, cue, round: 0, total: method === 'ladder' ? 3 : cfg().repeatCount, waiting: false };
  seek(Math.max(0, cue.start + cfg().subtitleOffset - cfg().loopPadding), { preservePractice: true }); updatePracticeLabel();
  $('#practice-feedback').textContent = method === 'echo' ? 'Escute o modelo. Quando o áudio pausar, repita usando o intervalo para sua resposta.' : method === 'ladder' ? 'Três passagens: com tradução, só inglês e sem legenda. Tente precisar de menos apoio a cada vez.' : 'Repita com um pequeno atraso em relação ao áudio. Imite o ritmo e a entonação da fala.';
  if (!state.profile.demo && !state.mediaUrl) toast('Carregue seu vídeo para praticar com o áudio original.');
  play();
}
function renderTranscript() {
  if (!state.profile) return;
  const query = normalize($('#transcript-search').value);
  const entries = state.profile.cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => !query || normalize(`${cue.en} ${cue.pt}`).includes(query));
  const totalPages = Math.max(1, Math.ceil(entries.length / 60)); state.transcriptPage = Math.min(state.transcriptPage, totalPages - 1);
  $('#transcript-summary').textContent = `${entries.length} falas`;
  $('#transcript').innerHTML = entries.slice(state.transcriptPage * 60, (state.transcriptPage + 1) * 60).map(({ cue, index }) => `<div class="transcript-row ${index === state.selected ? 'current' : ''}" data-index="${index}"><button class="cue-time" data-jump="${index}" title="Ir para esta fala">${formatTime(cue.start)}</button><div class="cue-content" data-jump="${index}" tabindex="0" role="button"><div class="cue-en">${esc(cue.en)}</div><div class="cue-pt">${esc(cue.pt || 'Sem português · importe, traduza ou edite')}</div><div class="cue-badge">${cue.segments.length ? `${cue.segments.length} blocos · ${cue.timing === 'provided' ? 'tempos fornecidos' : 'tempos estimados'}` : 'Frase inteira · sem alinhamento por palavra'}</div></div><div class="cue-actions"><button class="icon-button" data-save="${index}" title="Salvar no vocabulário" aria-label="Salvar fala ${index + 1}">＋</button><button class="icon-button" data-edit="${index}" title="Editar tradução e blocos" aria-label="Editar fala ${index + 1}">✎</button></div></div>`).join('') || '<div class="empty">Nenhuma fala encontrada.</div>';
  $('#transcript-page').textContent = `${state.transcriptPage + 1} / ${totalPages}`; $('#transcript-prev').disabled = state.transcriptPage === 0; $('#transcript-next').disabled = state.transcriptPage >= totalPages - 1;
}
function openCard(cue, phrase = '') { pause(); $('#card-front').value = phrase || cue.en; $('#card-back').value = phrase ? (cue.segments.find(s => normalize(s.en) === normalize(phrase))?.pt || '') : cue.pt; $('#card-context').value = `${cue.en}\n${state.profile.title} · ${formatTime(cue.start)}`; $('#card-dialog').showModal(); }
function openEditor(index) { pause(); state.editing = index; const cue = state.profile.cues[index]; $('#edit-en').value = cue.en; $('#edit-pt').value = cue.pt; $('#edit-segments').value = JSON.stringify(cue.segments, null, 2); $('#edit-error').textContent = ''; $('#edit-dialog').showModal(); }
function saveCards() { store('cards', state.cards); renderVocabulary(); }
function renderVocabulary() {
  $('#vocab-count').textContent = state.cards.length;
  const due = state.cards.filter(c => c.due <= Date.now() && !c.known).sort((a, b) => a.due - b.due);
  $('#card-total').textContent = state.cards.length; $('#card-due').textContent = due.length; $('#card-reviews').textContent = state.cards.reduce((n, c) => n + (c.reviews || 0), 0);
  let review = due.find(c => c.id === state.currentReviewId) || due[0];
  if (review?.id !== state.currentReviewId) { state.currentReviewId = review?.id || null; state.reviewRevealed = false; }
  $('#review-card').innerHTML = review ? `<span class="eyebrow">RECUPERE ANTES DE REVELAR · ${due.length} PARA REVER</span><h2>${esc(review.front)}</h2><div class="review-context">${esc(review.context || '')}</div>${state.reviewRevealed ? `<div class="review-answer">${esc(review.back)}</div><div class="toolbar"><button class="button secondary" data-rating="again">Novamente · 10 min</button><button class="button secondary" data-rating="hard">Difícil</button><button class="button primary" data-rating="good">Lembrei</button><button class="button secondary" data-rating="easy">Fácil</button></div>` : '<button class="button primary spaced" id="review-reveal">Revelar significado</button>'}` : '<span class="eyebrow">UM PASSO DE CADA VEZ</span><h2>Nenhuma revisão pendente.</h2><p>Salve uma expressão no roteiro ou volte quando chegar a próxima revisão.</p>';
  const query = normalize($('#card-search').value);
  $('#card-list').innerHTML = state.cards.filter(c => normalize(`${c.front} ${c.back}`).includes(query)).map(c => `<article class="vocab-card"><h3>${esc(c.front)}</h3><p>${esc(c.back)}</p><small>${esc(c.context || '')}</small><small>${c.known ? 'Conhecida · fora da fila de revisão' : `Próxima revisão: ${new Date(c.due).toLocaleString('pt-BR')}`}</small><div class="toolbar"><button class="button ghost compact" data-known="${esc(c.id)}">${c.known ? 'Voltar a estudar' : 'Já conheço'}</button><button class="button ghost compact" data-delete-card="${esc(c.id)}">Remover</button></div></article>`).join('') || '<div class="empty">Sua coleção começa com uma fala que vale lembrar.</div>';
}
function renderIntegrations() {
  if (!state.profile) return;
  const url = `${state.baseUrl}/a/${state.profile.id}/manifest.json`;
  $('#manifest-url').value = url; $('#install-stremio').href = url.replace(/^https?:\/\//, 'stremio://'); $('#video-id').value = state.profile.videoId; $('#content-type').value = state.profile.type;
  $('#provider-status').innerHTML = `<span class="pill">${state.providers.ollama ? '●' : '○'} Ollama ${state.providers.ollama ? 'configurado' : 'não configurado'}</span><span class="pill">${state.providers.libretranslate ? '●' : '○'} LibreTranslate ${state.providers.libretranslate ? 'configurado' : 'não configurado'}</span>`;
}
function navigate() {
  const page = location.hash.slice(1) || 'studio', allowed = ['studio', 'vocabulary', 'integrations', 'methods'];
  const view = allowed.includes(page) ? page : 'studio';
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const anchor of $$('[data-nav]')) anchor.classList.toggle('active', anchor.dataset.nav === view);
  $('#page-eyebrow').textContent = { studio: 'SEU LABORATÓRIO DE IDIOMAS', vocabulary: 'SUA COLEÇÃO EM MOVIMENTO', integrations: 'CONECTE A SUA EXPERIÊNCIA', methods: 'A CIÊNCIA POR TRÁS DA PRÁTICA' }[view];
  if (view === 'vocabulary') renderVocabulary();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
async function toggleRecording() {
  if (state.recorder?.state === 'recording') { state.recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Este navegador não oferece gravação. Abra no Chrome/Edge em localhost ou HTTPS.'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream), chunks = []; state.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      clearTimeout(state.recordTimeout); stream.getTracks().forEach(t => t.stop()); $('#record').classList.remove('recording'); $('#record').textContent = '♩ Gravar voz';
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (state.recordUrl) URL.revokeObjectURL(state.recordUrl); state.recordBlob = blob; state.recordUrl = URL.createObjectURL(blob); $('#recording-audio').src = state.recordUrl; $('#recording-result').hidden = false;
      $('#practice-feedback').textContent = 'Ouça sua gravação e depois repita o modelo. Compare ritmo, clareza e entonação. A gravação fica somente nesta aba.';
    };
    recorder.start(); $('#record').textContent = '■ Parar gravação'; $('#record').classList.add('recording');
    state.recordTimeout = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 90000);
    $('#practice-feedback').textContent = 'Gravando sua voz. Use fones para reduzir o áudio do vídeo na gravação. Clique em Parar quando terminar.';
  } catch { stream?.getTracks().forEach(track => track.stop()); toast('O microfone não foi liberado. Verifique a permissão no navegador.'); }
}

$('#mode-grid').innerHTML = Object.entries(MODES).map(([mode, item], i) => `<button class="mode-button" data-mode="${mode}" aria-pressed="false"><span>${['◈', '◷', '▱', 'Aa', '♫', '◉', '⌁'][i]}</span>${item.short}</button>`).join('');
$('#mode-grid').addEventListener('click', event => { const button = event.target.closest('[data-mode]'); if (button) setConfig({ mode: button.dataset.mode }); });
for (const input of $$('[data-setting]')) input.addEventListener(input.type === 'range' ? 'input' : 'change', () => { const value = input.type === 'checkbox' ? input.checked : input.type === 'color' || input.tagName === 'SELECT' ? input.value : Number(input.value); $('#preset').value = ''; setConfig({ [input.dataset.setting]: value }); });
$('#preset').addEventListener('change', () => { const preset = PRESETS[$('#preset').value]; if (preset) setConfig(preset); });
$('#speed-quick').addEventListener('change', () => setConfig({ speed: Number($('#speed-quick').value) }));
$('#play').addEventListener('click', () => { if (state.playing) { pause(); if (state.practice) stopPractice(); } else play(); });
$('#previous').addEventListener('click', () => jump(state.selected - 1)); $('#next').addEventListener('click', () => jump(state.selected + 1));
$('#timeline').addEventListener('input', () => seek(Number($('#timeline').value)));
$('#reveal').addEventListener('click', () => { state.revealed = !state.revealed; state.lastFrame = ''; renderFrame(); });
$('#repeat').addEventListener('click', () => { const cue = selectedCue(); if (!cue) return; seek(cue.start + cfg().subtitleOffset); play(); });
$('#shadow').addEventListener('click', () => startPractice($('#practice-method').value));
$('#record').addEventListener('click', toggleRecording);
$('#download-recording').addEventListener('click', () => { if (state.recordBlob) download(`minha-voz-${Date.now()}.${state.recordBlob.type.includes('mp4') ? 'm4a' : 'webm'}`, state.recordBlob); });
$('#fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#stage').requestFullscreen(); } catch { toast('Tela cheia indisponível neste navegador.'); } });
$('#media-open').addEventListener('click', () => $('#video-file').click());
$('#video-file').addEventListener('change', () => {
  const file = $('#video-file').files[0]; if (!file) return;
  pause(); stopPractice(); if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = URL.createObjectURL(file); $('#video').src = state.mediaUrl; $('#video').hidden = false; $('#demo-scene').hidden = true; state.position = 0; state.lastCue = -1; $('#scene-kind').textContent = `VÍDEO LOCAL · ${file.name}`; toast('Vídeo aberto somente no navegador. Nenhum upload foi feito.');
});
$('#video').addEventListener('loadedmetadata', () => { $('#timeline').max = duration(); $('#video').playbackRate = cfg().speed; renderTransport(); });
$('#video').addEventListener('error', () => { pause(); toast('O navegador não conseguiu abrir o vídeo. Tente MP4 (H.264/AAC) ou WebM compatível.'); });
$('#video').addEventListener('ended', () => { pause(); stopPractice(); });
$('#video').addEventListener('pause', () => { if (state.mediaUrl) { state.playing = false; renderTransport(); } });
$('#video').addEventListener('play', () => { if (state.mediaUrl) { state.playing = true; renderTransport(); } });
$('#session-select').addEventListener('change', async () => { const id = $('#session-select').value; $('#session-select').disabled = true; try { if (saveTimer) await persistProfile(); else await state.saving; await selectProfile(id); } catch (error) { $('#session-select').value = state.profile.id; toast(error.message); } finally { $('#session-select').disabled = false; } });
$('#reset-settings').addEventListener('click', () => { setConfig(DEFAULT_CONFIG); $('#preset').value = ''; toast('Configurações restauradas para esta sessão.'); });
$('#export-srt').addEventListener('click', () => { download(`${slug(state.profile.title)}-${cfg().mode}.srt`, toSrt(state.profile.cues, cfg(), { known: knownWords() }), 'application/x-subrip'); if (cfg().mode === 'listening') toast('O modo Escuta exporta uma legenda vazia, pois não mostra texto.'); });
$('#export-session').addEventListener('click', () => download(`${slug(state.profile.title)}.scenelingo.json`, JSON.stringify({ format: 'scenelingo-session', version: 1, ...state.profile, known: knownWords() }, null, 2)));
$('#copy-manifest').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#manifest-url').value); toast('Manifesto copiado. Cole no gerenciador de addons.'); } catch { $('#manifest-url').select(); toast('Selecione e copie o endereço do manifesto.'); } });
$('#save-id').addEventListener('click', async () => { if (state.profile.demo) { toast('Importe uma sessão própria para vinculá-la a um filme ou episódio. A demonstração usa um manifesto fixo.'); return; } const previous = { type: state.profile.type, videoId: state.profile.videoId }; state.profile.type = $('#content-type').value; state.profile.videoId = $('#video-id').value.trim(); try { await persistProfile(); toast('ID salvo. Agora selecione este título no player.'); } catch { Object.assign(state.profile, previous); } });
$('#import-open').addEventListener('click', () => { $('#import-error').textContent = ''; $('#import-dialog').showModal(); });
for (const button of $$('[data-close]')) button.addEventListener('click', () => $(`#${button.dataset.close}`).close());
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#import-submit').disabled = true; $('#import-error').textContent = '';
  try {
    const sessionFile = $('#session-file').files[0]; let input;
    if (sessionFile) {
      if (sessionFile.size > 12 * 1024 * 1024) throw new Error('Limite de 12 MB por arquivo.');
      input = JSON.parse(await sessionFile.text()); input.cues = validateCues(input.cues); input.config = config(input.config); if (!input.title) input.title = sessionFile.name;
    } else {
      const english = $('#english-file').files[0], portuguese = $('#portuguese-file').files[0];
      if (!english) throw new Error('Escolha uma legenda em inglês ou uma sessão JSON.');
      if (english.size > 8 * 1024 * 1024 || portuguese?.size > 8 * 1024 * 1024) throw new Error('Limite de 8 MB por legenda.');
      const en = parseSubtitles(await english.text()), pt = portuguese ? parseSubtitles(await portuguese.text()) : [];
      if (!en.length) throw new Error('Não encontramos falas na legenda em inglês. Use SRT ou WebVTT UTF-8.');
      if (portuguese && !pt.length) throw new Error('Não encontramos falas na legenda em português.');
      input = { title: $('#session-title').value.trim() || english.name.replace(/\.(srt|vtt)$/i, ''), type: 'movie', videoId: `local-${Date.now()}`, config: config(), cues: pairSubtitles(en, pt, Number($('#pair-offset').value) || 0) };
    }
    if ($('#session-title').value.trim()) input.title = $('#session-title').value.trim();
    if (saveTimer) await persistProfile();
    const profile = await api('/api/profiles', { method: 'POST', data: input }); state.profiles.push(profile); renderSessions(); selectProfile(profile.id); $('#import-dialog').close(); $('#import-form').reset(); location.hash = 'studio';
    const untranslated = profile.cues.filter(c => !c.pt).length; toast(`Sessão criada: ${profile.cues.length} falas${untranslated ? ` · ${untranslated} sem português` : ''}.`);
  } catch (error) { $('#import-error').textContent = error.message; }
  finally { $('#import-submit').disabled = false; }
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#edit-error').textContent = '';
  try {
    const old = state.profile.cues[state.editing], segments = JSON.parse($('#edit-segments').value || '[]');
    const [cue] = validateCues([{ ...old, en: $('#edit-en').value, pt: $('#edit-pt').value, segments }]);
    state.profile.cues[state.editing] = cue; await persistProfile(); $('#edit-dialog').close(); state.lastFrame = ''; renderTranscript(); renderFrame(); toast('Fala e blocos atualizados.');
  } catch (error) { $('#edit-error').textContent = error.message; }
});
$('#transcript').addEventListener('click', event => {
  const jumpTarget = event.target.closest('[data-jump]'), save = event.target.closest('[data-save]'), edit = event.target.closest('[data-edit]');
  if (jumpTarget) jump(+jumpTarget.dataset.jump); else if (save) openCard(state.profile.cues[+save.dataset.save]); else if (edit) openEditor(+edit.dataset.edit);
});
$('#transcript').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.dataset.jump) jump(+event.target.dataset.jump); });
$('#transcript-search').addEventListener('input', () => { state.transcriptPage = 0; renderTranscript(); });
$('#transcript-prev').addEventListener('click', () => { state.transcriptPage--; renderTranscript(); }); $('#transcript-next').addEventListener('click', () => { state.transcriptPage++; renderTranscript(); });
$('#subtitle-main').addEventListener('click', event => { const part = event.target.closest('[data-text]'); if (part) { const cue = selectedCue(); const segment = cue.segments.find(s => normalize(s.en) === normalize(part.dataset.text) || normalize(s.pt) === normalize(part.dataset.text)); openCard(cue, segment?.en || ''); } });
$('#save-cue').addEventListener('click', () => { if (selectedCue()) openCard(selectedCue()); });
$('#card-form').addEventListener('submit', event => {
  event.preventDefault(); const front = $('#card-front').value.trim(), back = $('#card-back').value.trim(); if (!front || !back) return;
  if (state.cards.some(c => normalize(c.front) === normalize(front))) { toast('Esta expressão já está na sua coleção.'); return; }
  state.cards.push({ id: crypto.randomUUID(), front, back, context: $('#card-context').value.slice(0, 3000), due: Date.now(), interval: 0, ease: 2.5, reviews: 0, known: false, createdAt: Date.now() }); saveCards(); $('#card-dialog').close(); toast('Expressão salva. Uma nova oportunidade de lembrar.');
});
$('#card-search').addEventListener('input', renderVocabulary);
$('#review-card').addEventListener('click', event => {
  if (event.target.id === 'review-reveal') { state.reviewRevealed = true; renderVocabulary(); }
  const button = event.target.closest('[data-rating]');
  if (button && state.reviewRevealed) { const index = state.cards.findIndex(c => c.id === state.currentReviewId); if (index >= 0) { state.cards[index] = reviewCard(state.cards[index], button.dataset.rating); state.currentReviewId = null; state.reviewRevealed = false; saveCards(); } }
});
$('#card-list').addEventListener('click', event => {
  const known = event.target.closest('[data-known]'), remove = event.target.closest('[data-delete-card]');
  if (known) { const card = state.cards.find(c => c.id === known.dataset.known); card.known = !card.known; saveCards(); }
  if (remove) { const index = state.cards.findIndex(c => c.id === remove.dataset.deleteCard); if (index < 0) return; const [card] = state.cards.splice(index, 1); saveCards(); toast(`“${card.front}” removida da coleção.`); }
});
$('#export-cards').addEventListener('click', () => {
  const cell = text => String(text || '').replace(/[\t\r\n]+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  download('scenelingo-anki.tsv', '#separator:tab\n#html:false\n' + state.cards.map(c => [c.front, c.back, c.context].map(cell).join('\t')).join('\n'), 'text/tab-separated-values;charset=utf-8');
});
$('#backup-export').addEventListener('click', () => download(`scenelingo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'scenelingo-backup', version: 1, cards: state.cards, stats: state.stats }, null, 2)));
$('#backup-import').addEventListener('change', async () => {
  try {
    const file = $('#backup-import').files[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) throw new Error('Backup maior que 10 MB.');
    const data = JSON.parse(await file.text()); if (data.format !== 'scenelingo-backup' || !Array.isArray(data.cards) || data.cards.length > 10000) throw new Error('Backup inválido.');
    for (const c of data.cards) { if (typeof c.front !== 'string' || typeof c.back !== 'string' || typeof c.id !== 'string' || c.front.length > 2000 || c.back.length > 3000 || !Number.isFinite(c.due)) throw new Error('Cartão inválido no backup.'); }
    const merged = new Map(state.cards.map(c => [normalize(c.front), c]));
    for (const c of data.cards) if (!merged.has(normalize(c.front))) merged.set(normalize(c.front), { ...c, context: String(c.context || '').slice(0, 3000), reviews: Math.max(0, Number(c.reviews) || 0) });
    state.cards = [...merged.values()];
    if (data.stats && typeof data.stats === 'object') for (const [day, ms] of Object.entries(data.stats)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && ms >= 0) state.stats[day] = Math.max(state.stats[day] || 0, ms);
    store('stats', state.stats); saveCards(); renderGoal(); toast('Backup combinado com sua coleção. Cartões existentes foram preservados.');
  } catch (error) { toast(error.message); }
});
async function runTranslation(alignOnly = false) {
  const provider = state.providers.ollama ? 'ollama' : !alignOnly && state.providers.libretranslate ? 'libretranslate' : null;
  if (!provider) { toast(alignOnly ? 'Configure OLLAMA_MODEL nas variáveis da Vercel para alinhar traduções existentes.' : 'Configure OLLAMA_MODEL ou LIBRETRANSLATE_URL nas variáveis da Vercel e faça um novo deploy.'); return; }
  const target = state.profile, pending = target.cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => alignOnly ? Boolean(cue.pt) && !cue.segments.length : !cue.pt);
  if (!pending.length) { toast(alignOnly ? 'Nenhuma tradução sem alinhamento. Use o editor para ajustar blocos existentes.' : 'Todas as falas já têm português. Use Alinhar traduções existentes para criar os blocos.'); return; }
  const button = $(alignOnly ? '#align-session' : '#translate-session'); $('#translate-session').disabled = true; $('#align-session').disabled = true; let completed = 0;
  try {
    // Apply and persist each batch, so an interrupted long job keeps its progress.
    for (let i = 0; i < pending.length; i += 6) {
      if (state.profile !== target) throw new Error('Sessão alterada. A tradução parou; os lotes concluídos foram salvos.');
      button.textContent = `Traduzindo ${completed}/${pending.length}…`;
      const batch = pending.slice(i, i + 6), result = await api('/api/translate', { method: 'POST', data: { provider, cues: batch.map(({ cue }) => cue) } });
      result.cues.forEach((cue, j) => { target.cues[batch[j].index] = cue; }); completed += batch.length;
      if (state.profile === target) { await persistProfile(); renderTranscript(); }
      else { await api(`/api/profiles/${target.id}`, { method: 'PUT', data: target }); throw new Error('Sessão alterada. A tradução parou; os lotes concluídos foram salvos.'); }
    }
    toast(`${completed} falas traduzidas. Revise o sentido e os alinhamentos antes de estudar.`);
  } catch (error) { toast(`${error.message} ${completed} falas concluídas.`); }
  finally { $('#translate-session').disabled = false; $('#align-session').disabled = false; button.textContent = alignOnly ? 'Alinhar traduções existentes · Ollama' : 'Traduzir e alinhar falas sem português'; state.lastFrame = ''; renderFrame(); }
}
$('#translate-session').addEventListener('click', () => runTranslation());
$('#align-session').addEventListener('click', () => runTranslation(true));
$('#search-provider').addEventListener('click', async () => {
  const button = $('#search-provider'); button.disabled = true; $('#provider-results').hidden = true; $('#provider-search-status').textContent = 'Consultando seu addon de legendas…';
  try {
    if (!state.providers.subtitles) throw new Error('Defina SUBTITLE_ADDON_URL nas variáveis da Vercel e faça um novo deploy para conectar seu addon de legendas.');
    const type = $('#content-type').value, videoId = $('#video-id').value.trim();
    const result = await api(`/api/subtitle-search?type=${encodeURIComponent(type)}&videoId=${encodeURIComponent(videoId)}`);
    const english = result.subtitles.filter(s => s.language === 'en'), portuguese = result.subtitles.filter(s => s.language === 'pt');
    if (!english.length) throw new Error('O addon não retornou legendas em inglês para este ID. Experimente outro ID/fonte ou importe o arquivo.');
    const options = entries => entries.map(item => `<option value="${esc(item.token)}">${esc(item.label)}</option>`).join('');
    $('#provider-en').innerHTML = options(english); $('#provider-pt').innerHTML = '<option value="">Sem português · traduzir depois</option>' + options(portuguese); if (portuguese.length) $('#provider-pt').selectedIndex = 1;
    $('#provider-title').value = state.profile.demo ? videoId : state.profile.title; $('#provider-results').hidden = false;
    $('#provider-search-status').textContent = `${english.length} opções em inglês e ${portuguese.length} em português. A pesquisa expira em 15 minutos. Confira a sincronia depois de importar.`;
  } catch (error) { $('#provider-search-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#import-provider').addEventListener('click', async () => {
  const button = $('#import-provider'); button.disabled = true;
  try {
    if (saveTimer) await persistProfile();
    const profile = await api('/api/subtitle-import', { method: 'POST', data: { englishToken: $('#provider-en').value, portugueseToken: $('#provider-pt').value, title: $('#provider-title').value.trim(), translationOffset: Number($('#provider-offset').value) || 0 } });
    state.profiles.push(profile); renderSessions(); selectProfile(profile.id); location.hash = 'studio'; toast(`${profile.cues.length} falas importadas do seu addon. Revise a sincronia e os blocos.`);
  } catch (error) { $('#provider-search-status').textContent = error.message; }
  finally { button.disabled = false; }
});
window.addEventListener('hashchange', navigate);
window.addEventListener('pagehide', () => { store('stats', state.stats); if (state.recorder?.state === 'recording') state.recorder.stop(); });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName) || document.querySelector('dialog[open]') || $('#view-studio').hidden) return;
  if (event.code === 'Space') { event.preventDefault(); $('#play').click(); } else if (event.key.toLowerCase() === 'r') $('#repeat').click(); else if (event.key.toLowerCase() === 't') $('#reveal').click(); else if (event.key === 'ArrowLeft') { event.preventDefault(); $('#previous').click(); } else if (event.key === 'ArrowRight') { event.preventDefault(); $('#next').click(); }
});
async function boot() {
  try {
    const result = await api('/api/state'); state.profiles = result.profiles; state.baseUrl = result.baseUrl; state.providers = result.providers; state.readOnly = result.readOnly; showCloudState(result);
    if (!state.profiles.length) throw new Error('Nenhuma sessão disponível. Confira a conexão com o banco de sessões.');
    renderSessions(); await selectProfile(new URLSearchParams(location.search).get('profile') || load('last-profile', '') || state.profiles[0].id); renderVocabulary(); navigate(); requestAnimationFrame(tick);
  } catch (error) { $('.studio-grid').innerHTML = `<div class="app-error">${esc(error.message)}<p>Confira a configuração da hospedagem e atualize a página.</p></div>`; }
}
boot();
