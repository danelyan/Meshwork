import type { CodeFragment, RepoFile } from './types';

/**
 * Фрагменты кода для вопросов: функции, методы, небольшие классы. Выделяет код (регулярки и
 * баланс скобок/отступов), не модель: модель выбирает из готового списка по id, поэтому не может
 * спросить о коде, которого в репозитории нет.
 */

export const FRAGMENT_LIMITS = { maxLines: 60, minLines: 3, maxFragments: 24 } as const;

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'elif', 'new', 'await', 'typeof']);

interface Start {
  line: number;
  name: string;
  kind: 'function' | 'class';
}

const PATTERNS: { re: RegExp; kind: Start['kind']; group: number }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/, kind: 'function', group: 1 },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/, kind: 'function', group: 1 },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', group: 1 },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, kind: 'function', group: 1 },
  { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[[(]/, kind: 'function', group: 1 },
  // Методы классов (TS/JS/Java/Kotlin/C#): `name(...) {` с модификаторами.
  {
    re: /^\s+(?:(?:public|private|protected|static|async|override|readonly|final|virtual|suspend|fun)\s+)*(?:[\w<>[\],\s]+\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::\s*[^{;]+)?\{\s*$/,
    kind: 'function',
    group: 1,
  },
];

const BRANCH_RE = /\b(if|for|while|catch|case|switch|elif|except|try|select|defer|go)\b|&&|\|\||\?\?|\?\s/g;

function findStarts(lines: string[]): Start[] {
  const out: Start[] = [];
  lines.forEach((text, line) => {
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      const name = m?.[p.group];
      if (name && !KEYWORDS.has(name)) {
        out.push({ line, name, kind: p.kind });
        break;
      }
    }
  });
  return out;
}

/** Конец блока: баланс фигурных скобок (C-подобные) или отступ (Python). Не нашли — null. */
function blockEnd(lines: string[], start: number, python: boolean): number | null {
  if (python) {
    const indent = (lines[start] ?? '').search(/\S/);
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l.trim() === '') continue;
      if (l.search(/\S/) <= indent) break;
      end = i;
    }
    return end > start ? end : null;
  }
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length && i < start + 400; i++) {
    const l = (lines[i] ?? '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');
    for (const ch of l) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i;
    // Стрелочная функция без фигурных скобок в одну строку.
    if (!opened && i === start && /=>\s*[^{\s]/.test(l) && /;\s*$/.test(l)) return i;
  }
  return null;
}

export function extractFragments(files: RepoFile[]): CodeFragment[] {
  const all: CodeFragment[] = [];
  for (const f of files) {
    const lines = f.content.split('\n');
    const python = /\.py$/i.test(f.path);
    for (const s of findStarts(lines)) {
      const end = blockEnd(lines, s.line, python);
      if (end === null) continue;
      const len = end - s.line + 1;
      if (len < FRAGMENT_LIMITS.minLines) continue;
      if (len > FRAGMENT_LIMITS.maxLines && s.kind === 'class') continue;
      const last = Math.min(end, s.line + FRAGMENT_LIMITS.maxLines - 1);
      const code = lines.slice(s.line, last + 1).join('\n');
      all.push({
        id: '',
        path: f.path,
        name: s.name,
        startLine: s.line + 1,
        endLine: last + 1,
        code,
        complexity: (code.match(BRANCH_RE) ?? []).length,
      });
    }
  }
  // Больше ветвлений и строк — больше, о чём спросить; при равенстве — по пути и строке (детерминизм).
  const ranked = all
    .filter((x) => x.complexity > 0 || x.endLine - x.startLine >= 6)
    .sort(
      (a, b) =>
        b.complexity * 3 + (b.endLine - b.startLine) - (a.complexity * 3 + (a.endLine - a.startLine)) ||
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine,
    )
    .slice(0, FRAGMENT_LIMITS.maxFragments);
  return ranked.map((x, i) => ({ ...x, id: `F${i + 1}` }));
}

export function fragmentRef(f: Pick<CodeFragment, 'path' | 'startLine' | 'endLine'>): string {
  return `${f.path}:L${f.startLine}-L${f.endLine}`;
}
