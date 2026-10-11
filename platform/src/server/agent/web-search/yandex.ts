// Yandex Search API v2, web search, синхронный режим (research/18).
// Подтверждено документацией (aistudio.yandex.ru/docs/ru/search-api/api-ref/WebSearch/search):
// POST https://searchapi.api.cloud.yandex.net/v2/web/search; тело query{searchType, queryText ≤ 400},
// folderId, responseFormat FORMAT_XML, groupSpec{groupMode, groupsOnPage 1–100, docsInGroup 1–3}
// (int64 – строкой), maxPassages 1–5, l10n; ответ {rawData} – XML в bytes (в JSON – base64).
// Подтверждено пробой 09.10 (research/18): заголовок `Authorization: Api-Key …`, форма XML
// <yandexsearch><response><results><grouping><group><doc> с url, title, passages/passage, <hlword>.
export const SEARCH_ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
export const SEARCH_TIMEOUT_MS = 5_000;
export const SEARCH_RESULTS = 5;
export const SNIPPET_MAX = 300;
const TITLE_MAX = 200;

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchOutcome = { results: WebResult[]; error?: 'search_unavailable' };

export interface SearchDeps {
  apiKey: string;
  folderId: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function requestBody(query: string, folderId: string) {
  return {
    query: { searchType: 'SEARCH_TYPE_RU', queryText: query, familyMode: 'FAMILY_MODE_MODERATE' },
    folderId,
    responseFormat: 'FORMAT_XML',
    groupSpec: { groupMode: 'GROUP_MODE_FLAT', groupsOnPage: String(SEARCH_RESULTS), docsInGroup: '1' },
    maxPassages: '1',
    l10n: 'LOCALIZATION_RU',
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Текст из XML-фрагмента: без тегов (<hlword> и прочих), сущности раскрыты, без управляющих символов. */
export function xmlText(fragment: string): string {
  return fragment
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(doc: string, name: string): string | undefined {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(doc)?.[1];
}

/** Разбор XML выдачи: до limit документов {title, url, snippet ≤ 300}; только http(s)-ссылки. */
export function parseResults(xml: string, limit = SEARCH_RESULTS): WebResult[] {
  const out: WebResult[] = [];
  for (const m of xml.matchAll(/<doc\b[^>]*>([\s\S]*?)<\/doc>/g)) {
    const doc = m[1]!;
    const url = xmlText(tag(doc, 'url') ?? '');
    if (!/^https?:\/\//i.test(url)) continue;
    const title = xmlText(tag(doc, 'title') ?? '') || url;
    const passage = tag(doc, 'passage') ?? tag(doc, 'extended-text') ?? tag(doc, 'headline') ?? '';
    out.push({
      title: title.slice(0, TITLE_MAX),
      url: url.slice(0, 500),
      snippet: clipSnippet(xmlText(passage)),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function clipSnippet(s: string): string {
  return s.length <= SNIPPET_MAX ? s : `${s.slice(0, SNIPPET_MAX - 1)}…`;
}

/**
 * Запрос к поиску. Таймаут – AbortSignal.timeout, вместе с сигналом хода (AbortSignal.any).
 * Любая ошибка (сеть, таймаут, статус, разбор) → пустой результат с error, без исключения.
 */
export async function searchWeb(query: string, deps: SearchDeps): Promise<SearchOutcome> {
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? SEARCH_TIMEOUT_MS);
  const signal = deps.signal ? AbortSignal.any([timeout, deps.signal]) : timeout;
  try {
    const res = await (deps.fetch ?? fetch)(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${deps.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(query, deps.folderId)),
      signal,
    });
    if (!res.ok) return { results: [], error: 'search_unavailable' };
    const body = (await res.json()) as { rawData?: unknown };
    if (typeof body.rawData !== 'string') return { results: [], error: 'search_unavailable' };
    return { results: parseResults(Buffer.from(body.rawData, 'base64').toString('utf8')) };
  } catch {
    return { results: [], error: 'search_unavailable' };
  }
}
