import type { DemoProfile } from './employer';

/**
 * Демо-кандидаты направления ai по категориям (подкатегория × грейд), чтобы поиск работодателя не был пустым
 * ни в одной категории. ДЕМО: вымышленные люди, категория поставлена сидом (тест не проходили), утверждения — из
 * каталога. Id `demo-cat-<подкат>-<j|m|s>-<n>`: префикс не demo-pool-, счётчики пула в тестах employer не меняются.
 * В валидацию ранжирования (src/server/validation/sample.ts) не входят — цифры валидации от них не зависят.
 */
type Grade = 'junior' | 'middle' | 'senior';
type Claims = DemoProfile['claims'];

const p = (
  id: string, name: string, sub: string, grade: Grade, fspState: DemoProfile['fspState'],
  contact: string, stack: string[], claims: Claims,
): DemoProfile => ({
  id, name: `Демо: ${name}`, specialization: 'ai', subcategoryId: `ai.${sub}`, fspState,
  contact: `${contact}@example.com`, category: { specialization: 'ai', grade }, stack, claims,
});

export const DEMO_POOL_AI_CATEGORIES: DemoProfile[] = [
  // ai.llm-apps
  p('demo-cat-llm-apps-j-1', 'Вера Лукина', 'llm-apps', 'junior', 'no_achievements', 'v.lukina', ['Python', 'OpenAI API', 'Chroma', 'Streamlit'],
    [['ai.prompting', 'artifact'], ['ai.llm-api', 'self_reported'], ['ai.structured-output', 'self_reported'], ['ai.rag', 'self_reported'],
      ['ai.vector-search', 'self_reported'], ['common.git', 'artifact']]),
  p('demo-cat-llm-apps-m-1', 'Артём Беляев', 'llm-apps', 'middle', 'linked', 'a.belyaev', ['Python', 'LlamaIndex', 'Qdrant', 'FastAPI', 'Langfuse'],
    [['ai.rag', 'artifact'], ['ai.llm-eval', 'artifact'], ['ai.tool-use', 'artifact'], ['ai.prompting', 'artifact'], ['ai.llm-cost', 'third_party'],
      ['ai.structured-output', 'artifact'], ['common.unit-tests', 'self_reported']]),
  p('demo-cat-llm-apps-s-1', 'Марина Соловьёва', 'llm-apps', 'senior', 'not_linked', 'm.solovyova', ['Python', 'LangGraph', 'vLLM', 'pgvector', 'Kubernetes'],
    [['ai.rag', 'artifact'], ['ai.llm-eval', 'artifact'], ['ai.prompt-injection', 'third_party'], ['ai.tool-use', 'artifact'], ['ai.llm-cost', 'artifact'],
      ['ai.llm-fallback', 'third_party'], ['ai.vector-search', 'artifact'], ['ai.llm-system-design', 'artifact'], ['ai.ai-risk', 'third_party']]),
  p('demo-cat-llm-apps-s-2', 'Кирилл Анисимов', 'llm-apps', 'senior', 'no_achievements', 'k.anisimov', ['TypeScript', 'Node.js', 'OpenAI API', 'Elasticsearch'],
    [['ai.tool-use', 'artifact'], ['ai.structured-output', 'artifact'], ['ai.prompt-injection', 'artifact'], ['ai.llm-eval', 'third_party'], ['ai.prompting', 'artifact'],
      ['ai.llm-api', 'artifact'], ['common.security-basics', 'artifact'], ['common.ci-basics', 'self_reported'], ['ai.llm-system-design', 'third_party']]),

  // ai.ai-integration
  p('demo-cat-ai-integration-j-1', 'Дарья Копылова', 'ai-integration', 'junior', 'not_linked', 'd.kopylova', ['Python', 'FastAPI', 'Docker', 'GigaChat'],
    [['ai.llm-api', 'artifact'], ['ai.pii-masking', 'self_reported'], ['ai.structured-output', 'self_reported'], ['common.http', 'artifact'],
      ['common.docker-local', 'self_reported'], ['common.git', 'self_reported']]),
  p('demo-cat-ai-integration-j-2', 'Никита Ермаков', 'ai-integration', 'junior', 'linked', 'n.ermakov', ['Java', 'Spring Boot', 'REST', 'PostgreSQL'],
    [['ai.llm-api', 'self_reported'], ['ai.llm-cost', 'self_reported'], ['ai.pii-masking', 'artifact'], ['common.http', 'artifact'],
      ['common.sql-queries', 'artifact'], ['common.auth-flow', 'self_reported']]),
  p('demo-cat-ai-integration-m-1', 'Елена Фомина', 'ai-integration', 'middle', 'no_achievements', 'e.fomina', ['Python', 'FastAPI', 'Redis', 'Prometheus'],
    [['ai.llm-fallback', 'artifact'], ['ai.pii-masking', 'artifact'], ['ai.llm-cost', 'artifact'], ['ai.llm-api', 'artifact'],
      ['ai.structured-output', 'self_reported'], ['common.http', 'artifact'], ['common.ci-basics', 'artifact']]),
  p('demo-cat-ai-integration-m-2', 'Руслан Хасанов', 'ai-integration', 'middle', 'not_linked', 'r.khasanov', ['Go', 'gRPC', 'Kafka', 'Docker'],
    [['ai.llm-fallback', 'artifact'], ['ai.model-serving', 'self_reported'], ['ai.prompt-injection', 'self_reported'], ['ai.llm-api', 'artifact'],
      ['common.docker-local', 'artifact'], ['common.security-basics', 'third_party'], ['common.debugging', 'artifact']]),
  p('demo-cat-ai-integration-s-1', 'Татьяна Никольская', 'ai-integration', 'senior', 'linked', 't.nikolskaya', ['Python', 'Kubernetes', 'OpenTelemetry', 'Kafka', 'YandexGPT'],
    [['ai.llm-fallback', 'artifact'], ['ai.pii-masking', 'third_party'], ['ai.llm-cost', 'artifact'], ['ai.prompt-injection', 'artifact'], ['ai.monitoring-drift', 'third_party'],
      ['common.security-basics', 'artifact'], ['common.code-review', 'artifact'], ['ai.llm-system-design', 'artifact'], ['common.architecture-decisions', 'third_party']]),
  p('demo-cat-ai-integration-s-2', 'Максим Горбунов', 'ai-integration', 'senior', 'not_linked', 'm.gorbunov', ['Java', 'Spring', 'Istio', 'PostgreSQL'],
    [['ai.llm-fallback', 'third_party'], ['ai.pii-masking', 'artifact'], ['ai.model-serving', 'artifact'], ['ai.llm-eval', 'self_reported'], ['ai.llm-cost', 'artifact'],
      ['common.auth-flow', 'artifact'], ['common.security-basics', 'artifact'], ['common.ci-basics', 'artifact'], ['ai.llm-system-design', 'third_party']]),

  // ai.ml-engineering
  p('demo-cat-ml-engineering-j-1', 'Анастасия Рябова', 'ml-engineering', 'junior', 'linked', 'a.ryabova', ['Python', 'scikit-learn', 'pandas', 'Jupyter'],
    [['ai.ml-baseline', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.feature-pipeline', 'self_reported'], ['ai.pandas-sql', 'self_reported'],
      ['common.algo-complexity', 'self_reported'], ['common.git', 'self_reported']]),
  p('demo-cat-ml-engineering-j-2', 'Глеб Миронов', 'ml-engineering', 'junior', 'no_achievements', 'g.mironov', ['Python', 'PyTorch', 'NumPy', 'Docker'],
    [['ai.ml-baseline', 'self_reported'], ['ai.ml-metrics', 'self_reported'], ['ai.feature-pipeline', 'artifact'], ['common.unit-tests', 'self_reported'],
      ['common.docker-local', 'self_reported'], ['common.debugging', 'self_reported']]),
  p('demo-cat-ml-engineering-m-1', 'Ирина Савельева', 'ml-engineering', 'middle', 'not_linked', 'i.savelyeva', ['Python', 'CatBoost', 'Optuna', 'DVC'],
    [['ai.validation', 'artifact'], ['ai.data-leakage', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.feature-pipeline', 'artifact'],
      ['ai.ml-baseline', 'artifact'], ['common.unit-tests', 'self_reported']]),
  p('demo-cat-ml-engineering-m-2', 'Павел Дьяконов', 'ml-engineering', 'middle', 'linked', 'p.dyakonov', ['Python', 'PyTorch', 'Lightning', 'W&B'],
    [['ai.validation', 'artifact'], ['ai.ml-metrics', 'third_party'], ['ai.feature-pipeline', 'artifact'], ['ai.data-leakage', 'self_reported'],
      ['ai.model-versioning', 'self_reported'], ['common.algo-complexity', 'artifact'], ['common.git', 'artifact']]),
  p('demo-cat-ml-engineering-s-1', 'Оксана Левина', 'ml-engineering', 'senior', 'no_achievements', 'o.levina', ['Python', 'PyTorch', 'Ray', 'MLflow', 'Spark'],
    [['ai.validation', 'artifact'], ['ai.data-leakage', 'third_party'], ['ai.feature-pipeline', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.model-versioning', 'artifact'],
      ['common.algo-complexity', 'artifact'], ['common.code-review', 'artifact'], ['ai.ml-platform', 'artifact'], ['common.mentoring', 'third_party']]),
  p('demo-cat-ml-engineering-s-2', 'Эдуард Зайцев', 'ml-engineering', 'senior', 'not_linked', 'e.zaytsev', ['Python', 'XGBoost', 'Airflow', 'ClickHouse'],
    [['ai.validation', 'third_party'], ['ai.data-leakage', 'artifact'], ['ai.feature-pipeline', 'artifact'], ['ai.ab-testing', 'artifact'], ['ai.ml-metrics', 'artifact'],
      ['common.sql-queries', 'artifact'], ['common.unit-tests', 'artifact'], ['ai.ml-platform', 'third_party']]),

  // ai.mlops
  p('demo-cat-mlops-j-1', 'Софья Логинова', 'mlops', 'junior', 'not_linked', 's.loginova', ['Python', 'Docker', 'MLflow', 'GitHub Actions'],
    [['ai.ml-metrics', 'self_reported'], ['ai.feature-pipeline', 'self_reported'], ['common.docker-local', 'artifact'], ['common.git', 'artifact'],
      ['common.http', 'self_reported'], ['common.debugging', 'self_reported']]),
  p('demo-cat-mlops-j-2', 'Денис Прохоров', 'mlops', 'junior', 'linked', 'd.prokhorov', ['Python', 'FastAPI', 'Docker', 'Linux'],
    [['ai.ml-baseline', 'self_reported'], ['ai.ml-metrics', 'self_reported'], ['common.docker-local', 'artifact'], ['common.http', 'artifact'],
      ['common.git', 'self_reported']]),
  p('demo-cat-mlops-m-1', 'Валерия Тихонова', 'mlops', 'middle', 'no_achievements', 'v.tikhonova', ['Python', 'Kubeflow', 'MLflow', 'Prometheus', 'Grafana'],
    [['ai.model-serving', 'artifact'], ['ai.monitoring-drift', 'artifact'], ['ai.model-versioning', 'artifact'], ['ai.validation', 'self_reported'],
      ['common.ci-basics', 'artifact'], ['common.docker-local', 'artifact']]),
  p('demo-cat-mlops-s-1', 'Борис Кузьмин', 'mlops', 'senior', 'not_linked', 'b.kuzmin', ['Python', 'Kubernetes', 'Seldon', 'Airflow', 'Terraform'],
    [['ai.model-serving', 'artifact'], ['ai.monitoring-drift', 'artifact'], ['ai.model-versioning', 'third_party'], ['ai.validation', 'artifact'], ['ai.data-leakage', 'self_reported'],
      ['common.ci-basics', 'artifact'], ['common.security-basics', 'third_party'], ['ai.ml-platform', 'artifact'], ['common.architecture-decisions', 'third_party']]),
  p('demo-cat-mlops-s-2', 'Яна Овчинникова', 'mlops', 'senior', 'linked', 'y.ovchinnikova', ['Python', 'BentoML', 'Triton', 'Grafana', 'Docker'],
    [['ai.model-serving', 'third_party'], ['ai.monitoring-drift', 'artifact'], ['ai.model-versioning', 'artifact'], ['ai.llm-fallback', 'self_reported'], ['ai.ab-testing', 'artifact'],
      ['common.ci-basics', 'artifact'], ['common.docker-local', 'artifact'], ['ai.ml-platform', 'third_party']]),

  // ai.data-science
  p('demo-cat-data-science-j-1', 'Матвей Субботин', 'data-science', 'junior', 'no_achievements', 'm.subbotin', ['Python', 'pandas', 'Matplotlib', 'SQL'],
    [['ai.pandas-sql', 'artifact'], ['ai.ml-metrics', 'self_reported'], ['ai.ml-baseline', 'self_reported'], ['common.sql-queries', 'artifact'],
      ['common.algo-complexity', 'self_reported'], ['common.git', 'self_reported']]),
  p('demo-cat-data-science-m-1', 'Алла Гришина', 'data-science', 'middle', 'not_linked', 'a.grishina', ['Python', 'statsmodels', 'Prophet', 'SQL'],
    [['ai.ab-testing', 'artifact'], ['ai.pandas-sql', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.validation', 'artifact'],
      ['ai.ml-baseline', 'third_party'], ['common.sql-queries', 'artifact']]),
  p('demo-cat-data-science-m-2', 'Ярослав Комаров', 'data-science', 'middle', 'linked', 'ya.komarov', ['Python', 'LightGBM', 'pandas', 'Superset'],
    [['ai.ml-baseline', 'artifact'], ['ai.feature-pipeline', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.data-leakage', 'self_reported'],
      ['ai.pandas-sql', 'artifact'], ['ai.ab-testing', 'self_reported'], ['common.sql-queries', 'artifact']]),
  p('demo-cat-data-science-s-1', 'Лариса Мельникова', 'data-science', 'senior', 'no_achievements', 'l.melnikova', ['Python', 'R', 'statsmodels', 'ClickHouse', 'Airflow'],
    [['ai.ab-testing', 'artifact'], ['ai.validation', 'artifact'], ['ai.data-leakage', 'third_party'], ['ai.ml-metrics', 'artifact'], ['ai.feature-pipeline', 'artifact'],
      ['common.sql-queries', 'artifact'], ['common.code-review', 'self_reported'], ['ai.ai-risk', 'artifact'], ['common.mentoring', 'third_party']]),
  p('demo-cat-data-science-s-2', 'Игорь Суворов', 'data-science', 'senior', 'not_linked', 'i.suvorov', ['Python', 'PyMC', 'scikit-learn', 'Spark'],
    [['ai.ab-testing', 'third_party'], ['ai.validation', 'artifact'], ['ai.ml-baseline', 'artifact'], ['ai.monitoring-drift', 'self_reported'], ['ai.ml-metrics', 'artifact'],
      ['common.algo-complexity', 'artifact'], ['common.sql-queries', 'artifact'], ['ai.ai-risk', 'third_party']]),

  // ai.bi-analytics
  p('demo-cat-bi-analytics-j-1', 'Полина Ермолаева', 'bi-analytics', 'junior', 'no_achievements', 'p.ermolaeva', ['SQL', 'Power BI', 'Excel', 'Python', 'pandas'],
    [['ai.bi-sql-analytics', 'artifact'], ['ai.bi-dashboards', 'artifact'], ['ai.bi-data-modeling', 'self_reported'], ['ai.pandas-sql', 'self_reported'],
      ['common.sql-queries', 'artifact'], ['common.git', 'self_reported']]),
  p('demo-cat-bi-analytics-j-2', 'Артур Щербаков', 'bi-analytics', 'junior', 'not_linked', 'a.shcherbakov', ['SQL', 'Metabase', 'DataLens', 'Google Sheets'],
    [['ai.bi-sql-analytics', 'self_reported'], ['ai.bi-dashboards', 'artifact'], ['ai.bi-metrics-design', 'self_reported'], ['ai.bi-data-quality', 'self_reported'],
      ['common.sql-queries', 'artifact']]),
  p('demo-cat-bi-analytics-m-1', 'Виктория Назарова', 'bi-analytics', 'middle', 'linked', 'v.nazarova', ['SQL', 'dbt', 'Superset', 'ClickHouse', 'Python'],
    [['ai.bi-metrics-design', 'artifact'], ['ai.bi-data-modeling', 'artifact'], ['ai.bi-sql-analytics', 'artifact'], ['ai.bi-data-quality', 'artifact'],
      ['ai.bi-dashboards', 'third_party'], ['ai.pandas-sql', 'artifact'], ['common.sql-queries', 'artifact']]),
  p('demo-cat-bi-analytics-m-2', 'Эдуард Кириллов', 'bi-analytics', 'middle', 'not_linked', 'e.kirillov', ['SQL', 'Tableau', 'Python', 'Airflow'],
    [['ai.bi-experiment-reporting', 'artifact'], ['ai.bi-metrics-design', 'artifact'], ['ai.bi-dashboards', 'artifact'], ['ai.bi-sql-analytics', 'self_reported'],
      ['ai.ab-testing', 'self_reported'], ['ai.bi-data-quality', 'third_party'], ['common.unit-tests', 'self_reported']]),
  p('demo-cat-bi-analytics-s-1', 'Ольга Дроздова', 'bi-analytics', 'senior', 'no_achievements', 'o.drozdova', ['SQL', 'dbt', 'LookML', 'ClickHouse', 'Python'],
    [['ai.bi-metrics-design', 'artifact'], ['ai.bi-data-modeling', 'artifact'], ['ai.bi-data-quality', 'artifact'], ['ai.bi-experiment-reporting', 'third_party'],
      ['ai.bi-dashboards', 'artifact'], ['ai.bi-sql-analytics', 'artifact'], ['common.architecture-decisions', 'third_party'], ['common.mentoring', 'third_party']]),
  p('demo-cat-bi-analytics-s-2', 'Станислав Бородин', 'bi-analytics', 'senior', 'linked', 's.borodin', ['SQL', 'Cube', 'Superset', 'Spark', 'Python'],
    [['ai.bi-metrics-design', 'third_party'], ['ai.bi-data-modeling', 'artifact'], ['ai.bi-data-quality', 'artifact'], ['ai.ab-testing', 'artifact'],
      ['ai.bi-experiment-reporting', 'artifact'], ['common.code-review', 'self_reported'], ['common.architecture-decisions', 'artifact']]),
];
