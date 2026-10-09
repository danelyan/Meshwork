// Сборка системных промптов из .md (источник правды) и общего файла фактов о платформе.
// Используется генератором scripts/build-prompts.ts и тестами; в рантайме .md не читаются
// (в standalone-сборке Next.js их нет) — рантайм берёт сгенерированные prompt.ts.

/** Место, куда подставляются факты из platform-facts.md. */
export const FACTS_PLACEHOLDER = '{{platform_facts}}';

/** Комментарии `<!-- … -->` (версия, ссылки на код) в промпт не идут. */
export function stripComments(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->[ \t]*\n?/g, '');
}

/** Версия из первой строки `<!-- version: consultant-v4 -->`. */
export function promptVersion(md: string): string {
  const m = /^<!--\s*version:\s*([\w.-]+)\s*-->/.exec(md);
  if (!m) throw new Error('prompt: нет строки <!-- version: … --> в начале .md');
  return m[1]!;
}

/** Блок фактов, как он попадает в промпт. */
export function factsBlock(factsMd: string): string {
  return stripComments(factsMd).trim();
}

/**
 * Только выбранные факты: вводная строка блока и пункты F<n> из списка, без заголовков разделов.
 * Нужен короткому промпту (реплики онбординга укладываются в таймаут 6 с).
 */
export function factsSubset(factsMd: string, ids: string[]): string {
  const lines = factsBlock(factsMd).split('\n');
  const intro = lines[1] ?? '';
  const picked = ids.map((id) => {
    const line = lines.find((l) => l.startsWith(`${id}. `));
    if (!line) throw new Error(`prompt: факта ${id} нет в platform-facts.md`);
    return line;
  });
  return ['<platform_facts>', intro, '', ...picked, '</platform_facts>'].join('\n');
}

const SUBSET_RE = /\{\{platform_facts:([F\d,\s]+)\}\}/g;

/**
 * Промпт = .md без комментариев, с фактами вместо плейсхолдера (ровно один раз):
 * `{{platform_facts}}` — весь блок, `{{platform_facts:F1,F4}}` — только эти пункты.
 */
export function assemblePrompt(md: string, factsMd: string): string {
  const body = stripComments(md);
  const subsets = [...body.matchAll(SUBSET_RE)];
  const full = body.split(FACTS_PLACEHOLDER).length - 1;
  if (full + subsets.length !== 1) throw new Error(`prompt: плейсхолдер ${FACTS_PLACEHOLDER} должен встречаться ровно один раз`);
  if (full) return body.replace(FACTS_PLACEHOLDER, () => factsBlock(factsMd));
  const ids = subsets[0]![1]!.split(',').map((x) => x.trim()).filter(Boolean);
  return body.replace(SUBSET_RE, () => factsSubset(factsMd, ids));
}
