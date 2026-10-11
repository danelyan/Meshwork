import { describe, expect, it } from 'vitest';

import { feminize, PERSONA_RESUMES, resumeLine } from '../../../prisma/seed/resumes';
import type { DemoProfile } from '../../../prisma/seed/employer';

describe('резюме демо-кандидатов', () => {
  it('строки вручную написанных резюме входят в их текст', () => {
    for (const [id, r] of Object.entries(PERSONA_RESUMES)) {
      expect(r.fileName).toBe(`${id}-resume.md`);
      for (const line of Object.values(r.lines)) expect(r.text).toContain(line);
    }
  });

  it('женский род: глаголы меняются, существительные нет', () => {
    expect(feminize('Проектировал и разбирал A/B-тест: доверительный интервал, журнал')).toBe('Проектировала и разбирала A/B-тест: доверительный интервал, журнал');
  });

  it('мужское имя оставляет формулировку каталога', () => {
    const p = { id: 'x', name: 'Демо: Никита Захаров', claims: [], stack: [] } as unknown as DemoProfile;
    expect(resumeLine(p, 'Писал серверный код')).toBe('Писал серверный код.');
  });
});
