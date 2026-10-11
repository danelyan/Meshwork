// Замер скорости LLM по стриму (TTFT, до первого предложения, ток/с) + проба tools/json_schema.
// Только сеть. Ключи читаются из platform/.env и ~/.selectel-*-key, в вывод не попадают.
// Запуск из platform/: node eval/scripts/llm-speed.mjs [--repeats 3] [--only id1,id2]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  }),
);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const REPEATS = Number(arg('repeats', 3));
const only = arg('only', '')?.split(',').filter(Boolean);
const yKey = env.YANDEX_API_KEY, folder = env.YANDEX_FOLDER_ID;
const yH = { Authorization: `Api-Key ${yKey}`, 'OpenAI-Project': folder };
const y = (name) => ({ think: /v4\.1|qwen3\.6|gpt-oss/.test(name), id: 'y:' + name, provider: 'Yandex', base: 'https://llm.api.cloud.yandex.net/v1', model: `gpt://${folder}/${name}/latest`, headers: yH });
const sKey = (k) => readFileSync(`${homedir()}/.selectel-${k}-key`, 'utf8').trim();
const NOTHINK = { chat_template_kwargs: { enable_thinking: false } };
const MODELS = [
  y('deepseek-v4-flash'), y('deepseek-v4.1-flash'), y('aliceai-llm'), y('aliceai-llm-flash'),
  y('qwen3.6-35b-a3b'), y('gpt-oss-120b'), y('gpt-oss-20b'), y('yandexgpt-5.1'), y('yandexgpt-5-pro'), y('yandexgpt-5-lite'),
  { id: 's:qwen3-8-27b-nvfp4 (no-think)', provider: 'Selectel', base: env.OPENAI_CHAT_BASE_URL, model: 'qwen3-8-27b-nvfp4', headers: { Authorization: `Bearer ${sKey('qwen27b')}` }, extra: NOTHINK },
  { id: 's:qwen3-8-27b-nvfp4 (think)', provider: 'Selectel', base: env.OPENAI_CHAT_BASE_URL, model: 'qwen3-8-27b-nvfp4', headers: { Authorization: `Bearer ${sKey('qwen27b')}` }, think: true },
].filter((m) => !only.length || only.some((o) => m.id.includes(o)));

const SYS = 'Ты Кира, интервьюер платформы подбора ИТ-специалистов. Ведёшь голосовой созвон с кандидатом на позицию backend-разработчика. Отвечай по-русски, 2-3 коротких предложения, без списков и markdown: уточни деталь в ответе кандидата и задай один следующий вопрос.';
const HIST = [
  { role: 'assistant', content: 'Здравствуйте! Расскажите, какой сервис вы делали последним и что в нём было вашей зоной ответственности.' },
  { role: 'user', content: 'Проектировал API заказов: ресурсы orders и items, при создании отдаю 201 и Location, при конфликте статуса 409. Пагинацию сделал курсором по created_at и id, потому что offset тормозит и даёт дубли.' },
  { role: 'assistant', content: 'Понятно, курсорная пагинация — хороший выбор. А как вы защищали эндпоинты от доступа к чужим заказам?' },
  { role: 'user', content: 'Права проверяю в сервисном слое одной функцией: владелец заказа или бариста. Для чужого заказа возвращаю 404, а не 403, чтобы не раскрывать, что такой id есть. Есть интеграционный тест на IDOR.' },
];
const CALL = [{ role: 'system', content: SYS }, ...HIST];
const CHAT_CTX = 'Резюме кандидата: ' + 'Python, FastAPI, PostgreSQL, Redis, Docker, CI/CD, интеграционные тесты, outbox-паттерн, очереди сообщений. '.repeat(40);
const CHAT = [
  { role: 'system', content: 'Ты консультант платформы подбора ИТ-специалистов. Отвечай по-русски, по делу, до 150 слов. ' + CHAT_CTX },
  { role: 'user', content: 'Какие у меня сильные стороны для позиции middle backend и что мне подтянуть до собеседования? Дай конкретный план на неделю.' },
];

const sentEnd = /[.!?…](\s|$)/;

async function stream(m, messages, maxTokens) {
  const body = { model: m.model, messages, stream: true, max_tokens: maxTokens, temperature: 0.3, stream_options: { include_usage: true }, ...(m.extra ?? {}) };
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${m.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...m.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  } catch (e) { return { err: String(e.message ?? e).slice(0, 80) }; }
  if (!res.ok) return { err: `HTTP ${res.status} ${(await res.text()).slice(0, 120).replace(/\s+/g, ' ')}` };
  const dec = new TextDecoder(); let buf = '', text = '', firstAny = null, firstContent = null, firstSentence = null, usage = null, reasoning = 0;
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch { continue; }
        if (j.usage) usage = j.usage;
        const dl = j.choices?.[0]?.delta; if (!dl) continue;
        const now = performance.now() - t0;
        if (dl.reasoning_content || dl.reasoning) { reasoning++; firstAny ??= now; }
        if (dl.content) {
          firstAny ??= now; firstContent ??= now; text += dl.content;
          if (firstSentence == null && sentEnd.test(text)) firstSentence = now;
        }
      }
    }
  } catch (e) { return { err: 'stream: ' + String(e.message).slice(0, 80) }; }
  const total = performance.now() - t0;
  const outTok = usage?.completion_tokens ?? Math.round(text.length / 3.5);
  const genMs = firstContent != null ? total - firstContent : null;
  return { ttftAny: firstAny, ttftContent: firstContent, firstSentence, total, outTok, chars: text.length, reasoningChunks: reasoning, usage: !!usage, tokPerS: genMs && genMs > 50 ? (outTok / genMs) * 1000 : null, sample: text.slice(0, 120) };
}

async function probe(m) {
  const out = {};
  const base = { model: m.model, max_tokens: m.think ? 800 : 300, ...(m.extra ?? {}) };
  const post = async (b) => {
    try {
      const r = await fetch(`${m.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...m.headers }, body: JSON.stringify({ ...base, ...b }), signal: AbortSignal.timeout(90000) });
      return { status: r.status, j: await r.json().catch(() => null) };
    } catch (e) { return { status: 0, j: null, e: String(e.message) }; }
  };
  const t = await post({ messages: [{ role: 'user', content: 'Какая погода в Москве? Используй инструмент.' }], tools: [{ type: 'function', function: { name: 'get_weather', description: 'Погода в городе', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }], tool_choice: 'auto' });
  out.tools = t.status === 200 ? (t.j?.choices?.[0]?.message?.tool_calls?.length ? 'да' : 'принял, вызова нет') : `нет (${t.status})`;
  const s = await post({ messages: [{ role: 'user', content: 'Верни JSON: название города Москва и население в миллионах (примерно).' }], response_format: { type: 'json_schema', json_schema: { name: 'city', strict: true, schema: { type: 'object', properties: { city: { type: 'string' }, population_m: { type: 'number' } }, required: ['city', 'population_m'], additionalProperties: false } } } });
  let ok = false;
  if (s.status === 200) { try { const c = JSON.parse(s.j.choices[0].message.content); ok = typeof c.city === 'string' && typeof c.population_m === 'number'; } catch {} }
  out.json_schema = s.status === 200 ? (ok ? 'да' : 'принял, JSON невалиден') : `нет (${s.status})`;
  return out;
}

const results = [];
for (const m of MODELS) {
  console.log('##', m.id);
  const r = { id: m.id, provider: m.provider, model: m.model.replace(/gpt:\/\/[^/]+\//, ''), call: [], chat: [], errors: [] };
  const maxCall = m.think ? 1500 : 120, maxChat = m.think ? 2500 : 350;
  for (let i = 0; i < REPEATS; i++) {
    const c = await stream(m, CALL, maxCall); if (c.err) r.errors.push('call: ' + c.err); else r.call.push({ ...c, cold: i === 0 });
    console.log(' call', i, c.err ?? `ttftC=${c.ttftContent?.toFixed(0)} ttftAny=${c.ttftAny?.toFixed(0)} 1st=${c.firstSentence?.toFixed(0)} total=${c.total.toFixed(0)} tok=${c.outTok} tps=${c.tokPerS?.toFixed(0)}`);
  }
  for (let i = 0; i < REPEATS; i++) {
    const c = await stream(m, CHAT, maxChat); if (c.err) r.errors.push('chat: ' + c.err); else r.chat.push({ ...c, cold: i === 0 });
    console.log(' chat', i, c.err ?? `ttftC=${c.ttftContent?.toFixed(0)} total=${c.total.toFixed(0)} tok=${c.outTok} tps=${c.tokPerS?.toFixed(0)}`);
  }
  Object.assign(r, await probe(m));
  console.log(' probe', r.tools, r.json_schema, r.errors.length ? 'ERR ' + r.errors.join(' | ') : '');
  results.push(r);
}
const stamp = new Date().toLocaleString('sv', { timeZone: 'Europe/Moscow' }).replace(/[: ]/g, '-').slice(0, 16);
mkdirSync('eval/results', { recursive: true });
const file = `eval/results/llm-speed-${stamp}.json`;
writeFileSync(file, JSON.stringify({ at: stamp + ' МСК', repeats: REPEATS, note: 'call = персона Кира, 4 реплики истории, max 120 ток; chat = системный промпт ~1.5к ток + вопрос, max 350 ток. Повтор 0 — холодный.', results }, null, 1));
console.log('written', file);
