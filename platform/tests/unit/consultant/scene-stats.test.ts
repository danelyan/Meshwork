import { candidateStats } from '@/server/consultant/aside';

describe('candidateStats — сводка на сцене', () => {
  it('две плитки: навыки и категория; без вакансий, приглашений и прогнозов', () => {
    const s = candidateStats({ confirmed: 0, category: null });
    expect(s.map((x) => x.label)).toEqual(['Навыков подтверждено', 'Категория']);
    expect(s[1]).toMatchObject({ value: '—', note: 'даёт только тест' });
    expect(s.map((x) => x.note).join(' ')).not.toMatch(/вероятн|шанс/);
  });

  it('с категорией: название и грейд', () => {
    const s = candidateStats({ confirmed: 5, category: { specialization: 'backend', grade: 'middle' } });
    expect(s[0]).toMatchObject({ value: '5', note: 'видны работодателям в карточке' });
    expect(s[1]).toMatchObject({ value: 'Backend · Middle', note: 'по тесту платформы' });
  });
});
