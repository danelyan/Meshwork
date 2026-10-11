// Сетевой замер STT/TTS для созвона. Запуск из platform/: node eval/scripts/stt-tts-bench.mjs
// Читает platform/.env (ключи не печатает). Результат: eval/results/stt-tts-bench.json
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const N = 3;
const now = () => performance.now();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) : null; };
const stat = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: a.length ? Math.round(Math.max(...a)) : null });
const yAuth = env.YANDEX_API_KEY?.startsWith('t1.') ? `Bearer ${env.YANDEX_API_KEY}` : `Api-Key ${env.YANDEX_API_KEY}`;

// ---- WER
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 0; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return { errors: d[r.length][h.length], words: r.length };
}

// ---- Эталоны
const STT_PHRASES = [
  'Здравствуйте, меня зовут Алексей, я работаю бэкенд разработчиком уже пять лет.',
  'Основной стек у меня питон и джанго, а ещё я немного писал на го.',
  'На прошлом проекте я отвечал за миграцию базы данных и снизил время ответа почти вдвое.',
  'Я хотел бы получить предложение с зарплатой от двухсот тысяч рублей на руки.',
  'Мне интересна удалённая работа, но в командировки я тоже готов выезжать.',
];
const KIRA = {
  short: 'Расскажите, пожалуйста, о вашем последнем проекте.',
  medium: 'Спасибо, это понятно. Давайте уточню: какую именно часть системы вы проектировали сами, а какую делала команда? И как вы проверяли, что решение выдерживает нагрузку?',
  long: 'Хорошо, давайте подведём промежуточный итог. Вы рассказали про опыт в бэкенде, про миграции баз данных и про работу с очередями сообщений. Теперь мне важно понять ваш уровень самостоятельности. Опишите ситуацию, когда вы принимали архитектурное решение без подсказок от коллег, какие варианты рассматривали и почему выбрали именно этот. Если было что-то, что вы сделали бы иначе сейчас, расскажите и об этом.',
};

// ---- TTS-клиенты: возвращают {ttfbHeaders, ttfb, total, bytes, status, buf}
async function streamFetch(url, init) {
  const t0 = now();
  let res;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(40000) }); }
  catch (e) { return { error: String(e.cause?.code || e.message) }; }
  const hdr = now() - t0;
  if (!res.ok) { const b = (await res.text()).slice(0, 160).replace(/(xi-api-key|Api-Key)\S*/g, '***'); return { status: res.status, error: b }; }
  const reader = res.body.getReader();
  const chunks = []; let ttfb = null;
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (ttfb === null && value.length) ttfb = now() - t0; chunks.push(value); }
  const buf = Buffer.concat(chunks);
  return { status: res.status, ttfbHeaders: hdr, ttfb, total: now() - t0, bytes: buf.length, buf };
}
const ttsEleven = (model, text, fmt = 'mp3_44100_128') => streamFetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE}/stream?output_format=${fmt}`, {
  method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ text, model_id: model, voice_settings: { speed: 1.1 } }),
});
const ttsYandexV1 = (text) => streamFetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
  method: 'POST', headers: { Authorization: yAuth, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ text, lang: 'ru-RU', voice: 'marina', speed: '1.10', format: 'mp3', emotion: 'neutral' }),
});
async function ttsYandexV3(text) {
  // REST-обёртка v3 (стрим JSON-строк с base64-чанками). Поля — по публичной доке v3 (инференс из-за недоступности страницы).
  const t0 = now();
  let res;
  try {
    res = await fetch('https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis', {
      method: 'POST', signal: AbortSignal.timeout(40000),
      headers: { Authorization: yAuth, 'x-folder-id': env.YANDEX_FOLDER_ID, 'content-type': 'application/json' },
      body: JSON.stringify({ text, outputAudioSpec: { containerAudio: { containerAudioType: 'MP3' } }, hints: [{ voice: 'marina' }, { speed: 1.1 }], loudnessNormalizationType: 'LUFS' }),
    });
  } catch (e) { return { error: String(e.cause?.code || e.message) }; }
  if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 160) };
  const reader = res.body.getReader(); let ttfb = null, bytes = 0, tail = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; tail += Buffer.from(value).toString(); if (ttfb === null && tail.includes('audioChunk')) ttfb = now() - t0; bytes += value.length; }
  return { status: res.status, ttfb, total: now() - t0, bytes };
}

// ---- STT-клиенты
function wav(pcm) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function sttWhisper(pcm) {
  const f = new FormData(); f.set('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'audio.wav'); f.set('model', env.STT_OPENAI_MODEL || 'whisper-large-v3'); f.set('language', 'ru'); f.set('response_format', 'json');
  const t0 = now();
  try {
    const r = await fetch(`${env.STT_OPENAI_BASE_URL.replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${env.STT_OPENAI_API_KEY}` }, body: f, signal: AbortSignal.timeout(30000) });
    const ms = now() - t0; if (!r.ok) return { status: r.status, ms, error: (await r.text()).slice(0, 120) };
    return { status: 200, ms, text: (await r.json()).text ?? '' };
  } catch (e) { return { error: String(e.cause?.code || e.message) }; }
}
async function sttYandex(pcm) {
  const t0 = now();
  try {
    const r = await fetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })}`, { method: 'POST', headers: { Authorization: yAuth, 'content-type': 'application/octet-stream' }, body: pcm, signal: AbortSignal.timeout(15000) });
    const ms = now() - t0; if (!r.ok) return { status: r.status, ms, error: (await r.text()).slice(0, 120) };
    return { status: 200, ms, text: (await r.json()).result ?? '' };
  } catch (e) { return { error: String(e.cause?.code || e.message) }; }
}

const out = { at: new Date().toISOString(), stt: {}, tts: {} };

// ---- 1. Фразы: ElevenLabs multilingual_v2, PCM 16 кГц (нейтрально к обоим STT; синтетика → WER оптимистичен)
const clips = [];
for (const text of STT_PHRASES) {
  const r = await ttsEleven('eleven_multilingual_v2', text, 'pcm_16000');
  if (!r.buf) { console.error('не удалось синтезировать фразу', r.status, r.error); process.exit(1); }
  clips.push({ text, pcm: r.buf, sec: r.buf.length / 32000 });
}
out.stt.clipSeconds = clips.map((c) => +c.sec.toFixed(1));

for (const [name, fn] of [['whisper-large-v3 (Selectel)', sttWhisper], ['yandex v1 sync', sttYandex]]) {
  const lat = [], errs = []; let e = 0, w = 0; const cold = []; const samples = [];
  for (let rep = 0; rep < N; rep++) for (const c of clips) {
    const r = await fn(c.pcm);
    if (r.error || r.status !== 200) { errs.push(r.status ?? r.error); continue; }
    lat.push(r.ms); const x = wer(c.text, r.text); if (rep === 0) { e += x.errors; w += x.words; samples.push(r.text); }
  }
  out.stt[name] = { latencyMs: stat(lat), wer: w ? +(e / w).toFixed(3) : null, errors: errs.length, errSample: errs[0], hyp: samples };
  console.log('STT', name, JSON.stringify(out.stt[name]));
}
// холодный: первый запрос после паузы 90 с (whisper может быть scale-to-zero / кэш) — один фоллбек-замер
await new Promise((r) => setTimeout(r, 90000));
out.stt.coldAfter90s = { whisper: (await sttWhisper(clips[0].pcm)).ms, yandex: (await sttYandex(clips[0].pcm)).ms };
console.log('STT after 90s idle', out.stt.coldAfter90s);

// ---- 2. TTS
const variants = [
  ['eleven multilingual_v2', (t) => ttsEleven('eleven_multilingual_v2', t)],
  ['eleven flash_v2_5', (t) => ttsEleven('eleven_flash_v2_5', t)],
  ['eleven turbo_v2_5', (t) => ttsEleven('eleven_turbo_v2_5', t)],
  ['eleven v4_turbo', (t) => ttsEleven('eleven_v4_turbo', t)],
  ['eleven v4 (.env ELEVENLABS_MODEL)', (t) => ttsEleven(env.ELEVENLABS_MODEL || 'eleven_v4', t)],
  ['yandex v1 marina mp3', ttsYandexV1],
  ['yandex v3 marina mp3', ttsYandexV3],
];
for (const [name, fn] of variants) {
  out.tts[name] = {};
  for (const [k, text] of Object.entries(KIRA)) {
    const ttfb = [], tot = [], hdr = [], errs = []; let bytes = 0;
    for (let i = 0; i < N; i++) {
      const r = await fn(text);
      if (r.error) { errs.push(`${r.status ?? ''} ${r.error}`); continue; }
      if (r.ttfb != null) ttfb.push(r.ttfb); tot.push(r.total); if (r.ttfbHeaders) hdr.push(r.ttfbHeaders); bytes = r.bytes;
    }
    out.tts[name][k] = { chars: text.length, ttfbMs: stat(ttfb), totalMs: stat(tot), bytes, errors: errs.length, errSample: errs[0] };
  }
  console.log('TTS', name, JSON.stringify(out.tts[name]));
}
fs.writeFileSync(path.join(root, 'eval/results/stt-tts-bench.json'), JSON.stringify(out, null, 1));
