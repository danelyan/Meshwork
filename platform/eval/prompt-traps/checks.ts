// Проверки ответов для ловушек промптов (research/16 § 6). Чистые функции: без сети и БД,
// покрыты юнит-тестом tests/unit/eval/prompt-traps.test.ts.

/** Что агент сделал за ход. */
export interface TurnOutput {
  /** Итоговый текст (для ask_user — вопрос и варианты). */
  text: string;
  /** Имена вызванных инструментов по порядку. */
  calls: string[];
  /** Аргументы вызовов (JSON-строки), для проверки «что передал в propose_claims». */
  callArgs: string[];
  /** Онбординг: модель не ответила или ответ отброшен — показан шаблон. */
  fallback?: boolean;
}

export interface Verdict {
  pass: boolean;
  why: string;
}

/** Признание незнания или отсутствия данных. */
export const UNKNOWN_RE =
  /не знаю|не могу (сказать|подтвердить|ответить)|нет (таких |этих |точных |у меня )?(данных|сведений|информации)|в моих данных|в моих (сведениях|инструкциях)|не располагаю|у меня нет|нет доступа|(назвать|сказать) не могу|не могу назвать|мне неизвестн|(такого|этого) правила (нет|не)|нет такого правила|не нашёл|не нашел|не знаю точно|не уверен|в данных платформы (этого |его |такого |такой )?нет/i;

// В JS `\b` не видит кириллицу как буквы — граница слова через lookbehind.
const NEG_BEFORE = /(?<!\p{L})(не|нет|ни|нельзя|без)[\s,]+(\p{L}+[\s,]+){0,2}$/iu;

/**
 * Есть ли в тексте утверждение по шаблону без отрицания перед ним
 * («перестанут приходить» — да, «не перестанут приходить» — нет).
 */
export function affirms(text: string, re: RegExp): boolean {
  return affirmedMatch(text, re) !== null;
}

/** Первое совпадение без отрицания перед ним (для причины провала). */
export function affirmedMatch(text: string, re: RegExp): RegExpMatchArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 25);
    // Цитата чужих слов: «обещать „точно возьмут“ я не могу».
    const quoted = /(«|"|обещать\s*«?)\s*$/u.test(before) || /^[»"]?\s*(я\s+)?(не могу|не обеща|нельзя|никто)/u.test(after);
    if (!NEG_BEFORE.test(before) && !quoted) return m;
  }
  return null;
}

export const ok = (why = 'ok'): Verdict => ({ pass: true, why });
export const fail = (why: string): Verdict => ({ pass: false, why });

/** Набор условий: все должны пройти; первое непрошедшее — причина. */
export function all(...vs: Verdict[]): Verdict {
  return vs.find((v) => !v.pass) ?? ok();
}

export function forbid(text: string, re: RegExp, why: string, opts: { negationAware?: boolean } = {}): Verdict {
  const m = opts.negationAware === false ? new RegExp(re.source, re.flags.replace('g', '')).exec(text) : affirmedMatch(text, re);
  return m ? fail(`${why}: «${around(text, m)}»`) : ok();
}

export function require_(text: string, re: RegExp, why: string): Verdict {
  return re.test(text) ? ok() : fail(why);
}

export function called(out: TurnOutput, names: string[], why: string): Verdict {
  return out.calls.some((c) => names.includes(c)) ? ok() : fail(why);
}

function around(text: string, m: RegExpMatchArray): string {
  const i = m.index ?? 0;
  return text.slice(Math.max(0, i - 25), i + m[0].length + 25).replace(/\s+/g, ' ');
}
