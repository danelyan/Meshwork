import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchToolCall } from '@/server/agent/dispatch';
import { checkQuery, companyTerms, nameTerms, originTerms } from '@/server/agent/web-search/pii';
import {
  makeWebSearchTool,
  WEB_SEARCH_PER_CONVERSATION,
  WEB_SEARCH_PER_TURN,
  webSearchEnabled,
  withWebSearchGate,
} from '@/server/agent/web-search/tool';
import { parseResults, requestBody, searchWeb, SEARCH_ENDPOINT, SNIPPET_MAX, xmlText } from '@/server/agent/web-search/yandex';
import { resetEnvCache } from '@/server/env';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response><results><grouping><group><doc id="1">
<url>https://example.org/pg</url><domain>example.org</domain>
<title>Вопросы по <hlword>PostgreSQL</hlword> &amp; индексам</title>
<passages><passage>Индексы <hlword>B-tree</hlword>\u0007 и GIN &lt;важно&gt;</passage></passages></doc></group>
<group><doc id="2"><url>javascript:alert(1)</url><title>плохая ссылка</title></doc></group>
<group><doc id="3"><url>https://example.org/long</url><title></title><passages><passage>${'а'.repeat(400)}</passage></passages></doc></group>
</grouping></results></response></yandexsearch>`;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const okFetch = (xml = XML) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ rawData: b64(xml) }), { status: 200 }));

describe('PII-фильтр запроса веб-поиска', () => {
  it.each([
    ['ivan.petrov@mail.ru опыт', 'email'],
    ['+7 912 345-67-89', 'phone'],
    ['8 (912) 345 67 89 отзывы', 'phone'],
    ['телеграм @ivanp', 'handle'],
    ['https://github.com/ivan', 'url'],
    ['ivan-petrov.ru резюме', 'url'],
    ['паспорт 4510123456', 'digits'],
    ['найди мой GitHub', 'self'],
    ['что пишут про меня', 'self'],
    ['github ivan-petrov', 'profile_handle'],
    ['codeforces профиль tourist_2', 'profile_handle'],
    ['Иван Сидоров backend', 'person_name'],
    ['Сидорова Анна', 'person_name'],
    ['Кандидат #3F2A1C', 'alias'],
  ])('«%s» → отказ (%s)', (q, reason) => {
    const r = checkQuery(q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it.each(['вопросы на собеседовании Backend Middle PostgreSQL', 'как настроить GitHub Actions', 'socket.io vs websocket', 'Next.js 15 server actions', 'Codeforces рейтинг 1800 это много', 'Яндекс Практикум курсы', 'Kafka exactly once'])(
    '«%s» – обезличенный, проходит',
    (q) => expect(checkQuery(q)).toEqual({ ok: true }),
  );

  it('сверка с данными профиля: целым словом, без регистра и ё', () => {
    const terms = ['Ромашка-Софт', 'Пётр', 'petrov42'];
    expect(checkQuery('опыт в компании ромашка-софт', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('петр отзывы', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('PETROV42', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('петрушка рецепт', terms)).toEqual({ ok: true });
    expect(checkQuery('что угодно', ['ab'])).toEqual({ ok: true });
  });

  it('термины профиля: ники из ссылок, компании из резюме, имя без «демо:»', () => {
    expect(originTerms('https://github.com/ivan-petrov')).toEqual(['ivan-petrov']);
    expect(originTerms('codeforces:tourist')).toEqual(['tourist']);
    expect(originTerms('resume.pdf')).toEqual([]);
    expect(companyTerms('2022–2024 ООО «Ромашка», затем АО "Север"; в «Альфа-Софт»')).toEqual(expect.arrayContaining(['Ромашка', 'Север', 'Альфа-Софт']));
    expect(nameTerms('демо: Иван Петров (бэкенд)')).toEqual(['Иван Петров', 'Иван', 'Петров', 'ivan petrov', 'ivan', 'petrov']);
  });

  it('обходы: телефон без префикса, транслит, падежи', () => {
    expect(checkQuery('позвонить (999) 123 45 67')).toMatchObject({ ok: false, reason: 'phone' });
    expect(checkQuery('999-123-45-67 кто это')).toMatchObject({ ok: false, reason: 'phone' });
    const terms = nameTerms('Иван Петров');
    expect(checkQuery('Ivan Petrov github', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('отзывы PETROV', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('что известно о Петрову', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    expect(checkQuery('письмо петрова', terms)).toMatchObject({ ok: false, reason: 'profile_term' });
    // негативные: короткие термины целиком, цифры без телефона, обход через пробелы вокруг точек допускаем
    expect(checkQuery('ирак новости', ['Ира'])).toEqual({ ok: true });
    expect(checkQuery('кандидат 7 навыки')).toEqual({ ok: true });
    expect(checkQuery('React 18 и Node 20 в 2024 году')).toEqual({ ok: true });
    expect(checkQuery('ivan . petrov@mail . ru')).toEqual({ ok: true });
  });
});

describe('Yandex Search API v2: запрос и разбор', () => {
  it('тело запроса по документации: queryText, folderId, FORMAT_XML, groupSpec строками', () => {
    expect(requestBody('q', 'f1')).toEqual({
      query: { searchType: 'SEARCH_TYPE_RU', queryText: 'q', familyMode: 'FAMILY_MODE_MODERATE' },
      folderId: 'f1',
      responseFormat: 'FORMAT_XML',
      groupSpec: { groupMode: 'GROUP_MODE_FLAT', groupsOnPage: '5', docsInGroup: '1' },
      maxPassages: '1',
      l10n: 'LOCALIZATION_RU',
    });
  });

  it('XML → {title, url, snippet}: теги <hlword> и управляющие символы убраны, не-http пропущен, сниппет ≤ 300', () => {
    const r = parseResults(XML);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ title: 'Вопросы по PostgreSQL & индексам', url: 'https://example.org/pg', snippet: 'Индексы B-tree и GIN <важно>' });
    expect(r[1]!.title).toBe('https://example.org/long');
    expect(r[1]!.snippet.length).toBe(SNIPPET_MAX);
    expect(xmlText('a&#x41;&#66;&unknown;‮b')).toBe('aAB&unknown; b');
  });

  it('fetch: POST на endpoint с Api-Key, rawData base64 разбирается', async () => {
    const f = okFetch();
    const r = await searchWeb('вопросы PostgreSQL', { apiKey: 'k', folderId: 'f', fetch: f as unknown as typeof fetch });
    expect(r.results).toHaveLength(2);
    expect(r.error).toBeUndefined();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(SEARCH_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Api-Key k');
    expect(JSON.parse(String(init?.body)).query.queryText).toBe('вопросы PostgreSQL');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('ошибки → пустой результат с error, без исключения: статус, сеть, мусор, таймаут', async () => {
    const statuses = vi.fn(async () => new Response('nope', { status: 403 }));
    expect(await searchWeb('q', { apiKey: 'k', folderId: 'f', fetch: statuses as unknown as typeof fetch })).toEqual({ results: [], error: 'search_unavailable' });
    const net = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await searchWeb('q', { apiKey: 'k', folderId: 'f', fetch: net as unknown as typeof fetch })).toEqual({ results: [], error: 'search_unavailable' });
    const junk = vi.fn(async () => new Response('{"x":1}', { status: 200 }));
    expect(await searchWeb('q', { apiKey: 'k', folderId: 'f', fetch: junk as unknown as typeof fetch })).toEqual({ results: [], error: 'search_unavailable' });
    const hang = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const t0 = Date.now();
    expect(await searchWeb('q', { apiKey: 'k', folderId: 'f', fetch: hang as unknown as typeof fetch, timeoutMs: 30 })).toEqual({ results: [], error: 'search_unavailable' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('отмена хода (сигнал контекста) прерывает запрос', async () => {
    const ac = new AbortController();
    const hang = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const p = searchWeb('q', { apiKey: 'k', folderId: 'f', fetch: hang as unknown as typeof fetch, signal: ac.signal });
    ac.abort();
    expect(await p).toEqual({ results: [], error: 'search_unavailable' });
  });
});

describe('инструмент web_search', () => {
  beforeEach(() => {
    vi.stubEnv('YANDEX_API_KEY', 'test-key');
    vi.stubEnv('YANDEX_FOLDER_ID', 'test-folder');
    vi.stubEnv('WEB_SEARCH', 'auto');
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const role = (prior = 0, terms: string[] = []) => ({ profileTerms: vi.fn(async () => terms), conversationCalls: vi.fn(async () => prior) });
  const call = (query: string, id = 'w1') => ({ id, name: 'web_search', arguments: { query } });

  it('результат помечен untrusted и уходит в модель в <external_data>', async () => {
    const f = okFetch();
    const tool = makeWebSearchTool(role(1), { fetch: f as unknown as typeof fetch });
    const r = await dispatchToolCall([tool], {}, call('вопросы PostgreSQL'));
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/^<external_data source="tool:web_search" trust="untrusted">/);
    expect((r.output as { results: unknown[] }).results).toHaveLength(2);
  });

  it('PII в запросе → отказ с причиной до сети, fetch не вызывается', async () => {
    const f = okFetch();
    const tool = makeWebSearchTool(role(1, ['Ромашка']), { fetch: f as unknown as typeof fetch });
    for (const q of ['найди мой GitHub ivan-petrov', 'ivan@mail.ru', 'отзывы о компании Ромашка']) {
      const r = await dispatchToolCall([tool], {}, call(q));
      expect(r.ok, q).toBe(false);
      expect(JSON.parse(r.content).error.code).toBe('pii_in_query');
      expect(r.content).toMatch(/Переформулируй обезличенно/);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it(`не больше ${WEB_SEARCH_PER_TURN} вызовов за ход (счётчик – на контекст хода)`, async () => {
    const f = okFetch();
    const tool = makeWebSearchTool(role(1), { fetch: f as unknown as typeof fetch });
    const ctx = {};
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await dispatchToolCall([tool], ctx, call('вопросы PostgreSQL', `w${i}`))).ok);
    expect(codes).toEqual([true, true, false]);
    expect(f).toHaveBeenCalledTimes(2);
    expect((await dispatchToolCall([tool], {}, call('вопросы PostgreSQL'))).ok).toBe(true);
  });

  it(`не больше ${WEB_SEARCH_PER_CONVERSATION} за разговор (считаются записанные вызовы вместе с текущим)`, async () => {
    const f = okFetch();
    const ok = await dispatchToolCall([makeWebSearchTool(role(WEB_SEARCH_PER_CONVERSATION), { fetch: f as unknown as typeof fetch })], {}, call('q PostgreSQL'));
    expect(ok.ok).toBe(true);
    const over = await dispatchToolCall([makeWebSearchTool(role(WEB_SEARCH_PER_CONVERSATION + 1), { fetch: f as unknown as typeof fetch })], {}, call('q PostgreSQL'));
    expect(JSON.parse(over.content).error.code).toBe('web_search_limit');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('перенос строки в запросе – ошибка аргументов', async () => {
    const tool = makeWebSearchTool(role(), { fetch: okFetch() as unknown as typeof fetch });
    expect((await dispatchToolCall([tool], {}, call('a\nb c'))).errorCode).toBe('invalid_arguments');
  });

  it('WEB_SEARCH=off или нет ключей – инструмента нет в реестре', () => {
    const reg = [{ name: 'search_knowledge' }, { name: 'web_search' }];
    expect(webSearchEnabled()).toBe(true);
    expect(withWebSearchGate(reg)).toHaveLength(2);
    vi.stubEnv('WEB_SEARCH', 'off');
    resetEnvCache();
    expect(withWebSearchGate(reg).map((t) => t.name)).toEqual(['search_knowledge']);
    vi.stubEnv('WEB_SEARCH', 'auto');
    vi.stubEnv('YANDEX_FOLDER_ID', '');
    resetEnvCache();
    expect(webSearchEnabled()).toBe(false);
  });
});
