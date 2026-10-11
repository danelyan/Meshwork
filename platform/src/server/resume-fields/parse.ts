// lane resume-fields (R-C-01/02): распознавание полей профиля в резюме – ФИО, контакт, стаж, роли, софт-скиллы.
// Детерминированные правила, без LLM: одинаково работают на стенде с ключом и в демо без ключей (LLM_PROVIDER=stub).
// У каждого поля – дословная строка-источник (quote) и её ref, как у утверждений claims.
import { maskContacts } from '../collector/mask';
import { normalizeContact } from '../contact';
import type { DocLine, ExtractedDoc } from '../collector/types';

export const RESUME_FIELD_KEYS = ['name', 'contact', 'experienceYears', 'roles', 'softSkills'] as const;
export type ResumeFieldKey = (typeof RESUME_FIELD_KEYS)[number];
export type ResumeFieldValue = string | number | string[];

export interface ParsedResumeField {
  key: ResumeFieldKey;
  value: ResumeFieldValue;
  quote: string;
  sourceRef: string;
}

/** Строки с контактами до маскирования: в ExtractedDoc они уже `[скрыто]` (collector/mask.ts). */
export interface RawContactLine {
  ref: string;
  text: string;
}

const NAME_WORD = /^[А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁA-Z][а-яёa-z]+)?$/u;
const ROLE_WORD =
  /(разработчи|программист|инженер|архитектор|аналитик|тестировщик|developer|engineer|architect|analyst|\bqa\b|devops|\bsre\b|тимлид|team\s?lead|tech\s?lead|техлид|руководител|data\s?scientist|\bml\b|дизайнер|designer|менеджер|manager|стаж[её]р|intern|backend|frontend|fullstack|full-stack|бэкенд|фронтенд)/iu;
const YEAR_RANGE =
  /((?:19|20)\d{2})\s*[––-]\s*((?:19|20)\d{2}|н\.\s?в\.|наст(?:оящее)?(?:\s*время)?|по\s+наст[а-я.]*(?:\s*время)?|сейчас|present|now|current)/giu;

/** Софт-скиллы – фиксированный словарь: наружу уходит только метка словаря, а не текст кандидата. */
export const SOFT_SKILLS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'Наставничество', re: /наставни|ментор|mentor|онбординг\s+(?:новичк|стаж|джун)|обучал[аи]?\s+(?:новичк|стаж|джун|коллег)/iu },
  { label: 'Код-ревью и обратная связь', re: /ревью|code\s?review/iu },
  { label: 'Командная работа', re: /в\s+команд|командн|кросс-?функциональн|team\s?work|teamwork/iu },
  { label: 'Лидерство', re: /тимлид|team\s?lead|tech\s?lead|техлид|руководил|возглавля|вел[аи]?\s+команд|вёл\s+команд|лидер/iu },
  { label: 'Коммуникация с заказчиком', re: /коммуникаб|коммуникац|переговор|заказчик|стейкхолдер|stakeholder|с\s+бизнесом/iu },
  { label: 'Публичные выступления', re: /выступ(?:ал|аю|ление|ления)|доклад|спикер|митап|meetup|конференц/iu },
  { label: 'Документирование', re: /документац|\badr\b|confluence|чек-?лист/iu },
  { label: 'Планирование и декомпозиция', re: /планирова|декомпози|оценк[аиу]\s+(?:задач|срок)|scrum|спринт/iu },
  { label: 'Самостоятельность и обучаемость', re: /самостоятельн|обучаем|быстро\s+учусь|самообразован/iu },
];

const visible = (doc: ExtractedDoc): DocLine[] => doc.lines.filter((l) => !l.hidden && l.text.trim());
const strip = (s: string) => s.replace(/^[#>*\-•\s]+/, '').trim();

/** «Дмитрий Рябинин – Backend…» / «ФИО: Иванов Иван Иванович» → имя; 2–3 слова с заглавной. */
function nameFrom(lines: DocLine[]): ParsedResumeField | null {
  const candidates = [
    ...lines.flatMap((l) => {
      const m = /^(?:фио|имя)\s*[:–-]\s*(.+)$/iu.exec(strip(l.text));
      return m ? [{ l, part: m[1] as string }] : [];
    }),
    ...lines.slice(0, 3).map((l) => ({ l, part: strip(l.text).split(/\s+[––|-]\s+|,|\s·\s/u)[0] ?? '' })),
  ];
  for (const { l, part } of candidates) {
    const words = part.replace(/^Демо:\s*/u, '').trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 3 && words.every((w) => NAME_WORD.test(w))) {
      return { key: 'name', value: words.join(' '), quote: l.text, sourceRef: l.ref };
    }
  }
  return null;
}

/** Первый контакт (почта или Telegram) из исходных, немаскированных строк. Телефон в Candidate.contact не принимается. */
function contactFrom(raw: RawContactLine[]): ParsedResumeField | null {
  for (const l of raw) {
    const tokens = [
      ...(l.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []),
      ...(l.text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[A-Za-z0-9_]{5,32}/gi) ?? []),
      ...(l.text.match(/(?:telegram|телеграм|tg|тг)\s*[:–-]?\s*@[A-Za-z0-9_]{5,32}/giu)?.map((t) => t.slice(t.indexOf('@'))) ?? []),
    ];
    for (const t of tokens) {
      const c = normalizeContact(t);
      if (c) return { key: 'contact', value: c, quote: l.text, sourceRef: l.ref };
    }
  }
  return null;
}

const WORD_NUM: Record<string, number> = { один: 1, одного: 1, два: 2, двух: 2, три: 3, трёх: 3, трех: 3, четыре: 4, четырёх: 4, пять: 5, пяти: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };

function explicitYears(text: string): number | null {
  const t = text.toLowerCase();
  if (!/(опыт|стаж|работаю|пишу|занимаюсь|делаю|разрабатываю|в\s+профессии|в\s+it|experience)/u.test(t)) return null;
  const num = /(\d{1,2})(?:[.,]\d)?\s*\+?\s*(?:год|года|лет|years?)(?![а-яёa-z])/u.exec(t);
  if (num) return Number(num[1]);
  const word = /(один|одного|два|двух|три|тр[её]х|четыре|четыр[её]х|пять|пяти|шесть|семь|восемь|девять|десять)\s+(?:год|года|лет)/u.exec(t);
  if (word) return WORD_NUM[word[1] as string] ?? null;
  if (/полтора\s+года|(?:^|\s)год\s+(?:делаю|пишу|работаю|занимаюсь)|опыт[а-я]*\s+(?:около\s+)?года/u.test(t)) return 1;
  return null;
}

/** Стаж: явная фраза («опыт 5 лет», «полтора года пишу») или объединение периодов «2020 – 2022». */
function experienceFrom(lines: DocLine[], now: Date): ParsedResumeField | null {
  for (const l of lines) {
    const y = explicitYears(l.text);
    if (y !== null && y >= 0 && y <= 50) return { key: 'experienceYears', value: y, quote: l.text, sourceRef: l.ref };
  }
  const nowYear = now.getFullYear();
  const covered = new Set<number>();
  let first: DocLine | null = null;
  for (const l of lines) {
    for (const m of l.text.matchAll(YEAR_RANGE)) {
      const from = Number(m[1]);
      const to = /^\d{4}$/.test(m[2] as string) ? Number(m[2]) : nowYear;
      if (from > to || from < 1970 || to > nowYear + 1) continue;
      for (let y = from; y < Math.max(to, from + 1); y++) covered.add(y);
      first ??= l;
    }
  }
  if (!first || covered.size === 0) return null;
  return { key: 'experienceYears', value: covered.size, quote: first.text, sourceRef: first.ref };
}

/**
 * Роль без компании и периода: убираем «кавычки» с названием, скобки, « в …»/« at …», контакты.
 * null – в остатке нет слова должности. Используется и для того, что кандидат ввёл сам (employer/privacy).
 */
export function cleanRole(raw: string): string | null {
  let s = raw
    .replace(/«[^»]*»|"[^"]*"|“[^”]*”/gu, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(YEAR_RANGE, ' ')
    .replace(/\s+(?:в|во|at|@)\s+.*$/iu, '');
  s = maskContacts(s).text.replace(/\[скрыто\]/g, ' ');
  s = s.replace(/[|·]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:––-]+|[\s,;:––-]+$/gu, '').trim();
  if (!s || s.length > 60 || !ROLE_WORD.test(s)) return null;
  return s;
}

function rolesFrom(lines: DocLine[]): ParsedResumeField | null {
  const out: string[] = [];
  const quotes: DocLine[] = [];
  const push = (role: string | null, l: DocLine) => {
    if (!role || out.some((r) => r.toLowerCase() === role.toLowerCase()) || out.length >= 5) return;
    out.push(role);
    if (!quotes.includes(l)) quotes.push(l);
  };
  for (const l of lines) {
    if (!l.text.match(YEAR_RANGE)) continue;
    const body = strip(l.text).replace(/\([^)]*\)/g, ' ').replace(YEAR_RANGE, ' ');
    for (const seg of body.split(/,|\s[––|]\s/u)) push(cleanRole(seg), l);
  }
  // Заголовок резюме «Имя – Должность, грейд», если периодов с должностями нет.
  if (out.length === 0) {
    for (const l of lines.slice(0, 3)) {
      const parts = strip(l.text).split(/\s+[––|]\s+/u);
      for (const seg of parts.slice(1).flatMap((p) => p.split(/,|\s·\s/u))) push(cleanRole(seg), l);
    }
  }
  if (out.length === 0) return null;
  return { key: 'roles', value: out, quote: quotes.map((q) => q.text).join('\n'), sourceRef: quotes.map((q) => q.ref).join(',') };
}

function softSkillsFrom(lines: DocLine[]): ParsedResumeField | null {
  const out: string[] = [];
  const quotes: DocLine[] = [];
  for (const s of SOFT_SKILLS) {
    const l = lines.find((x) => s.re.test(x.text));
    if (!l) continue;
    out.push(s.label);
    if (!quotes.includes(l)) quotes.push(l);
  }
  if (out.length === 0) return null;
  return { key: 'softSkills', value: out, quote: quotes.map((q) => q.text).join('\n'), sourceRef: quotes.map((q) => q.ref).join(',') };
}

/** Все распознанные поля резюме. rawContacts – немаскированные строки с контактами (только при свежей загрузке). */
export function parseResumeFields(doc: ExtractedDoc, rawContacts: RawContactLine[] = [], now = new Date()): ParsedResumeField[] {
  const lines = visible(doc);
  return [nameFrom(lines), contactFrom(rawContacts), experienceFrom(lines, now), rolesFrom(lines), softSkillsFrom(lines)].filter(
    (f): f is ParsedResumeField => f !== null,
  );
}

/** Текст (сид, демо-резюме в markdown) → строки документа с ref `<file>#L<n>`; контакты берутся из этих же строк. */
export function parseResumeText(text: string, fileName: string, now = new Date()): ParsedResumeField[] {
  const lines = text.split('\n').map((t, i) => ({ ref: `${fileName}#L${i + 1}`, text: t.trim() })).filter((l) => l.text);
  const doc: ExtractedDoc = { sourceKind: 'resume', title: fileName, origin: fileName, lines, text, flags: {}, fetchedAt: now.toISOString() };
  return parseResumeFields(doc, lines, now);
}
