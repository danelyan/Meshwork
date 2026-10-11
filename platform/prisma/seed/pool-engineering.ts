import type { DemoProfile } from './employer';

/**
 * Демо-кандидаты направления engineering по категориям (подкатегория × грейд), чтобы поиск работодателя не был пустым
 * ни в одной категории. ДЕМО: вымышленные люди, категория поставлена сидом (тест не проходили), утверждения — из
 * каталога. Id `demo-cat-<подкат>-<j|m|s>-<n>`: префикс не demo-pool-, счётчики пула в тестах employer не меняются.
 * В валидацию ранжирования (src/server/validation/sample.ts) не входят — цифры валидации от них не зависят.
 */
export const DEMO_POOL_ENGINEERING: DemoProfile[] = [
  {
    id: 'demo-cat-data-eng-j-1', name: 'Демо: Мария Белова', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'not_linked',
    contact: 'm.belova@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Python', 'SQL', 'Airflow', 'PostgreSQL'],
    claims: [['eng.etl-pipeline', 'artifact'], ['eng.data-types', 'artifact'], ['eng.data-quality', 'self_reported'], ['eng.orchestration', 'self_reported'], ['common.sql-queries', 'artifact'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-data-eng-j-2', name: 'Демо: Артём Нестеров', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'linked',
    contact: 'a.nesterov@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Python', 'pandas', 'ClickHouse', 'Docker'],
    claims: [['eng.etl-pipeline', 'artifact'], ['eng.data-quality', 'artifact'], ['eng.data-types', 'self_reported'], ['common.sql-queries', 'artifact'], ['common.algo-complexity', 'third_party'], ['common.docker-local', 'self_reported']],
  },
  {
    id: 'demo-cat-data-eng-m-1', name: 'Демо: Ксения Лебедева', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'no_achievements',
    contact: 'k.lebedeva@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Python', 'Airflow', 'Spark', 'Greenplum'],
    claims: [['eng.etl-pipeline', 'artifact'], ['eng.idempotent-load', 'artifact'], ['eng.incremental-load', 'artifact'], ['eng.dwh-modeling', 'artifact'], ['eng.orchestration', 'artifact'], ['eng.data-quality', 'self_reported'], ['common.sql-queries', 'artifact']],
  },
  {
    id: 'demo-cat-data-eng-m-2', name: 'Демо: Руслан Фаттахов', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'not_linked',
    contact: 'r.fattakhov@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Kafka', 'dbt', 'ClickHouse', 'Python'],
    claims: [['eng.partitioning', 'artifact'], ['eng.incremental-load', 'artifact'], ['eng.data-quality', 'artifact'], ['eng.etl-pipeline', 'third_party'], ['eng.orchestration', 'self_reported'], ['common.ci-basics', 'artifact'], ['common.code-review', 'self_reported']],
  },
  {
    id: 'demo-cat-data-eng-s-1', name: 'Демо: Георгий Савельев', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'linked',
    contact: 'g.saveliev@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Spark', 'Airflow', 'Trino', 'Iceberg', 'Python'],
    claims: [['eng.idempotent-load', 'artifact'], ['eng.incremental-load', 'artifact'], ['eng.partitioning', 'third_party'], ['eng.dwh-modeling', 'artifact'], ['eng.orchestration', 'artifact'], ['eng.etl-pipeline', 'artifact'], ['eng.observability', 'third_party'], ['common.code-review', 'artifact']],
  },
  {
    id: 'demo-cat-data-eng-s-2', name: 'Демо: Ирина Ковалёва', specialization: 'engineering', subcategoryId: 'engineering.data-eng', fspState: 'no_achievements',
    contact: 'i.kovaleva@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Flink', 'Kafka', 'Snowflake', 'dbt'],
    claims: [['eng.incremental-load', 'third_party'], ['eng.idempotent-load', 'artifact'], ['eng.dwh-modeling', 'artifact'], ['eng.partitioning', 'artifact'], ['eng.capacity-planning', 'artifact'], ['eng.slo', 'self_reported'], ['common.code-review', 'artifact'], ['common.security-basics', 'self_reported']],
  },
  {
    id: 'demo-cat-devops-j-1', name: 'Демо: Денис Орлов', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'not_linked',
    contact: 'd.orlov@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Docker', 'GitLab CI', 'Linux', 'Bash'],
    claims: [['eng.dockerfile', 'artifact'], ['eng.ci-cd', 'artifact'], ['eng.secrets', 'self_reported'], ['common.git', 'artifact'], ['common.docker-local', 'artifact'], ['common.http', 'self_reported']],
  },
  {
    id: 'demo-cat-devops-j-2', name: 'Демо: Алёна Ширяева', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'linked',
    contact: 'a.shiryaeva@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Docker', 'GitHub Actions', 'Nginx', 'Terraform'],
    claims: [['eng.ci-cd', 'artifact'], ['eng.dockerfile', 'self_reported'], ['eng.secrets', 'self_reported'], ['eng.observability', 'self_reported'], ['common.git', 'self_reported'], ['common.debugging', 'self_reported']],
  },
  {
    id: 'demo-cat-devops-m-1', name: 'Демо: Павел Гришин', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'not_linked',
    contact: 'p.grishin@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Kubernetes', 'Helm', 'Terraform', 'Prometheus'],
    claims: [['eng.k8s-probes', 'artifact'], ['eng.k8s-resources', 'artifact'], ['eng.deploy-rollback', 'artifact'], ['eng.iac', 'artifact'], ['eng.ci-cd', 'artifact'], ['eng.secrets', 'third_party'], ['common.ci-basics', 'artifact']],
  },
  {
    id: 'demo-cat-devops-m-2', name: 'Демо: Виктория Сорокина', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'no_achievements',
    contact: 'v.sorokina@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Ansible', 'GitLab CI', 'Docker', 'Grafana', 'Loki'],
    claims: [['eng.ci-cd', 'artifact'], ['eng.deploy-rollback', 'artifact'], ['eng.observability', 'artifact'], ['eng.dockerfile', 'artifact'], ['eng.secrets', 'self_reported'], ['eng.iac', 'self_reported'], ['common.security-basics', 'self_reported']],
  },
  {
    id: 'demo-cat-devops-s-1', name: 'Демо: Матвей Дроздов', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'linked',
    contact: 'm.drozdov@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Kubernetes', 'Terraform', 'ArgoCD', 'Vault', 'Prometheus'],
    claims: [['eng.iac', 'artifact'], ['eng.k8s-resources', 'artifact'], ['eng.deploy-rollback', 'third_party'], ['eng.ci-cd', 'artifact'], ['eng.capacity-planning', 'artifact'], ['eng.observability', 'artifact'], ['common.security-basics', 'third_party'], ['common.code-review', 'artifact']],
  },
  {
    id: 'demo-cat-devops-s-2', name: 'Демо: Елена Макарова', specialization: 'engineering', subcategoryId: 'engineering.devops', fspState: 'not_linked',
    contact: 'e.makarova@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['AWS', 'Terraform', 'Kubernetes', 'Jenkins', 'Go'],
    claims: [['eng.iac', 'artifact'], ['eng.deploy-rollback', 'artifact'], ['eng.ci-cd', 'third_party'], ['eng.k8s-resources', 'self_reported'], ['eng.slo', 'artifact'], ['eng.observability', 'third_party'], ['eng.incident-postmortem', 'self_reported'], ['common.code-review', 'artifact']],
  },
  {
    id: 'demo-cat-qa-automation-j-1', name: 'Демо: Софья Тихонова', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'no_achievements',
    contact: 's.tikhonova@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Python', 'pytest', 'Requests', 'Allure'],
    claims: [['eng.test-design', 'artifact'], ['eng.test-strategy', 'self_reported'], ['eng.test-isolation', 'artifact'], ['common.http', 'artifact'], ['common.unit-tests', 'self_reported'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-qa-automation-j-2', name: 'Демо: Кирилл Андреев', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'linked',
    contact: 'k.andreev@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Java', 'Selenide', 'JUnit', 'Selenium'],
    claims: [['eng.ui-autotests', 'artifact'], ['eng.test-design', 'artifact'], ['eng.test-isolation', 'self_reported'], ['common.unit-tests', 'artifact'], ['common.debugging', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-cat-qa-automation-m-1', name: 'Демо: Наталья Пестова', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'not_linked',
    contact: 'n.pestova@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['TypeScript', 'Playwright', 'Jest', 'GitHub Actions'],
    claims: [['eng.ui-autotests', 'artifact'], ['eng.flaky-tests', 'artifact'], ['eng.test-isolation', 'artifact'], ['eng.test-strategy', 'artifact'], ['eng.test-design', 'third_party'], ['common.ci-basics', 'artifact'], ['common.code-review', 'self_reported']],
  },
  {
    id: 'demo-cat-qa-automation-m-2', name: 'Демо: Игорь Субботин', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'no_achievements',
    contact: 'i.subbotin@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Python', 'pytest', 'Pact', 'Docker', 'Postgres'],
    claims: [['eng.contract-tests', 'artifact'], ['eng.test-strategy', 'artifact'], ['eng.flaky-tests', 'self_reported'], ['eng.test-isolation', 'artifact'], ['common.http', 'artifact'], ['common.sql-queries', 'self_reported'], ['common.docker-local', 'artifact']],
  },
  {
    id: 'demo-cat-qa-automation-s-1', name: 'Демо: Анастасия Румянцева', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'linked',
    contact: 'a.rumyantseva@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Kotlin', 'Playwright', 'Pact', 'Allure', 'Kubernetes'],
    claims: [['eng.test-strategy', 'artifact'], ['eng.flaky-tests', 'artifact'], ['eng.contract-tests', 'artifact'], ['eng.ui-autotests', 'third_party'], ['eng.test-design', 'artifact'], ['eng.observability', 'self_reported'], ['common.code-review', 'artifact'], ['common.ci-basics', 'third_party']],
  },
  {
    id: 'demo-cat-qa-automation-s-2', name: 'Демо: Семён Воробьёв', specialization: 'engineering', subcategoryId: 'engineering.qa-automation', fspState: 'not_linked',
    contact: 's.vorobyov@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Java', 'RestAssured', 'TestContainers', 'Jenkins'],
    claims: [['eng.contract-tests', 'third_party'], ['eng.flaky-tests', 'artifact'], ['eng.test-strategy', 'artifact'], ['eng.test-isolation', 'artifact'], ['eng.deploy-rollback', 'self_reported'], ['common.code-review', 'artifact'], ['common.security-basics', 'self_reported']],
  },
  {
    id: 'demo-cat-sre-j-1', name: 'Демо: Юлия Фролова', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'not_linked',
    contact: 'y.frolova@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Linux', 'Prometheus', 'Grafana', 'Python'],
    claims: [['eng.observability', 'artifact'], ['eng.alerting', 'self_reported'], ['eng.slo', 'self_reported'], ['eng.incident-postmortem', 'self_reported'], ['common.debugging', 'artifact'], ['common.http', 'self_reported']],
  },
  {
    id: 'demo-cat-sre-j-2', name: 'Демо: Тимофей Беляев', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'no_achievements',
    contact: 't.belyaev@example.com', category: { specialization: 'engineering', grade: 'junior' }, stack: ['Bash', 'Docker', 'Zabbix', 'Loki'],
    claims: [['eng.alerting', 'artifact'], ['eng.observability', 'self_reported'], ['eng.incident-postmortem', 'artifact'], ['common.debugging', 'self_reported'], ['common.docker-local', 'self_reported'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-sre-m-1', name: 'Демо: Аркадий Зуев', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'linked',
    contact: 'a.zuev@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Kubernetes', 'Prometheus', 'Go', 'OpenTelemetry'],
    claims: [['eng.slo', 'artifact'], ['eng.alerting', 'artifact'], ['eng.retries-resilience', 'artifact'], ['eng.observability', 'artifact'], ['eng.incident-postmortem', 'artifact'], ['eng.capacity-planning', 'self_reported'], ['common.debugging', 'artifact']],
  },
  {
    id: 'demo-cat-sre-m-2', name: 'Демо: Диана Мельникова', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'not_linked',
    contact: 'd.melnikova@example.com', category: { specialization: 'engineering', grade: 'middle' }, stack: ['Python', 'Grafana', 'Kafka', 'Terraform'],
    claims: [['eng.incident-postmortem', 'artifact'], ['eng.capacity-planning', 'artifact'], ['eng.alerting', 'artifact'], ['eng.retries-resilience', 'self_reported'], ['eng.deploy-rollback', 'self_reported'], ['eng.slo', 'third_party'], ['common.ci-basics', 'self_reported']],
  },
  {
    id: 'demo-cat-sre-s-1', name: 'Демо: Владимир Лапин', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'no_achievements',
    contact: 'v.lapin@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Kubernetes', 'Prometheus', 'Thanos', 'Go', 'Terraform'],
    claims: [['eng.slo', 'artifact'], ['eng.capacity-planning', 'artifact'], ['eng.incident-postmortem', 'third_party'], ['eng.retries-resilience', 'artifact'], ['eng.observability', 'artifact'], ['eng.k8s-resources', 'artifact'], ['common.code-review', 'artifact'], ['common.security-basics', 'self_reported']],
  },
  {
    id: 'demo-cat-sre-s-2', name: 'Демо: Оксана Гусева', specialization: 'engineering', subcategoryId: 'engineering.sre', fspState: 'linked',
    contact: 'o.guseva@example.com', category: { specialization: 'engineering', grade: 'senior' }, stack: ['Envoy', 'Jaeger', 'Python', 'Kafka', 'AWS'],
    claims: [['eng.incident-postmortem', 'artifact'], ['eng.slo', 'artifact'], ['eng.retries-resilience', 'third_party'], ['eng.capacity-planning', 'artifact'], ['eng.deploy-rollback', 'artifact'], ['eng.alerting', 'artifact'], ['eng.observability', 'third_party'], ['common.code-review', 'third_party']],
  },
];
