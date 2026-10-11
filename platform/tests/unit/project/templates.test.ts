import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkPlatformOwned, countTests, getTemplates, ownedFileHashes, PLATFORM_OWNED_MARKER, readContract, readStarter, readTree, visibleTestNames } from '@/server/project/templates';

describe('шаблоны проектов на диске', () => {
  const all = getTemplates();

  it('id шаблонов уникальны и по конвенции <спец>-<подкат>-<грейд>-<тема>, грейд в id совпадает с манифестом', () => {
    const ids = all.map((t) => t.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of all) {
      expect(t.manifest.id).toMatch(/^(ai|be|fe|eng)-[a-z]+-(junior|middle|senior)-[a-z0-9-]+$/);
      expect(t.manifest.id.split('-')[2], t.manifest.id).toBe(t.manifest.grade);
    }
  });

  it('исходные четырнадцать шаблонов на месте', () => {
    expect(all.map((t) => `${t.manifest.subcategoryId}/${t.manifest.grade}/${t.manifest.id}`)).toEqual(expect.arrayContaining([
      'ai.llm-apps/middle/ai-llmapps-middle-rag',
      'ai.llm-apps/senior/ai-llmapps-senior-gateway',
      'backend.integrations/middle/be-integrations-middle-delivery',
      'backend.integrations/senior/be-integrations-senior-outbox',
      'backend.web-api/junior/be-webapi-junior-booking',
      'backend.web-api/junior/be-webapi-junior-notes',
      'backend.web-api/middle/be-webapi-middle-orders',
      'backend.web-api/senior/be-webapi-senior-ratelimit',
      'engineering.data-eng/junior/eng-dataeng-junior-etl',
      'engineering.data-eng/senior/eng-dataeng-senior-incremental',
      'frontend.ui-app/junior/fe-uiapp-junior-catalog',
      'frontend.ui-app/junior/fe-uiapp-junior-widget',
      'frontend.ui-app/middle/fe-uiapp-middle-tasks',
      'frontend.ui-app/senior/fe-uiapp-senior-search',
    ]));
  });

  it('Senior: бюджет 6–8 ч, контракт требует DESIGN.md с компромиссами', () => {
    for (const t of all.filter((x) => x.manifest.grade === 'senior')) {
      expect(t.manifest.timeBudgetMin, t.manifest.id).toBeGreaterThanOrEqual(360);
      expect(t.manifest.timeBudgetMin, t.manifest.id).toBeLessThanOrEqual(480);
      expect(readContract(t), t.manifest.id).toMatch(/DESIGN\.md[\s\S]*## Компромиссы/);
    }
  });

  it('catalogIds – реальные id каталога навыков', () => {
    const raw = readFileSync(path.resolve(__dirname, '../../../prisma/seed/claims-catalog.json'), 'utf8');
    const known = new Set([...raw.matchAll(/"id":\s*"([a-z]+\.[a-z0-9.-]+)"/g)].map((m) => m[1]));
    for (const t of all) for (const id of t.manifest.catalogIds) expect(known.has(id), `${t.manifest.id}: ${id}`).toBe(true);
  });

  it.each(all.map((t) => [t.manifest.id, t] as const))('%s: тесты помечены PLATFORM-OWNED, скрытых больше видимых, заготовка без скрытого и эталона', (_id, t) => {
    const tests = [...readTree(`${t.dir}/${t.manifest.hiddenTestsRef}`), ...readTree(`${t.dir}/${t.manifest.visibleTestsRef}`)];
    for (const f of tests) expect(f.content.split('\n', 2).join('\n'), f.path).toContain(PLATFORM_OWNED_MARKER);
    expect(countTests(t, 'hidden')).toBeGreaterThan(countTests(t, 'visible'));
    expect(visibleTestNames(t)).toHaveLength(countTests(t, 'visible'));
    const starter = readStarter(t);
    expect(starter.map((f) => f.path)).toContain('contract.md');
    expect(starter.some((f) => /hidden|reference/i.test(f.path))).toBe(false);
    // видимые тесты в заготовке совпадают с выдаваемыми платформой
    for (const v of readTree(`${t.dir}/${t.manifest.visibleTestsRef}`)) expect(starter.find((f) => f.path === `tests/visible/${v.path}`)?.content).toBe(v.content);
  });
});

describe('PLATFORM-OWNED: сверка файлов платформы в репозитории кандидата', () => {
  const files = [
    { path: 'contract.md', content: '<!-- PLATFORM-OWNED -->\n# Контракт' },
    { path: 'tests/visible/a.test.ts', content: '// PLATFORM-OWNED: тест\nit()' },
    { path: 'src/app.ts', content: 'export {}' },
  ];
  const expected = ownedFileHashes(files);
  const enc = (s: string) => new TextEncoder().encode(s);

  it('файлы с маркером – под контролем, код кандидата – нет', () => {
    expect([...expected.keys()]).toEqual(['contract.md', 'tests/visible/a.test.ts']);
  });

  it('без правок (и с CRLF) – чисто; изменён или удалён – нарушение', () => {
    const same = new Map([
      ['contract.md', enc('<!-- PLATFORM-OWNED -->\r\n# Контракт')],
      ['tests/visible/a.test.ts', enc('// PLATFORM-OWNED: тест\nit()')],
    ]);
    expect(checkPlatformOwned(expected, same)).toEqual([]);
    const tampered = new Map([['contract.md', enc('<!-- PLATFORM-OWNED -->\n# Контракт попроще')]]);
    expect(checkPlatformOwned(expected, tampered)).toEqual([
      { path: 'contract.md', reason: 'modified' },
      { path: 'tests/visible/a.test.ts', reason: 'missing' },
    ]);
  });
});
