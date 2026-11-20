// Cenas autorais. Áudio de demonstração usa a voz sintética disponível no navegador.
export const DEMO = {
  id: 'scenelingo-demo', title: 'A little everyday English', type: 'movie', videoId: 'scenelingo-demo',
  description: 'Uma conversa original, feita para experimentar os métodos. Não é um trecho de filme.',
  cues: [
    { start: 600, end: 5600, en: 'I work at a hospital.', pt: 'Eu trabalho em um hospital.', segments: [{ en: 'I', pt: 'Eu', start: 0 }, { en: 'work', pt: 'trabalho', start: 300 }, { en: 'at', pt: 'em', start: 1100 }, { en: 'a', pt: 'um', start: 1900 }, { en: 'hospital.', pt: 'hospital.', start: 2700 }] },
    { start: 6300, end: 11300, en: "I have been looking forward to this.", pt: 'Eu estava ansioso por isso.', segments: [{ en: 'I', pt: 'Eu' }, { en: 'have been looking forward to', pt: 'estava ansioso por' }, { en: 'this.', pt: 'isso.' }] },
    { start: 12100, end: 17100, en: "Could you give me a hand?", pt: 'Você poderia me dar uma mão?', segments: [{ en: 'Could you', pt: 'Você poderia' }, { en: 'give me', pt: 'me dar' }, { en: 'a hand?', pt: 'uma mão?' }] },
    { start: 17900, end: 22400, en: "Let me figure it out.", pt: 'Deixe eu descobrir.', segments: [{ en: 'Let me', pt: 'Deixe eu' }, { en: 'figure it out.', pt: 'descobrir.' }] },
    { start: 23200, end: 28200, en: "It is not as hard as it looks.", pt: 'Não é tão difícil quanto parece.', segments: [{ en: 'It is not', pt: 'Não é' }, { en: 'as hard as', pt: 'tão difícil quanto' }, { en: 'it looks.', pt: 'parece.' }] },
    { start: 29000, end: 34000, en: "Take your time. There is no rush.", pt: 'Vá com calma. Não há pressa.', segments: [{ en: 'Take your time.', pt: 'Vá com calma.' }, { en: 'There is no', pt: 'Não há' }, { en: 'rush.', pt: 'pressa.' }] },
    { start: 34800, end: 39800, en: "What do you usually do after work?", pt: 'O que você costuma fazer depois do trabalho?', segments: [{ en: 'What do you', pt: 'O que você' }, { en: 'usually do', pt: 'costuma fazer' }, { en: 'after work?', pt: 'depois do trabalho?' }] },
    { start: 40600, end: 45600, en: "I would rather stay in tonight.", pt: 'Eu preferiria ficar em casa hoje à noite.', segments: [{ en: 'I would rather', pt: 'Eu preferiria' }, { en: 'stay in', pt: 'ficar em casa' }, { en: 'tonight.', pt: 'hoje à noite.' }] },
    { start: 46400, end: 51400, en: "That makes sense. I feel the same way.", pt: 'Isso faz sentido. Eu me sinto da mesma forma.', segments: [{ en: 'That makes sense.', pt: 'Isso faz sentido.' }, { en: 'I feel', pt: 'Eu me sinto' }, { en: 'the same way.', pt: 'da mesma forma.' }] },
    { start: 52200, end: 57200, en: "We can pick up where we left off.", pt: 'Podemos retomar de onde paramos.', segments: [{ en: 'We can', pt: 'Podemos' }, { en: 'pick up', pt: 'retomar' }, { en: 'where we left off.', pt: 'de onde paramos.' }] },
  ].map((c, i) => ({ ...c, id: `demo-${i + 1}`, timing: c.segments.every(s => Number.isFinite(s.start)) ? 'provided' : 'estimated', alignment: 'curated' })),
};
