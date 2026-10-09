// Профили только для eval подбора (в БД не сидятся). Вымышленные, «трудные» случаи:
// всё со слов, слабый джун, фронтендер с бэкенд-утверждениями, категория без
// утверждений, доказанное платформой, без специализации.
import type { DemoProfile } from '../../prisma/seed/employer';

export const EXTRA_PROFILES: DemoProfile[] = [
  { id: 'eval-be-self-only', name: 'E1', specialization: 'backend', fspState: 'not_linked', category: null, stack: ['Go'],
    claims: [['be.idempotency', 'self_reported'], ['be.transactions', 'self_reported'], ['be.message-queue', 'self_reported'],
      ['be.retries-timeouts', 'self_reported'], ['be.sql-indexes', 'self_reported'], ['be.rest-design', 'self_reported']] },
  { id: 'eval-be-weak-junior', name: 'E2', specialization: 'backend', fspState: 'not_linked', category: null, stack: ['PHP'],
    claims: [['be.lang-core', 'self_reported'], ['common.git', 'self_reported']] },
  { id: 'eval-fe-fullstackish', name: 'E3', specialization: 'frontend', fspState: 'no_achievements', category: null, stack: ['React', 'Express'],
    claims: [['fe.js-core', 'artifact'], ['fe.api-client', 'artifact'], ['be.rest-design', 'artifact'], ['be.framework', 'artifact']] },
  { id: 'eval-be-category-only', name: 'E4', specialization: 'backend', fspState: 'linked', category: { specialization: 'backend', grade: 'middle' }, stack: ['Java'],
    claims: [['be.cache', 'self_reported'], ['be.concurrency', 'self_reported']] },
  { id: 'eval-fe-platform-junior', name: 'E5', specialization: 'frontend', fspState: 'not_linked', category: null, stack: ['HTML', 'CSS'],
    claims: [['fe.html-semantic', 'platform'], ['fe.css-layout', 'platform'], ['fe.responsive', 'artifact'], ['fe.forms', 'artifact'],
      ['fe.components', 'artifact'], ['fe.js-core', 'artifact']] },
  { id: 'eval-fe-perf-a11y', name: 'E6', specialization: 'frontend', fspState: 'no_achievements', category: null, stack: ['React'],
    claims: [['fe.web-perf', 'artifact'], ['fe.a11y', 'artifact'], ['fe.component-tests', 'third_party'], ['fe.ts-typing', 'artifact']] },
  { id: 'eval-be-pay-partial', name: 'E7', specialization: 'backend', fspState: 'not_linked', category: null, stack: ['Kotlin', 'PostgreSQL'],
    claims: [['be.idempotency', 'artifact'], ['be.message-queue', 'artifact'], ['be.transactions', 'self_reported'],
      ['be.sql-indexes', 'self_reported'], ['common.sql-queries', 'artifact']] },
  { id: 'eval-nospec-algo', name: 'E8', specialization: null, fspState: 'linked', category: null, stack: ['C++'],
    claims: [['common.git', 'artifact'], ['common.algo-complexity', 'third_party'], ['common.unit-tests', 'artifact']] },
];
