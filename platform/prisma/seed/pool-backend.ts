import type { DemoProfile } from './employer';

/**
 * Демо-кандидаты направления backend по категориям (подкатегория × грейд), чтобы поиск работодателя не был пустым
 * ни в одной категории. ДЕМО: вымышленные люди, категория поставлена сидом (тест не проходили), утверждения — из
 * каталога. Id `demo-cat-<подкат>-<j|m|s>-<n>`: префикс не demo-pool-, счётчики пула в тестах employer не меняются.
 * В валидацию ранжирования (src/server/validation/sample.ts) не входят — цифры валидации от них не зависят.
 */
export const DEMO_POOL_BACKEND: DemoProfile[] = [
  {
    id: 'demo-cat-web-api-m-1', name: 'Демо: Алина Воронцова', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'linked',
    category: { specialization: 'backend', grade: 'middle' }, contact: 'alina.vorontsova@example.com',
    stack: ['Python', 'FastAPI', 'PostgreSQL', 'Docker'],
    claims: [['be.rest-design', 'artifact'], ['be.api-validation', 'artifact'], ['be.error-handling', 'third_party'], ['be.sql-schema', 'artifact'], ['be.integration-tests', 'artifact'], ['be.authz', 'self_reported'], ['common.http', 'artifact']],
  },
  {
    id: 'demo-cat-web-api-s-1', name: 'Демо: Тимур Каримов', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'timur.karimov@example.com',
    stack: ['Java', 'Spring Boot', 'PostgreSQL', 'OpenAPI'],
    claims: [['be.api-contract', 'third_party'], ['be.rest-design', 'artifact'], ['be.layering', 'artifact'], ['be.rate-limit', 'artifact'], ['be.authz', 'third_party'], ['be.observability', 'artifact'], ['be.integration-tests', 'artifact'], ['be.system-design', 'artifact'], ['common.architecture-decisions', 'third_party']],
  },
  {
    id: 'demo-cat-web-api-s-2', name: 'Демо: Ольга Мельникова', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'olga.melnikova@example.com',
    stack: ['Go', 'Gin', 'PostgreSQL', 'gRPC'],
    claims: [['be.grpc', 'artifact'], ['be.api-contract', 'artifact'], ['be.service-boundaries', 'third_party'], ['be.error-handling', 'artifact'], ['be.performance', 'self_reported'], ['be.sql-indexes', 'artifact'], ['common.code-review', 'artifact'], ['common.ci-basics', 'artifact'], ['be.system-design', 'third_party']],
  },
  {
    id: 'demo-cat-integrations-j-1', name: 'Демо: Денис Прохоров', specialization: 'backend', subcategoryId: 'backend.integrations', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'denis.prokhorov@example.com',
    stack: ['Node.js', 'Express', 'REST', 'Postman'],
    claims: [['be.external-integration', 'artifact'], ['be.rest-design', 'self_reported'], ['be.error-handling', 'self_reported'], ['common.http', 'artifact'], ['be.config-secrets', 'self_reported'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-integrations-j-2', name: 'Демо: Мария Ильина', specialization: 'backend', subcategoryId: 'backend.integrations', fspState: 'linked',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'maria.ilyina@example.com',
    stack: ['Python', 'Requests', 'Celery', 'Redis'],
    claims: [['be.external-integration', 'self_reported'], ['be.background-jobs', 'artifact'], ['be.file-handling', 'self_reported'], ['be.api-validation', 'self_reported'], ['common.http', 'self_reported'], ['common.debugging', 'self_reported'], ['common.unit-tests', 'self_reported']],
  },
  {
    id: 'demo-cat-integrations-s-1', name: 'Демо: Артём Белов', specialization: 'backend', subcategoryId: 'backend.integrations', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'artem.belov@example.com',
    stack: ['Java', 'Kafka', 'Spring Boot', 'PostgreSQL'],
    claims: [['be.message-queue', 'artifact'], ['be.idempotency', 'third_party'], ['be.retries-timeouts', 'artifact'], ['be.distributed-consistency', 'artifact'], ['be.external-integration', 'third_party'], ['be.observability', 'artifact'], ['be.service-boundaries', 'self_reported'], ['be.reliability-design', 'artifact'], ['common.architecture-decisions', 'third_party']],
  },
  {
    id: 'demo-cat-integrations-s-2', name: 'Демо: Екатерина Наумова', specialization: 'backend', subcategoryId: 'backend.integrations', fspState: 'linked',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'ekaterina.naumova@example.com',
    stack: ['Go', 'RabbitMQ', 'gRPC', 'Docker'],
    claims: [['be.message-queue', 'third_party'], ['be.idempotency', 'artifact'], ['be.retries-timeouts', 'third_party'], ['be.grpc', 'artifact'], ['be.api-contract', 'artifact'], ['be.concurrency', 'artifact'], ['common.code-review', 'artifact'], ['common.docker-local', 'artifact'], ['be.reliability-design', 'third_party']],
  },
  {
    id: 'demo-cat-highload-j-1', name: 'Демо: Кирилл Зубов', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'kirill.zubov@example.com',
    stack: ['Python', 'Django', 'Redis', 'PostgreSQL'],
    claims: [['be.cache', 'artifact'], ['be.sql-schema', 'self_reported'], ['be.orm', 'self_reported'], ['common.sql-queries', 'artifact'], ['common.algo-complexity', 'self_reported'], ['common.debugging', 'self_reported']],
  },
  {
    id: 'demo-cat-highload-j-2', name: 'Демо: Полина Горбунова', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'polina.gorbunova@example.com',
    stack: ['Node.js', 'NestJS', 'Redis', 'MongoDB'],
    claims: [['be.cache', 'self_reported'], ['be.background-jobs', 'self_reported'], ['be.framework', 'artifact'], ['be.realtime', 'self_reported'], ['common.algo-complexity', 'artifact'], ['common.git', 'self_reported'], ['common.unit-tests', 'self_reported']],
  },
  {
    id: 'demo-cat-highload-m-1', name: 'Демо: Никита Орлов', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'linked',
    category: { specialization: 'backend', grade: 'middle' }, contact: 'nikita.orlov@example.com',
    stack: ['Go', 'PostgreSQL', 'Redis', 'Prometheus'],
    claims: [['be.performance', 'artifact'], ['be.cache', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.concurrency', 'third_party'], ['be.background-jobs', 'artifact'], ['be.observability', 'self_reported'], ['common.sql-queries', 'artifact']],
  },
  {
    id: 'demo-cat-highload-m-2', name: 'Демо: Виктория Лазарева', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'middle' }, contact: 'victoria.lazareva@example.com',
    stack: ['Java', 'Spring Boot', 'Caffeine', 'PostgreSQL'],
    claims: [['be.performance', 'third_party'], ['be.orm', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.cache', 'self_reported'], ['be.rate-limit', 'artifact'], ['be.observability', 'artifact'], ['be.concurrency', 'self_reported'], ['common.debugging', 'artifact']],
  },
  {
    id: 'demo-cat-highload-s-1', name: 'Демо: Станислав Егоров', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'stanislav.egorov@example.com',
    stack: ['Go', 'Kafka', 'ClickHouse', 'Kubernetes'],
    claims: [['be.performance', 'artifact'], ['be.concurrency', 'artifact'], ['be.distributed-consistency', 'artifact'], ['be.observability', 'third_party'], ['be.rate-limit', 'artifact'], ['be.nosql', 'artifact'], ['common.code-review', 'third_party'], ['be.data-scale', 'artifact'], ['be.reliability-design', 'third_party']],
  },
  {
    id: 'demo-cat-highload-s-2', name: 'Демо: Дарья Фёдорова', specialization: 'backend', subcategoryId: 'backend.highload', fspState: 'linked',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'darya.fedorova@example.com',
    stack: ['Java', 'Redis', 'PostgreSQL', 'Grafana'],
    claims: [['be.performance', 'third_party'], ['be.cache', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.service-boundaries', 'artifact'], ['be.observability', 'artifact'], ['be.background-jobs', 'artifact'], ['be.concurrency', 'self_reported'], ['common.ci-basics', 'third_party'], ['be.data-scale', 'third_party']],
  },
  {
    id: 'demo-cat-data-model-j-1', name: 'Демо: Руслан Хасанов', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'ruslan.khasanov@example.com',
    stack: ['SQL', 'PostgreSQL', 'Python', 'SQLAlchemy'],
    claims: [['be.sql-schema', 'artifact'], ['common.sql-queries', 'artifact'], ['be.orm', 'self_reported'], ['be.migrations', 'self_reported'], ['common.git', 'self_reported'], ['common.unit-tests', 'self_reported']],
  },
  {
    id: 'demo-cat-data-model-j-2', name: 'Демо: Анастасия Крылова', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'linked',
    category: { specialization: 'backend', grade: 'junior' }, contact: 'anastasia.krylova@example.com',
    stack: ['Java', 'Hibernate', 'MySQL', 'Flyway'],
    claims: [['be.sql-schema', 'self_reported'], ['be.orm', 'artifact'], ['common.sql-queries', 'self_reported'], ['be.error-handling', 'self_reported'], ['be.integration-tests', 'self_reported'], ['common.debugging', 'self_reported']],
  },
  {
    id: 'demo-cat-data-model-m-1', name: 'Демо: Игорь Савельев', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'middle' }, contact: 'igor.saveliev@example.com',
    stack: ['PostgreSQL', 'Go', 'Goose', 'SQL'],
    claims: [['be.migrations', 'artifact'], ['be.transactions', 'artifact'], ['be.sql-schema', 'artifact'], ['be.sql-indexes', 'third_party'], ['be.concurrency', 'self_reported'], ['common.sql-queries', 'artifact']],
  },
  {
    id: 'demo-cat-data-model-m-2', name: 'Демо: Юлия Степанова', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'not_linked',
    category: { specialization: 'backend', grade: 'middle' }, contact: 'yulia.stepanova@example.com',
    stack: ['TypeScript', 'Prisma', 'PostgreSQL', 'Node.js'],
    claims: [['be.orm', 'artifact'], ['be.migrations', 'artifact'], ['be.transactions', 'self_reported'], ['be.sql-schema', 'artifact'], ['be.nosql', 'self_reported'], ['be.integration-tests', 'artifact'], ['common.sql-queries', 'third_party']],
  },
  {
    id: 'demo-cat-data-model-s-1', name: 'Демо: Максим Дьяконов', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'linked',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'maxim.dyakonov@example.com',
    stack: ['PostgreSQL', 'Java', 'Liquibase', 'Debezium'],
    claims: [['be.transactions', 'third_party'], ['be.migrations', 'artifact'], ['be.concurrency', 'artifact'], ['be.distributed-consistency', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.sql-schema', 'third_party'], ['common.code-review', 'artifact'], ['be.data-scale', 'artifact'], ['common.architecture-decisions', 'third_party']],
  },
  {
    id: 'demo-cat-data-model-s-2', name: 'Демо: Елена Тарасова', specialization: 'backend', subcategoryId: 'backend.data-model', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'senior' }, contact: 'elena.tarasova@example.com',
    stack: ['PostgreSQL', 'Python', 'MongoDB', 'Alembic'],
    claims: [['be.transactions', 'artifact'], ['be.nosql', 'third_party'], ['be.migrations', 'third_party'], ['be.idempotency', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.service-boundaries', 'self_reported'], ['be.performance', 'self_reported'], ['common.code-review', 'artifact'], ['be.data-scale', 'third_party']],
  },
];

/**
 * ПРЕДЛОЖЕНИЕ агента: демо-fullstack для представления «Fullstack» в поиске работодателя (employer/fullstack.ts) -
 * категории и в backend (Middle), и в frontend (Junior), чтобы фильтр не был пустым на стенде. ДЕМО: вымышленный человек.
 * Вне DEMO_POOL_CATEGORIES: утверждения двух направлений, а там тест требует одно; засевается в seedDirections.
 * Основная (последняя) категория - backend; frontend - extraCategories.
 */
export const DEMO_POOL_FULLSTACK: DemoProfile[] = [
  {
    id: 'demo-fullstack-m-1', name: 'Демо: Руслан Демидов', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'no_achievements',
    category: { specialization: 'backend', grade: 'middle' }, extraCategories: [{ specialization: 'frontend', grade: 'junior' }], contact: 'ruslan.demidov@example.com',
    stack: ['TypeScript', 'Node.js', 'NestJS', 'React', 'PostgreSQL'],
    claims: [['be.rest-design', 'artifact'], ['be.api-validation', 'artifact'], ['be.sql-schema', 'artifact'], ['be.authz', 'self_reported'], ['fe.components', 'artifact'], ['fe.forms', 'artifact'], ['fe.api-client', 'artifact'], ['fe.ts-typing', 'self_reported'], ['common.git', 'artifact']],
  },
];
