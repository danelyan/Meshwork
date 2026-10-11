import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Страж: цвета в модулях - только через токены (docs/design-system.md, «Запреты»).
// Сырые #hex и rgb()/rgba()/hsl() разрешены в styles/tokens.css, в строках с пометкой `raw-ok`
// и в файлах allowlist ниже (долг экранов: «к переводу» в design-system.md). Список можно только сокращать.
const SRC = join(__dirname, '../../src');
const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

const ALLOWLIST: Record<string, number> = {
  'components/ClaimCard.module.css': 1,
  'components/DefenseDialog.module.css': 3,
  'components/ProfilePage.module.css': 3,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.module.css') ? [p] : [];
  });
}

describe('цвета в CSS-модулях только через токены', () => {
  const files = walk(SRC).map((p) => relative(SRC, p).split(sep).join('/'));
  it('модули найдены', () => expect(files.length).toBeGreaterThan(5));

  for (const f of files) {
    it(f, () => {
      const bad = readFileSync(join(SRC, f), 'utf8')
        .split('\n')
        .filter((l) => RAW.test(l) && !l.includes('raw-ok'));
      const allowed = ALLOWLIST[f] ?? 0;
      expect(bad.length, `сырые цвета (${bad.length}), допустимо ${allowed}:\n${bad.join('\n')}`).toBeLessThanOrEqual(allowed);
    });
  }

  it('allowlist не содержит исчезнувших или очищенных файлов', () => {
    for (const f of Object.keys(ALLOWLIST)) expect(files).toContain(f);
  });
});
