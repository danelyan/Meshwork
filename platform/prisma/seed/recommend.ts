import type { PrismaClient } from '@prisma/client';

// Сид лейна recommend: 3 вымышленные компании, 8 вакансий, 16 заданий банка.
// catalogId — из docs/product/claims-catalog.md (черновик). Идемпотентен (upsert по id).

type Need = [catalogId: string, weight: 1 | 2 | 3];

export const DEMO_COMPANIES = [
  { id: 'demo-co-northstream', name: 'Северный Поток', description: 'Вымышленная финтех-компания (демо)' },
  { id: 'demo-co-granit', name: 'Гранит Софт', description: 'Вымышленный разработчик корпоративных систем (демо)' },
  { id: 'demo-co-labirint', name: 'Лабиринт Медиа', description: 'Вымышленная медиаплатформа (демо)' },
];

export const DEMO_VACANCIES: {
  id: string; companyId: string; title: string; specialization: 'backend' | 'frontend'; grade: 'junior' | 'middle';
  salaryFrom: number; salaryTo: number; needs: Need[];
}[] = [
  { id: 'demo-vac-be-j-1', companyId: 'demo-co-northstream', title: 'Backend-разработчик (Junior)', specialization: 'backend', grade: 'junior', salaryFrom: 90000, salaryTo: 130000,
    needs: [['be.lang-core', 3], ['be.rest-design', 2], ['be.sql-schema', 2], ['be.orm', 2], ['common.sql-queries', 3], ['be.error-handling', 2], ['common.git', 1]] },
  { id: 'demo-vac-be-m-1', companyId: 'demo-co-northstream', title: 'Backend-разработчик платежей (Middle)', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 280000,
    needs: [['be.idempotency', 3], ['be.transactions', 3], ['be.message-queue', 3], ['be.retries-timeouts', 2], ['be.sql-indexes', 3], ['be.rest-design', 3]] },
  { id: 'demo-vac-be-j-2', companyId: 'demo-co-granit', title: 'Backend-разработчик (Junior)', specialization: 'backend', grade: 'junior', salaryFrom: 80000, salaryTo: 120000,
    needs: [['be.framework', 3], ['be.api-validation', 2], ['be.authn-impl', 2], ['be.config-secrets', 2], ['common.http', 3], ['common.debugging', 2]] },
  { id: 'demo-vac-be-m-2', companyId: 'demo-co-granit', title: 'Backend-разработчик (Middle)', specialization: 'backend', grade: 'middle', salaryFrom: 220000, salaryTo: 300000,
    needs: [['be.authz', 3], ['be.concurrency', 3], ['be.cache', 3], ['be.integration-tests', 3], ['be.observability', 2], ['be.distributed-consistency', 2]] },
  { id: 'demo-vac-fe-j-1', companyId: 'demo-co-labirint', title: 'Frontend-разработчик (Junior)', specialization: 'frontend', grade: 'junior', salaryFrom: 80000, salaryTo: 115000,
    needs: [['fe.html-semantic', 3], ['fe.css-layout', 3], ['fe.responsive', 3], ['fe.js-core', 3], ['fe.components', 3], ['fe.forms', 3]] },
  { id: 'demo-vac-fe-m-1', companyId: 'demo-co-labirint', title: 'Frontend-разработчик (Middle)', specialization: 'frontend', grade: 'middle', salaryFrom: 190000, salaryTo: 270000,
    needs: [['fe.ts-typing', 3], ['fe.state-mgmt', 3], ['fe.server-state', 2], ['fe.web-perf', 3], ['fe.component-tests', 3], ['fe.a11y', 3]] },
  { id: 'demo-vac-fe-j-2', companyId: 'demo-co-northstream', title: 'Frontend-разработчик (Junior)', specialization: 'frontend', grade: 'junior', salaryFrom: 85000, salaryTo: 120000,
    needs: [['fe.js-core', 3], ['fe.event-loop', 2], ['fe.api-client', 3], ['fe.dom-events', 2], ['fe.routing', 2], ['common.git', 2]] },
  { id: 'demo-vac-fe-m-2', companyId: 'demo-co-granit', title: 'Frontend-разработчик (Middle)', specialization: 'frontend', grade: 'middle', salaryFrom: 210000, salaryTo: 290000,
    needs: [['fe.render-lifecycle', 3], ['fe.architecture', 2], ['fe.ssr', 2], ['fe.e2e-tests', 2], ['fe.bundler', 2], ['fe.api-client', 3]] },
];

// По 2 задания на кластер пробелов. family — имена из каталога (колонка «Доказывается»).
export const DEMO_TASKS: { id: string; title: string; family: string; grade: 'junior' | 'middle'; catalogIds: string[]; description: string }[] = [
  { id: 'task:payment-retry', title: 'Один платёж, два запроса', family: 'payment-retry', grade: 'middle', catalogIds: ['be.idempotency', 'be.retries-timeouts'], description: 'Найти, где повтор запроса создаёт второй платёж.' },
  { id: 'task:delivery-semantics', title: 'Сообщение пришло дважды', family: 'delivery-semantics', grade: 'middle', catalogIds: ['be.message-queue', 'be.idempotency'], description: 'Выбрать семантику доставки и подтверждения.' },
  { id: 'task:index-choice', title: 'Какой индекс ускорит запрос', family: 'index-choice', grade: 'middle', catalogIds: ['be.sql-indexes', 'be.sql-schema'], description: 'Выбрать индекс по плану запроса.' },
  { id: 'task:isolation-anomaly', title: 'Аномалия изоляции', family: 'isolation-anomaly', grade: 'middle', catalogIds: ['be.transactions'], description: 'Определить аномалию при заданном уровне изоляции.' },
  { id: 'task:find-bug-idor', title: 'Найди IDOR', family: 'find-bug', grade: 'junior', catalogIds: ['be.authz', 'be.authn-impl', 'be.config-secrets'], description: 'Найти уязвимость доступа в обработчике.' },
  { id: 'task:find-bug-secrets', title: 'Секрет в коде', family: 'find-bug', grade: 'junior', catalogIds: ['be.config-secrets', 'common.security-basics'], description: 'Найти утечку секрета и исправить.' },
  { id: 'task:http-semantics', title: 'Верный код ответа', family: 'http-semantics', grade: 'junior', catalogIds: ['be.rest-design', 'common.http', 'be.api-validation'], description: 'Выбрать метод и код ответа по описанию.' },
  { id: 'task:http-cache-headers', title: 'Заголовки и валидация', family: 'http-semantics', grade: 'junior', catalogIds: ['common.http', 'be.api-validation'], description: 'Разобрать заголовки запроса и ответа.' },
  { id: 'task:cache-consistency', title: 'Устаревший кэш', family: 'cache-consistency', grade: 'middle', catalogIds: ['be.cache', 'be.concurrency'], description: 'Найти гонку между записью и инвалидацией кэша.' },
  { id: 'task:n-plus-one', title: 'N+1 в ORM', family: 'n-plus-one', grade: 'junior', catalogIds: ['be.orm', 'common.sql-queries'], description: 'Найти и убрать лишние запросы.' },
  { id: 'task:code-output-js', title: 'Что выведет код', family: 'code-output', grade: 'junior', catalogIds: ['fe.js-core', 'fe.event-loop'], description: 'Предсказать вывод с замыканиями и промисами.' },
  { id: 'task:ts-typecheck', title: 'Пройдёт ли проверка типов', family: 'ts-typecheck', grade: 'middle', catalogIds: ['fe.ts-typing'], description: 'Определить, где компилятор выдаст ошибку.' },
  { id: 'task:state-flow', title: 'Куда делось состояние', family: 'state-flow', grade: 'middle', catalogIds: ['fe.state-mgmt', 'fe.server-state'], description: 'Найти потерянное обновление состояния.' },
  { id: 'task:api-client-errors', title: 'Ошибки сети в клиенте', family: 'api-client', grade: 'junior', catalogIds: ['fe.api-client', 'fe.forms'], description: 'Обработать отказ и повтор запроса в форме.' },
  { id: 'task:render-perf', title: 'Лишние перерисовки', family: 'render-perf', grade: 'middle', catalogIds: ['fe.web-perf', 'fe.render-lifecycle'], description: 'Найти причину лишних рендеров.' },
  { id: 'task:a11y-fix', title: 'Исправь доступность', family: 'a11y-fix', grade: 'middle', catalogIds: ['fe.a11y', 'fe.component-tests'], description: 'Починить семантику и фокус в компоненте.' },
];

export async function seedRecommend(prisma: PrismaClient): Promise<void> {
  for (const c of DEMO_COMPANIES) {
    await prisma.company.upsert({ where: { id: c.id }, update: { ...c, isDemo: true }, create: { ...c, isDemo: true } });
  }
  for (const v of DEMO_VACANCIES) {
    const { needs, ...rest } = v;
    const data = { ...rest, needs: needs.map(([catalogId, weight]) => ({ catalogId, weight })) };
    await prisma.vacancy.upsert({ where: { id: v.id }, update: data, create: data });
  }
  for (const t of DEMO_TASKS) {
    await prisma.task.upsert({ where: { id: t.id }, update: t, create: t });
  }
  console.log(`seed(recommend): ${DEMO_COMPANIES.length} companies, ${DEMO_VACANCIES.length} vacancies, ${DEMO_TASKS.length} tasks`);
}
