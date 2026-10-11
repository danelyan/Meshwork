import type { PrismaClient } from '@prisma/client';

import { catalogFromFile } from '../../src/server/claims/catalog-file';

/**
 * Утверждения базовых демо-кандидатов demo-frontend-mid и demo-injection (у demo-backend-strong
 * они приходят из разбора резюме). Без них call-gate (src/server/call/readiness.ts) держит
 * квалифицирующий созвон закрытым. Набор строго по резюме eval/demo/demo-2 и demo-3: уровень
 * self_reported, статус proposed (кандидат подтверждает сам); пробелы из expected.json
 * (fe.component-tests, fe.ts-typing) и «знаю названия» из резюме demo-3 не включены, вне резюме
 * (в т.ч. из скрытого текста) ничего нет. Утверждения создаются, только если у кандидата их ещё
 * нет: повторный сид не затирает то, что появилось при работе на стенде. Все люди вымышлены.
 */
export const DEMO_RESUME_CLAIMS: Record<string, { file: string; claims: Record<string, string> }> = {
  // Цитата — дословная строка резюме; утверждение без опоры в тексте (только «Git» в списке навыков) не заводим.
  'demo-frontend-mid': {
    file: 'demo-2.pdf',
    claims: {
      'fe.components': 'Собирала интерфейсы на React из переиспользуемых компонентов: карточки, списки, модальные окна.',
      'fe.forms': 'Формы заявки с проверкой полей и показом ошибок.',
      'fe.api-client': 'Получала данные с API через fetch, показывала состояния загрузки и ошибки.',
      'fe.responsive': 'Адаптивная вёрстка mobile-first на Flex и Grid.',
      'fe.css-layout': 'Адаптивная вёрстка mobile-first на Flex и Grid.',
    },
  },
  'demo-injection': {
    file: 'demo-3.pdf',
    claims: {
      'be.framework': 'Писал REST-методы на Spring Boot для сервиса записи на приём.',
      'be.rest-design': 'Писал REST-методы на Spring Boot для сервиса записи на приём.',
      'common.sql-queries': 'Запросы к PostgreSQL с JOIN и GROUP BY для отчётов.',
      'common.git': "Работал через ветки и pull request'ы, разрешал конфликты слияния.",
    },
  },
};

/** Прежний сид писал выдуманные цитаты с источником cv-demo.pdf — такие неподтверждённые записи заменяем. */
const LEGACY_SOURCE = 'cv-demo.pdf#p1';

export async function seedDemoClaims(prisma: PrismaClient): Promise<void> {
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  let created = 0;
  for (const [candidateId, d] of Object.entries(DEMO_RESUME_CLAIMS)) {
    if (!(await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } }))) continue;
    await prisma.claim.deleteMany({ where: { candidateId, sourceRef: LEGACY_SOURCE, status: 'proposed' } });
    if ((await prisma.claim.count({ where: { candidateId } })) > 0) continue;
    for (const [catalogId, quote] of Object.entries(d.claims)) {
      const entry = catalog.get(catalogId);
      if (!entry) throw new Error(`seed(demo-claims): нет записи каталога ${catalogId}`);
      await prisma.claim.create({
        data: {
          candidateId, catalogId, statement: entry.statement, level: 'self_reported',
          quote,
          sourceRef: `${d.file}#p1`, sourceKind: 'resume', confidence: 'medium', limits: entry.limits,
          suggestedProof: entry.proof, status: 'proposed',
        },
      });
      created++;
    }
  }
  console.log(`seed(demo-claims): ${created} claims for base demo candidates`);
}
