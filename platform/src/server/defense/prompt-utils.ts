import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Промпты лежат в `src/server/defense/prompts/*.md` и читаются с диска от
 * process.cwd() (docs Next.js: читать файлы через process.cwd(), не __dirname).
 * Для `output: 'standalone'` интегратору нужно добавить их в трассировку:
 * `outputFileTracingIncludes: { '/api/defense/**': ['./src/server/defense/prompts/**'] }`.
 */
const cache = new Map<string, string>();

export function loadPrompt(name: 'interviewer' | 'evaluator'): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const file = path.join(process.cwd(), 'src/server/defense/prompts', `${name}.md`);
  const text = readFileSync(file, 'utf8');
  cache.set(name, text);
  return text;
}

/**
 * Текст как данные внутри XML-подобного тега: экранируем `<`, `>` и `&`, чтобы
 * ответ кандидата не мог закрыть `</candidate_answer>` и открыть свой блок.
 */
export function escapeData(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function tag(name: string, text: string): string {
  return `<${name}>${escapeData(text)}</${name}>`;
}

/** Схлопнуть пробелы — для сравнения цитат (переносы строк в JSON модели). */
export function normalizeWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
