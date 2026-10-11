// Частичный зачёт близких технологий в стеке потребности (R-M-02, R-M-03). Чистые функции.
//
// ПРЕДЛОЖЕНИЕ агента: карта близости и коэффициенты экспертные, без калибровки на данных.
// Коэффициент 0,3–0,6 – доля метки стека, которую закрывает близкая технология: переучивание с
// RabbitMQ на Kafka дешевле, чем с нуля, но это не то же самое. Точное совпадение всегда 1.
import { STACK_PARTIAL_MAX_COEF } from './weights';

/** Пары близких технологий [a, b, коэффициент]. Симметрично. Ключи – в нижнем регистре. */
export const TECH_PROXIMITY: ReadonlyArray<readonly [string, string, number]> = [
  ['kafka', 'rabbitmq', 0.5],
  ['kafka', 'nats', 0.4],
  ['rabbitmq', 'nats', 0.4],
  ['postgresql', 'mysql', 0.6],
  ['postgresql', 'mariadb', 0.5],
  ['mysql', 'mariadb', 0.6],
  ['redis', 'memcached', 0.4],
  ['clickhouse', 'greenplum', 0.3],
  ['spring', 'quarkus', 0.5],
  ['spring', 'micronaut', 0.5],
  ['django', 'fastapi', 0.4],
  ['flask', 'fastapi', 0.5],
  ['express', 'fastify', 0.6],
  ['express', 'nestjs', 0.4],
  ['react', 'vue', 0.4],
  ['react', 'angular', 0.3],
  ['vue', 'angular', 0.3],
  ['next.js', 'nuxt', 0.4],
  ['redux', 'mobx', 0.5],
  ['webpack', 'vite', 0.5],
  ['jest', 'vitest', 0.6],
  ['docker', 'podman', 0.6],
  ['kubernetes', 'openshift', 0.6],
  ['gitlab ci', 'github actions', 0.6],
  ['prometheus', 'victoriametrics', 0.6],
];

/** Синонимы → каноническое имя из карты. */
const ALIASES: Record<string, string> = {
  postgres: 'postgresql',
  'spring boot': 'spring',
  k8s: 'kubernetes',
  nextjs: 'next.js',
  'nest.js': 'nestjs',
  vuejs: 'vue',
  'vue.js': 'vue',
  reactjs: 'react',
  'react.js': 'react',
  'gitlab-ci': 'gitlab ci',
};

/** Имена, под которыми технологию ищем в тексте утверждений. */
const SPELLINGS: Record<string, string[]> = {
  postgresql: ['postgresql', 'postgres'],
  spring: ['spring'],
  kubernetes: ['kubernetes', 'k8s'],
  'next.js': ['next.js', 'nextjs'],
  vue: ['vue'],
  react: ['react'],
  'gitlab ci': ['gitlab ci', 'gitlab-ci'],
};

/** Отображаемое имя технологии из карты. */
const DISPLAY: Record<string, string> = {
  kafka: 'Kafka', rabbitmq: 'RabbitMQ', nats: 'NATS', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB',
  redis: 'Redis', memcached: 'Memcached', clickhouse: 'ClickHouse', greenplum: 'Greenplum', spring: 'Spring',
  quarkus: 'Quarkus', micronaut: 'Micronaut', django: 'Django', fastapi: 'FastAPI', flask: 'Flask', express: 'Express',
  fastify: 'Fastify', nestjs: 'NestJS', react: 'React', vue: 'Vue', angular: 'Angular', 'next.js': 'Next.js', nuxt: 'Nuxt',
  redux: 'Redux', mobx: 'MobX', webpack: 'Webpack', vite: 'Vite', jest: 'Jest', vitest: 'Vitest', docker: 'Docker',
  podman: 'Podman', kubernetes: 'Kubernetes', openshift: 'OpenShift', 'gitlab ci': 'GitLab CI', 'github actions': 'GitHub Actions',
  prometheus: 'Prometheus', victoriametrics: 'VictoriaMetrics',
};

export function canonicalTech(tag: string): string {
  const t = tag.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[t] ?? t;
}

/** Близкие технологии к метке с коэффициентом, сильные первыми. */
export function nearTechs(tag: string): { tech: string; coef: number }[] {
  const t = canonicalTech(tag);
  const out: { tech: string; coef: number }[] = [];
  for (const [a, b, coef] of TECH_PROXIMITY) {
    const c = Math.min(coef, STACK_PARTIAL_MAX_COEF);
    if (a === t) out.push({ tech: b, coef: c });
    else if (b === t) out.push({ tech: a, coef: c });
  }
  return out.sort((x, y) => y.coef - x.coef || x.tech.localeCompare(y.tech));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function containsWord(lower: string, word: string): boolean {
  return new RegExp(`(^|[^a-zа-яё0-9])${escape(word)}($|[^a-zа-яё0-9])`).test(lower);
}

export interface PartialStackMatch {
  /** Метка стека потребности, которой нет в подтверждённых цитатах. */
  tag: string;
  /** Близкая технология, найденная в цитатах. */
  via: string;
  coef: number;
}

/**
 * Частичные совпадения для меток, не найденных точно: лучшая близкая технология из текста утверждений.
 * Поиск – без учёта регистра и целым словом (иначе «vite» нашлось бы в «invite»).
 */
export function matchStackPartial(text: string, missingTags: readonly string[]): PartialStackMatch[] {
  const lower = text.toLowerCase();
  const out: PartialStackMatch[] = [];
  for (const tag of missingTags) {
    const hit = nearTechs(tag).find((n) => (SPELLINGS[n.tech] ?? [n.tech]).some((s) => containsWord(lower, s)));
    if (hit) out.push({ tag, via: DISPLAY[hit.tech] ?? hit.tech, coef: hit.coef });
  }
  return out;
}

/** «частично: RabbitMQ вместо Kafka». */
export function partialText(m: PartialStackMatch): string {
  return `частично: ${m.via} вместо ${m.tag}`;
}
