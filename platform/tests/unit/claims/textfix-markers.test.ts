import { readFileSync } from 'node:fs';

import { catalogFromFile } from '@/server/claims';
import { extractByMarkers } from '@/server/claims/markers';
import type { ExtractedDoc } from '@/server/collector/types';

const PRE = ['Иван Иванов', 'Backend-разработчик', 'Опыт работы', 'Компания X'];
const docOf = (...body: string[]): ExtractedDoc => {
  const texts = [...PRE, ...body];
  return   ({ sourceKind: 'resume', origin: 'cv.pdf', title: 'cv', text: texts.join('\n'), lines: texts.map((text, i) => ({ ref: `cv.pdf#p1:l${i + 1}`, text })), flags: {} }) as unknown as ExtractedDoc;
};

describe('маркеры: слово технологии само по себе не умение', () => {
  const catalog = catalogFromFile();
  const ids = (d: ExtractedDoc) => extractByMarkers(d, catalog).map((c) => c.catalogId);

  it('PostgreSQL в строке про ограничение не даёт common.sql-queries', () => {
    expect(ids(docOf('Добавил уникальное ограничение в PostgreSQL, двойные списания при ретраях прекратились'))).not.toContain('common.sql-queries');
  });
  it('«ревью pull request» не даёт common.git', () => {
    expect(ids(docOf("Провёл около 150 ревью pull request'ов"))).not.toContain('common.git');
  });
  it('настоящее упоминание SQL/JOIN по-прежнему находится', () => {
    expect(ids(docOf('Писал SQL-запросы с JOIN и GROUP BY для отчётов'))).toContain('common.sql-queries');
  });
  it('сид без двойного префикса limits', () => {
    expect(readFileSync('prisma/seed/claims-catalog.json', 'utf8')).not.toMatch(/"limits": "Не доказывает/);
  });
});
