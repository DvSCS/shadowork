(async () => {
  if (window.__sceneLingoOpen) { window.__sceneLingoOpen(); return; }
  const { config, MODES, parseSubtitles, pairSubtitles, validateCues, activeCue, subtitleFrame, escapeHtml: esc, normalize, formatTime } = await import(chrome.runtime.getURL('shared/core.js'));
  const saved = await chrome.storage.local.get(['settings', 'cards']);
  let settings = config(saved.settings), cues = [], known = [], cards = Array.isArray(saved.cards) ? saved.cards : [], video = null, frameId, lastRender = 0, lastKey = '', selected = 0, revealed = false, practice = null, waitUntil = 0, recorder = null, recordUrl = null, recordTimeout, lastCue = -1, destroyed = false;
  const host = document.createElement('div'); host.id = 'scenelingo-overlay-host'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<link rel="stylesheet" href="${chrome.runtime.getURL('overlay.css')}"><div id="sl-subtitles"><div id="sl-main"></div><div id="sl-secondary"></div></div><section id="sl-panel" aria-label="Painel SceneLingo"><header><strong>Scene<span>Lingo</span></strong><div><button id="sl-minimize" title="Recolher painel" aria-label="Recolher painel">−</button><button id="sl-close" title="Encerrar extensão nesta aba" aria-label="Fechar">×</button></div></header><div id="sl-body"><p class="intro">Seu inglês. No ritmo da cena.</p><div id="sl-status" role="status">Procurando vídeo HTML5…</div><label class="file-label">↑ Abrir sessão JSON ou legenda EN<input id="sl-file" type="file" accept=".json,.srt,.vtt"></label><div class="row"><label>Legenda<select id="sl-mode">${Object.entries(MODES).map(([key, value]) => `<option value="${key}">${esc(value.name)}</option>`).join('')}</select></label></div><div class="row"><label>Fala<select id="sl-cue"><option>Carregue uma sessão</option></select></label></div><div class="buttons"><button id="sl-prev" title="Fala anterior">⇤</button><button id="sl-play">▶</button><button id="sl-next" title="Próxima fala">⇥</button><button id="sl-repeat">↻ Repetir</button><button id="sl-reveal">Aa Revelar</button></div><div class="row"><label>Prática<select id="sl-method"><option value="shadow">Shadowing · falar junto</option><option value="echo">Eco · ouvir e repetir</option><option value="ladder">Escada · retirar apoio</option></select></label></div><div class="buttons"><button class="primary" id="sl-practice">Iniciar prática</button><button id="sl-record">Gravar voz</button></div><div id="sl-phase"></div><audio id="sl-recording" controls hidden></audio><p class="hint">Gravação local, sem nota de pronúncia. Compare ouvindo.</p><details><summary>Ajustar minha experiência</summary><label>Aparecimento<select data-setting="reveal"><option value="rolling">Palavra por palavra</option><option value="full">Frase inteira primeiro</option></select></label><label>Direção<select data-setting="direction"><option value="en-pt">EN → PT</option><option value="pt-en">PT → EN</option></select></label><label>Unidade<select data-setting="granularity"><option value="word">Menor unidade segura</option><option value="chunk">Blocos de sentido</option></select></label><label>Atraso da tradução (ms)<input data-setting="translationDelay" type="number" min="0" max="10000" step="50"></label><label>Sincronia da legenda (ms)<input data-setting="subtitleOffset" type="number" min="-60000" max="60000" step="100"></label><label>Velocidade<input data-setting="speed" type="number" min=".5" max="1.5" step=".05"></label><label>Repetições<input data-setting="repeatCount" type="number" min="1" max="10"></label><label>Pausa do eco (ms)<input data-setting="echoGap" type="number" min="500" max="15000" step="250"></label><label>Tamanho (px)<input data-setting="fontSize" type="number" min="16" max="64"></label><label>Altura (%)<input data-setting="subtitlePosition" type="number" min="2" max="65"></label><label class="check"><input data-setting="showOriginal" type="checkbox"> Inglês de apoio</label><label class="check"><input data-setting="pauseAfter" type="checkbox"> Pausar ao fim de cada fala</label></details><div class="buttons"><button id="sl-save">＋ Salvar fala</button><button id="sl-export-cards">↓ Anki TSV (${cards.length})</button></div><p class="hint">Use o estúdio para importar duas legendas, alinhar blocos e configurar todos os detalhes. Carregue o JSON exportado aqui. Desative a legenda do player se o texto aparecer duplicado.</p></div></section><button id="sl-bubble" hidden title="Abrir SceneLingo">SL</button>`;
  document.documentElement.append(host);
  const $ = id => root.querySelector(id);
  const message = text => { $('#sl-status').textContent = text; };
  function apply() {
    $('#sl-mode').value = settings.mode;
    for (const input of root.querySelectorAll('[data-setting]')) { if (input.type === 'checkbox') input.checked = settings[input.dataset.setting]; else input.value = settings[input.dataset.setting]; }
    $('#sl-subtitles').style.fontSize = `${settings.fontSize}px`; $('#sl-subtitles').style.bottom = `${settings.subtitlePosition}%`;
    $('#sl-subtitles').style.setProperty('--sl-bg', `rgba(6,12,9,${settings.backgroundOpacity / 100})`);
    $('#sl-subtitles').style.setProperty('--english-color', settings.englishColor); $('#sl-subtitles').style.setProperty('--portuguese-color', settings.portugueseColor);
    if (video) video.playbackRate = settings.speed; lastKey = '';
  }
  function findVideo() {
    if (video?.isConnected) return;
    const candidates = [...document.querySelectorAll('video')].sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
    video = candidates.find(v => v.currentSrc) || candidates[0] || null;
    if (video) { apply(); message(cues.length ? `${cues.length} falas · vídeo conectado` : 'Vídeo conectado. Abra sua sessão SceneLingo.'); }
    else message('Vídeo não encontrado. Inicie o player. Vídeos em iframe de outro domínio e apps nativos não são acessíveis.');
  }
  const scan = setInterval(findVideo, 1500); findVideo();
  function stopPractice() { practice = null; waitUntil = 0; $('#sl-phase').textContent = ''; $('#sl-practice').textContent = 'Iniciar prática'; }
  async function playVideo() { if (!video) { message('Inicie um vídeo HTML5 nesta página.'); return; } try { await video.play(); } catch { message('Clique no player para permitir a reprodução e tente novamente.'); stopPractice(); } }
  function seek(index, keepPractice = false) {
    if (!video || !cues.length) return;
    if (!keepPractice) stopPractice(); selected = Math.min(cues.length - 1, Math.max(0, index));
    video.currentTime = Math.max(0, (cues[selected].start + settings.subtitleOffset - (keepPractice ? settings.loopPadding : 0)) / 1000); revealed = false; lastCue = -1; lastKey = ''; $('#sl-cue').value = selected;
  }
  function phase() { if (!practice) return; $('#sl-phase').textContent = `${practice.method === 'echo' ? 'Escute' : practice.method === 'ladder' ? ['Com tradução', 'Só inglês', 'Sem legenda'][Math.min(2, practice.round)] : 'Repita junto'} · ${practice.round + 1}/${practice.total}`; }
  let previousTime = 0;
  function render(now) {
    if (destroyed) return; frameId = requestAnimationFrame(render);
    if (now - lastRender < 60 || !video || !cues.length) return; lastRender = now;
    const time = video.currentTime * 1000, active = activeCue(cues, time, settings.subtitleOffset);
    if (practice) {
      if (waitUntil && now >= waitUntil) {
        waitUntil = 0; practice.round++;
        if (practice.round >= practice.total) { stopPractice(); message('Prática concluída. Tente dizer a fala sem olhar.'); }
        else { seek(practice.index, true); phase(); playVideo(); }
      } else if (!waitUntil && !video.paused && time >= practice.cue.end + settings.subtitleOffset + settings.loopPadding) {
        video.pause(); waitUntil = now + (practice.method === 'echo' ? settings.echoGap : 450);
        if (practice.method === 'echo') $('#sl-phase').textContent = 'Sua vez · repita a fala';
      }
    } else if (settings.pauseAfter && !video.paused && time >= previousTime) {
      if (cues.some(cue => previousTime < cue.end + settings.subtitleOffset && time >= cue.end + settings.subtitleOffset)) video.pause();
    }
    previousTime = time;
    if (active) {
      if (lastCue !== active.index) { lastCue = active.index; selected = active.index; revealed = false; $('#sl-cue').value = selected; }
      const c = practice?.method === 'ladder' ? { ...settings, mode: ['bilingual', 'english', 'listening'][Math.min(2, practice.round)] } : settings;
      const frame = subtitleFrame(active.cue, time - active.cue.start - settings.subtitleOffset, c, { revealed, known });
      const key = JSON.stringify(frame); if (key !== lastKey) {
        lastKey = key; $('#sl-main').innerHTML = frame.parts.map(p => `<span class="lang-${p.lang} ${p.active ? 'active' : ''}">${esc(p.text)}</span>`).join(' '); $('#sl-secondary').textContent = frame.secondary;
      }
    } else if (lastKey !== 'empty') { lastKey = 'empty'; $('#sl-main').textContent = ''; $('#sl-secondary').textContent = ''; }
    $('#sl-play').textContent = video.paused ? '▶' : 'Ⅱ';
  }
  function openPanel() { $('#sl-panel').hidden = false; $('#sl-bubble').hidden = true; findVideo(); }
  window.__sceneLingoOpen = openPanel;
  function destroy() {
    destroyed = true; clearInterval(scan); clearTimeout(recordTimeout); cancelAnimationFrame(frameId); document.removeEventListener('fullscreenchange', fullscreen);
    if (recorder?.state === 'recording') recorder.stop(); if (recordUrl) URL.revokeObjectURL(recordUrl); host.remove(); delete window.__sceneLingoOpen;
  }
  $('#sl-close').onclick = destroy;
  $('#sl-minimize').onclick = () => { $('#sl-panel').hidden = true; $('#sl-bubble').hidden = false; };
  $('#sl-bubble').onclick = openPanel;
  $('#sl-file').onchange = async () => {
    try {
      const file = $('#sl-file').files[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) throw new Error('Limite de 12 MB por sessão.');
      if (/\.json$/i.test(file.name)) {
        const session = JSON.parse(await file.text()); cues = validateCues(session.cues); settings = config(session.config || settings); known = Array.isArray(session.known) ? session.known.filter(t => typeof t === 'string') : [];
      } else { const en = parseSubtitles(await file.text()); cues = validateCues(pairSubtitles(en, [])); }
      stopPractice(); lastCue = -1; selected = 0; apply();
      $('#sl-cue').innerHTML = cues.map((c, i) => `<option value="${i}">${formatTime(c.start)} · ${esc(c.en.slice(0, 70))}</option>`).join('');
      message(`${cues.length} falas carregadas · ${cues.some(c => c.segments.length) ? 'blocos alinhados' : 'sem alinhamento por palavra'}`);
      await chrome.storage.local.set({ settings });
    } catch (error) { message(error.message); }
  };
  $('#sl-mode').onchange = () => { settings = config({ ...settings, mode: $('#sl-mode').value }); stopPractice(); apply(); chrome.storage.local.set({ settings }); };
  for (const input of root.querySelectorAll('[data-setting]')) input.onchange = () => { settings = config({ ...settings, [input.dataset.setting]: input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value) }); stopPractice(); apply(); chrome.storage.local.set({ settings }); };
  $('#sl-cue').onchange = () => seek(Number($('#sl-cue').value));
  $('#sl-prev').onclick = () => seek(selected - 1); $('#sl-next').onclick = () => seek(selected + 1);
  $('#sl-play').onclick = () => { if (!video) return findVideo(); if (video.paused) playVideo(); else { video.pause(); stopPractice(); } };
  $('#sl-repeat').onclick = () => { seek(selected); playVideo(); };
  $('#sl-reveal').onclick = () => { revealed = !revealed; lastKey = ''; };
  $('#sl-practice').onclick = () => {
    if (practice) { video?.pause(); stopPractice(); return; }
    if (!video || !cues.length) { message('Conecte um vídeo e carregue a sessão primeiro.'); return; }
    const method = $('#sl-method').value; practice = { method, index: selected, cue: cues[selected], round: 0, total: method === 'ladder' ? 3 : settings.repeatCount }; seek(selected, true); phase(); $('#sl-practice').textContent = 'Encerrar prática'; playVideo();
  };
  $('#sl-record').onclick = async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microfone indisponível. Use uma página HTTPS e permita o acesso ao microfone.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = []; recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => { clearTimeout(recordTimeout); stream.getTracks().forEach(t => t.stop()); if (destroyed) return; if (recordUrl) URL.revokeObjectURL(recordUrl); recordUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })); $('#sl-recording').src = recordUrl; $('#sl-recording').hidden = false; $('#sl-record').textContent = 'Gravar voz'; message('Gravação pronta. Ouça e compare com o modelo.'); };
      recorder.start(); $('#sl-record').textContent = '■ Parar'; message('Gravando. Use fones para evitar o áudio do player na gravação.'); recordTimeout = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 90000);
    } catch (error) { stream?.getTracks().forEach(t => t.stop()); message(error.message); }
  };
  $('#sl-save').onclick = async () => {
    const cue = cues[selected]; if (!cue) return;
    if (cards.some(c => normalize(c.front) === normalize(cue.en))) { message('Essa fala já foi salva.'); return; }
    cards.push({ id: crypto.randomUUID(), front: cue.en, back: cue.pt, context: `${document.title} · ${formatTime(cue.start)}`, due: Date.now(), interval: 0, reviews: 0, ease: 2.5 });
    try { await chrome.storage.local.set({ cards }); $('#sl-export-cards').textContent = `↓ Anki TSV (${cards.length})`; message('Fala salva na coleção local da extensão.'); } catch { message('Não foi possível salvar. Exporte a coleção para liberar espaço.'); }
  };
  $('#sl-export-cards').onclick = () => {
    const cell = t => String(t || '').replace(/[\t\r\n]+/g, ' '), text = '#separator:tab\n#html:false\n' + cards.map(c => [c.front, c.back, c.context].map(cell).join('\t')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/tab-separated-values' })), a = document.createElement('a'); a.href = url; a.download = 'scenelingo-extensao-anki.tsv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  function fullscreen() {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && fullscreenElement.tagName !== 'VIDEO') fullscreenElement.append(host); else document.documentElement.append(host);
    if (fullscreenElement?.tagName === 'VIDEO') message('A tela cheia nativa do vídeo não admite o painel. Use a tela cheia do contêiner do player ou saia da tela cheia.');
  }
  document.addEventListener('fullscreenchange', fullscreen); apply(); frameId = requestAnimationFrame(render);
})().catch(error => console.warn('SceneLingo: não foi possível abrir o painel.', error));
