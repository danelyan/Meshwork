// Запрет персональных данных в запросе веб-поиска — кодом, до сети (research/18 «Защита от PII»).
// Эвристика, не гарантия: главная страховка — описание инструмента и то, что запрос собирает
// модель, а не поля профиля. Любое срабатывание → отказ с причиной, модель переформулирует.

export type PiiReason = 'email' | 'phone' | 'handle' | 'url' | 'digits' | 'self' | 'profile_handle' | 'alias' | 'person_name' | 'profile_term';

export type PiiCheck = { ok: true } | { ok: false; reason: PiiReason; message: string };

const RULES: { reason: PiiReason; re: RegExp; message: string }[] = [
  { reason: 'email', re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u, message: 'в запросе адрес почты' },
  { reason: 'phone', re: /(?:\+7|(?<!\d)8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/u, message: 'в запросе номер телефона' },
  { reason: 'handle', re: /(?<![\p{L}\p{N}])@[\p{L}\p{N}_.]{2,}/u, message: 'в запросе ник (@…)' },
  {
    reason: 'url',
    re: /https?:\/\/|www\.|github\.io|(?<![\p{L}\p{N}])[\p{L}\p{N}-]+\.(ru|com|net|org|me|su|рф|info|pro|site|xyz)(?![\p{L}\p{N}])/iu,
    message: 'в запросе ссылка или домен',
  },
  { reason: 'digits', re: /\d{6,}/u, message: 'в запросе длинное число (телефон, номер документа, id)' },
  {
    reason: 'self',
    re: /(?<!\p{L})(мой|моя|моё|мое|мою|моего|моей|моему|мои|моих|меня|обо мне|про меня)(?!\p{L})/iu,
    message: 'запрос о самом человеке («мой», «про меня»)',
  },
  {
    reason: 'profile_handle',
    re: /(?<!\p{L})(github|gitlab|codeforces|leetcode|linkedin|habr|хабр|telegram|телеграм|vk|вк|stackoverflow|гитхаб)\p{L}*(\s+(профил\p{L}*|аккаунт\p{L}*|ник|логин|пользовател\p{L}*))?[\s:/]+[a-z]*[a-z][a-z0-9]*[-_\d][a-z0-9_-]*/iu,
    message: 'в запросе логин или профиль на сайте',
  },
  {
    // «Иван Сидоров», «Сидорова Анна»: два слова с заглавной, одно — с фамильным окончанием.
    reason: 'person_name',
    re: /(?<!\p{L})([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]*(ов|ев|ёв|ин|ын|ова|ева|ина|ына|ский|ская|цкий|цкая|ко|ук|юк|енко)|[А-ЯЁ][а-яё]*(ов|ев|ёв|ин|ын|ова|ева|ина|ына|ский|ская|цкий|цкая|енко)\s+[А-ЯЁ][а-яё]+)(?!\p{L})/u,
    message: 'в запросе похоже на имя и фамилию человека',
  },
  { reason: 'alias', re: /кандидат\p{L}*\s*#|#[0-9a-f]{6}(?![0-9a-f])/iu, message: 'в запросе псевдоним кандидата' },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function hasTerm(q: string, term: string): boolean {
  const t = norm(term);
  if (t.length < 3) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(q);
}

/**
 * Проверка запроса: регэкспы (почта, телефон, @ник, ссылка/домен, ≥ 6 цифр, «про меня»,
 * логин рядом с названием сайта, псевдоним кандидата) и сверка с данными человека из
 * контекста (имя, фамилия, почта, ники, компании, ссылки) — целым словом, без регистра.
 */
export function checkQuery(query: string, profileTerms: string[] = []): PiiCheck {
  for (const r of RULES) if (r.re.test(query)) return { ok: false, reason: r.reason, message: r.message };
  const q = norm(query);
  for (const term of profileTerms) {
    if (hasTerm(q, term)) return { ok: false, reason: 'profile_term', message: 'в запросе данные из профиля человека (имя, ник, компания или ссылка)' };
  }
  return { ok: true };
}

const GENERIC_HOSTS = new Set(['github', 'gitlab', 'codeforces', 'stackoverflow', 'leetcode', 'linkedin', 'habr', 'users', 'profile', 'https', 'http', 'www', 'com', 'org', 'ru', 'io', 'net', 'questions', 'user', 'fsp', 'upload', 'resume', 'pdf', 'docx', 'demo']);

/** Ники и части ссылок из origin источника: «https://github.com/ivan-petrov» → ['ivan-petrov']. */
export function originTerms(origin: string): string[] {
  return origin
    .split(/[/:?#=&@\s]+/)
    .map((p) => p.replace(/\.(pdf|docx?|txt|md)$/i, ''))
    .filter((p) => p.length >= 3 && !GENERIC_HOSTS.has(p.toLowerCase()) && !/^\d+$/.test(p) && !/\./.test(p));
}

/** Названия компаний из текста резюме: «ООО Ромашка», «АО "Север"», «в «Альфа-Софт»». */
export function companyTerms(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:ООО|ОАО|ЗАО|ПАО|АО|ИП)\s*[«"]?([^»"\n,.;]{2,40})/gu)) out.add(m[1]!.trim());
  for (const m of text.matchAll(/«([^»\n]{2,40})»/gu)) out.add(m[1]!.trim());
  return [...out].filter((t) => t.length >= 3);
}

/** Имя «Иван Петров» → полное имя и слова ≥ 3 букв (служебные «демо:», скобки — мимо). */
export function nameTerms(name: string): string[] {
  const clean = name.replace(/^демо:\s*/i, '').replace(/\(.*?\)/g, '').trim();
  return [clean, ...clean.split(/\s+/)].filter((w) => w.length >= 3);
}
