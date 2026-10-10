import { candidateStats } from '@/server/consultant/aside';

describe('candidateStats — сводка на сцене', () => {
  it('без категории: прочерк и подсказка, что её даёт только тест; без прогнозов приглашений', () => {
    const s = candidateStats({ confirmed: 0, category: null, vacancies: 22, mine: 0, invitations: 0 });
    expect(s.map((x) => x.label)).toEqual(['Навыков подтверждено', 'Категория', 'Вакансий на платформе', 'Приглашений']);
    expect(s[1]).toMatchObject({ value: '—', note: 'даёт только тест' });
    expect(s[2]).toMatchObject({ value: '22', note: 'по всем направлениям' });
    expect(s.map((x) => x.note).join(' ')).not.toMatch(/вероятн|шанс/);
  });

  it('с категорией: название и грейд, вакансии в своей категории', () => {
    const s = candidateStats({ confirmed: 5, category: { specialization: 'backend', grade: 'middle' }, vacancies: 22, mine: 2, invitations: 1 });
    expect(s[0]).toMatchObject({ value: '5', note: 'видны работодателям в карточке' });
    expect(s[1]).toMatchObject({ value: 'Backend · Middle' });
    expect(s[2]?.note).toBe('в твоей категории: 2');
    expect(s[3]).toMatchObject({ value: '1', note: 'в разделе «Приглашения»' });
  });
});
