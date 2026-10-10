import { checkPlatformOwned, countTests, getTemplates, ownedFileHashes, PLATFORM_OWNED_MARKER, readStarter, readTree, visibleTestNames } from '@/server/project/templates';

describe('шаблоны проектов на диске', () => {
  const all = getTemplates();

  it('семь шаблонов к сдаче (research/25 § 4) с валидным манифестом', () => {
    expect(all.map((t) => `${t.manifest.subcategoryId}/${t.manifest.grade}/${t.manifest.id}`)).toEqual([
      'ai.llm-apps/middle/ai-llmapps-middle-rag',
      'backend.integrations/middle/be-integrations-middle-delivery',
      'backend.web-api/junior/be-webapi-junior-booking',
      'backend.web-api/middle/be-webapi-middle-orders',
      'engineering.data-eng/junior/eng-dataeng-junior-etl',
      'frontend.ui-app/junior/fe-uiapp-junior-catalog',
      'frontend.ui-app/middle/fe-uiapp-middle-tasks',
    ]);
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

  it('файлы с маркером — под контролем, код кандидата — нет', () => {
    expect([...expected.keys()]).toEqual(['contract.md', 'tests/visible/a.test.ts']);
  });

  it('без правок (и с CRLF) — чисто; изменён или удалён — нарушение', () => {
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
