import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import baseline from './font-size-baseline.json';

// Страж: размеры шрифтов в модулях - только через `var(--fs-*)` (docs/design-system.md §3, §9).
// Ищем сырые `px` в `font-size:` и в shorthand `font:` (число после `/` - line-height, не считается).
// Пропускаем: лендинг и /design (hero, свои размеры) и строки с пометкой `fs-ok: <причина>`.
// «Храповик»: font-size-baseline.json - число нарушений по файлам на сегодня. Растёт - тест падает,
// падает - тест просит обновить базу. Строгие зоны (STRICT) - всегда 0, базы для них нет.
const SRC = join(__dirname, '../../src');
const DECL = /(?<![\w-])(?:font-size|font)\s*:\s*([^;}]*)/g;
const PX = /(?<![\w./-])\d*\.?\d+px/;
const EXEMPT = [/^components\/landing\//, /^app\/design\//];
const STRICT = [
  'components/consultant/',
  'components/shell/',
  'components/chat/',
  'components/onboarding/',
  'components/avatar/AvatarScene.module.css',
  'components/ui/',
  'components/ui.module.css',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.module.css') ? [p] : [];
  });
}

function rawSizes(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => !l.includes('fs-ok:'))
    .flatMap((l) => [...l.matchAll(DECL)].filter((m) => PX.test(m[1] ?? '')).map(() => l.trim()));
}

const base = baseline as Record<string, number>;
const files = walk(SRC)
  .map((p) => relative(SRC, p).split(sep).join('/'))
  .filter((f) => !EXEMPT.some((re) => re.test(f)));
const strict = (f: string) => STRICT.some((s) => f.startsWith(s));

describe('размеры шрифтов в CSS-модулях только через токены', () => {
  it('модули найдены', () => expect(files.length).toBeGreaterThan(5));

  for (const f of files) {
    it(f, () => {
      const bad = rawSizes(readFileSync(join(SRC, f), 'utf8'));
      const allowed = strict(f) ? 0 : (base[f] ?? 0);
      expect(
        bad.length,
        `сырые px в шрифтах (${bad.length}), допустимо ${allowed}. Используй var(--fs-*) или комментарий fs-ok: причина:\n${bad.join('\n')}`,
      ).toBeLessThanOrEqual(allowed);
      expect(bad.length, `нарушений стало меньше (${bad.length} < ${allowed}): обнови tests/unit/font-size-baseline.json`).toBeGreaterThanOrEqual(allowed);
    });
  }

  it('база не содержит исчезнувших файлов, строгих зон и нулей', () => {
    for (const [f, n] of Object.entries(base)) {
      expect(files, f).toContain(f);
      expect(strict(f), `${f}: строгая зона, базы быть не должно`).toBe(false);
      expect(n, `${f}: ноль в базе не нужен`).toBeGreaterThan(0);
    }
  });
});
