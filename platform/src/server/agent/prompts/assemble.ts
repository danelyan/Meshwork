// Сборка системных промптов из .md (источник правды) и общего файла фактов о платформе.
// Используется генератором scripts/build-prompts.ts и тестами; в рантайме .md не читаются
// (в standalone-сборке Next.js их нет) — рантайм берёт сгенерированные prompt.ts.

/** Место, куда подставляются факты из platform-facts.md. */
export const FACTS_PLACEHOLDER = '{{platform_facts}}';

/** Комментарии `<!-- … -->` (версия, ссылки на код) в промпт не идут. */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->[ \t]*\n?/g, '');
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

/** Промпт = .md без комментариев, с фактами вместо плейсхолдера (ровно один раз). */
export function assemblePrompt(md: string, factsMd: string): string {
  const body = stripComments(md);
  const parts = body.split(FACTS_PLACEHOLDER);
  if (parts.length !== 2) throw new Error(`prompt: плейсхолдер ${FACTS_PLACEHOLDER} должен встречаться ровно один раз`);
  return parts.join(factsBlock(factsMd));
}
