import type { DemoProfile } from './employer';

/**
 * Демо-кандидаты направления frontend по категориям (подкатегория × грейд), чтобы поиск работодателя не был пустым
 * ни в одной категории. ДЕМО: вымышленные люди, категория поставлена сидом (тест не проходили), утверждения — из
 * каталога. Id `demo-cat-<подкат>-<j|m|s>-<n>`: префикс не demo-pool-, счётчики пула в тестах employer не меняются.
 * В валидацию ранжирования (src/server/validation/sample.ts) не входят — цифры валидации от них не зависят.
 */
export const DEMO_POOL_FRONTEND: DemoProfile[] = [
  {
    id: 'demo-cat-ui-app-s-1', name: 'Демо: Олег Воронин', specialization: 'frontend', subcategoryId: 'frontend.ui-app', fspState: 'linked',
    contact: 'o.voronin@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['Vue', 'TypeScript', 'Pinia', 'Vitest'],
    claims: [['fe.architecture', 'artifact'], ['fe.state-mgmt', 'third_party'], ['fe.routing', 'artifact'], ['fe.forms', 'artifact'], ['fe.ts-typing', 'third_party'], ['fe.component-tests', 'artifact'], ['common.code-review', 'artifact'], ['fe.frontend-platform', 'artifact'], ['common.architecture-decisions', 'third_party']],
  },
  {
    id: 'demo-cat-ui-app-s-2', name: 'Демо: Ксения Лебедева', specialization: 'frontend', subcategoryId: 'frontend.ui-app', fspState: 'not_linked',
    contact: 'k.lebedeva@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['React', 'TypeScript', 'TanStack Query', 'Vite', 'Playwright'],
    claims: [['fe.architecture', 'third_party'], ['fe.state-mgmt', 'artifact'], ['fe.server-state', 'artifact'], ['fe.forms', 'artifact'], ['fe.routing', 'artifact'], ['fe.e2e-tests', 'third_party'], ['fe.ts-typing', 'artifact'], ['common.code-review', 'third_party'], ['fe.frontend-platform', 'third_party']],
  },
  {
    id: 'demo-cat-design-system-j-1', name: 'Демо: Мария Орлова', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'no_achievements',
    contact: 'm.orlova@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['React', 'Storybook', 'CSS Modules', 'TypeScript'],
    claims: [['fe.components', 'artifact'], ['fe.css-layout', 'artifact'], ['fe.a11y', 'self_reported'], ['fe.design-handoff', 'self_reported'], ['fe.html-semantic', 'artifact'], ['fe.responsive', 'self_reported'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-design-system-j-2', name: 'Демо: Артём Беляев', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'linked',
    contact: 'a.belyaev@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['Vue', 'Sass', 'Storybook', 'JavaScript'],
    claims: [['fe.css-cascade', 'artifact'], ['fe.components', 'self_reported'], ['fe.cross-browser', 'artifact'], ['fe.design-handoff', 'artifact'], ['fe.html-semantic', 'self_reported'], ['fe.js-core', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-cat-design-system-m-1', name: 'Демо: Полина Киселёва', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'not_linked',
    contact: 'p.kiseleva@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['React', 'TypeScript', 'Storybook', 'Radix UI', 'Tailwind'],
    claims: [['fe.css-architecture', 'artifact'], ['fe.a11y', 'artifact'], ['fe.components', 'artifact'], ['fe.ts-typing', 'artifact'], ['fe.design-handoff', 'third_party'], ['fe.component-tests', 'artifact'], ['fe.bundler', 'self_reported'], ['common.unit-tests', 'artifact']],
  },
  {
    id: 'demo-cat-design-system-m-2', name: 'Демо: Руслан Хабибуллин', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'linked',
    contact: 'r.khabibullin@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Angular', 'SCSS', 'Chromatic', 'TypeScript'],
    claims: [['fe.css-architecture', 'third_party'], ['fe.cross-browser', 'artifact'], ['fe.a11y', 'third_party'], ['fe.responsive', 'artifact'], ['fe.render-lifecycle', 'self_reported'], ['fe.architecture', 'self_reported'], ['fe.component-tests', 'self_reported'], ['common.code-review', 'artifact']],
  },
  {
    id: 'demo-cat-design-system-s-1', name: 'Демо: Елена Фомина', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'no_achievements',
    contact: 'e.fomina@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['React', 'TypeScript', 'Storybook', 'Style Dictionary', 'Rollup'],
    claims: [['fe.architecture', 'third_party'], ['fe.css-architecture', 'third_party'], ['fe.a11y', 'third_party'], ['fe.bundler', 'artifact'], ['fe.component-tests', 'artifact'], ['fe.design-handoff', 'artifact'], ['fe.ts-typing', 'artifact'], ['fe.design-system-governance', 'artifact'], ['common.mentoring', 'third_party']],
  },
  {
    id: 'demo-cat-design-system-s-2', name: 'Демо: Игорь Субботин', specialization: 'frontend', subcategoryId: 'frontend.design-system', fspState: 'not_linked',
    contact: 'i.subbotin@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['Web Components', 'Lit', 'TypeScript', 'Vite'],
    claims: [['fe.architecture', 'artifact'], ['fe.css-architecture', 'artifact'], ['fe.cross-browser', 'third_party'], ['fe.a11y', 'artifact'], ['fe.dom-events', 'artifact'], ['fe.render-lifecycle', 'artifact'], ['fe.e2e-tests', 'artifact'], ['common.code-review', 'artifact'], ['fe.design-system-governance', 'third_party']],
  },
  {
    id: 'demo-cat-web-perf-j-1', name: 'Демо: Дарья Власова', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'not_linked',
    contact: 'd.vlasova@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['JavaScript', 'Webpack', 'Lighthouse', 'React'],
    claims: [['fe.bundler', 'artifact'], ['fe.js-core', 'artifact'], ['fe.web-perf', 'self_reported'], ['fe.render-lifecycle', 'self_reported'], ['common.http', 'artifact'], ['common.debugging', 'self_reported'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-web-perf-j-2', name: 'Демо: Никита Рябов', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'linked',
    contact: 'n.ryabov@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['TypeScript', 'Vite', 'Chrome DevTools', 'Vue'],
    claims: [['fe.event-loop', 'artifact'], ['fe.bundler', 'self_reported'], ['fe.responsive', 'artifact'], ['fe.dom-events', 'self_reported'], ['fe.web-perf', 'self_reported'], ['common.http', 'self_reported'], ['common.debugging', 'artifact']],
  },
  {
    id: 'demo-cat-web-perf-m-1', name: 'Демо: Алёна Тихонова', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'no_achievements',
    contact: 'a.tikhonova@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Next.js', 'React', 'Webpack', 'Web Vitals', 'TypeScript'],
    claims: [['fe.web-perf', 'artifact'], ['fe.render-perf', 'artifact'], ['fe.ssr', 'artifact'], ['fe.bundler', 'artifact'], ['fe.event-loop', 'self_reported'], ['fe.server-state', 'self_reported'], ['common.http', 'artifact'], ['common.debugging', 'artifact']],
  },
  {
    id: 'demo-cat-web-perf-m-2', name: 'Демо: Виктор Зуев', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'linked',
    contact: 'v.zuev@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Nuxt', 'Vue', 'Rollup', 'Lighthouse CI'],
    claims: [['fe.web-perf', 'third_party'], ['fe.render-perf', 'self_reported'], ['fe.ssr', 'third_party'], ['fe.browser-storage', 'artifact'], ['fe.bundler', 'artifact'], ['fe.css-layout', 'artifact'], ['common.ci-basics', 'artifact'], ['common.http', 'self_reported']],
  },
  {
    id: 'demo-cat-web-perf-s-1', name: 'Демо: Светлана Крылова', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'not_linked',
    contact: 's.krylova@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['Next.js', 'React', 'Webpack', 'Sentry', 'TypeScript'],
    claims: [['fe.render-perf', 'third_party'], ['fe.ssr', 'artifact'], ['fe.architecture', 'artifact'], ['fe.bundler', 'artifact'], ['fe.browser-storage', 'artifact'], ['common.http', 'third_party'], ['common.ci-basics', 'artifact'], ['fe.perf-budget', 'artifact'], ['common.architecture-decisions', 'third_party']],
  },
  {
    id: 'demo-cat-web-perf-s-2', name: 'Демо: Михаил Гусев', specialization: 'frontend', subcategoryId: 'frontend.web-perf', fspState: 'no_achievements',
    contact: 'm.gusev@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['Svelte', 'Vite', 'Service Worker', 'Lighthouse CI'],
    claims: [['fe.web-perf', 'artifact'], ['fe.render-perf', 'artifact'], ['fe.event-loop', 'third_party'], ['fe.browser-storage', 'third_party'], ['fe.bundler', 'third_party'], ['fe.ssr', 'self_reported'], ['common.http', 'artifact'], ['common.algo-complexity', 'artifact'], ['fe.perf-budget', 'third_party']],
  },
  {
    id: 'demo-cat-realtime-j-1', name: 'Демо: Виктория Назарова', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'no_achievements',
    contact: 'v.nazarova@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['JavaScript', 'WebSocket', 'React', 'Node.js'],
    claims: [['fe.js-core', 'artifact'], ['fe.event-loop', 'artifact'], ['fe.realtime-client', 'self_reported'], ['fe.state-mgmt', 'self_reported'], ['fe.dom-events', 'artifact'], ['common.http', 'self_reported'], ['common.debugging', 'self_reported']],
  },
  {
    id: 'demo-cat-realtime-j-2', name: 'Демо: Егор Пономарёв', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'not_linked',
    contact: 'e.ponomarev@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['TypeScript', 'Socket.IO', 'Vue', 'Pinia'],
    claims: [['fe.api-client', 'artifact'], ['fe.ts-typing', 'self_reported'], ['fe.state-mgmt', 'artifact'], ['fe.components', 'self_reported'], ['fe.realtime-client', 'self_reported'], ['common.http', 'artifact'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-cat-realtime-m-1', name: 'Демо: Юлия Макарова', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'linked',
    contact: 'y.makarova@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['React', 'TypeScript', 'WebSocket', 'TanStack Query'],
    claims: [['fe.realtime-client', 'artifact'], ['fe.server-state', 'artifact'], ['fe.state-mgmt', 'artifact'], ['fe.browser-storage', 'self_reported'], ['fe.api-client', 'artifact'], ['fe.render-perf', 'self_reported'], ['common.http', 'artifact'], ['common.unit-tests', 'artifact']],
  },
  {
    id: 'demo-cat-realtime-m-2', name: 'Демо: Станислав Аксёнов', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'not_linked',
    contact: 's.aksenov@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Vue', 'TypeScript', 'SSE', 'IndexedDB', 'Vitest'],
    claims: [['fe.realtime-client', 'third_party'], ['fe.server-state', 'self_reported'], ['fe.browser-storage', 'artifact'], ['fe.api-client', 'artifact'], ['fe.component-tests', 'artifact'], ['fe.event-loop', 'artifact'], ['common.debugging', 'artifact'], ['common.http', 'self_reported']],
  },
  {
    id: 'demo-cat-realtime-s-1', name: 'Демо: Татьяна Мельникова', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'no_achievements',
    contact: 't.melnikova@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['React', 'TypeScript', 'WebSocket', 'Yjs', 'Playwright'],
    claims: [['fe.realtime-client', 'third_party'], ['fe.server-state', 'artifact'], ['fe.architecture', 'artifact'], ['fe.browser-storage', 'artifact'], ['fe.state-mgmt', 'third_party'], ['fe.e2e-tests', 'artifact'], ['common.http', 'third_party'], ['fe.frontend-platform', 'artifact'], ['common.mentoring', 'third_party']],
  },
  {
    id: 'demo-cat-realtime-s-2', name: 'Демо: Андрей Шестаков', specialization: 'frontend', subcategoryId: 'frontend.realtime', fspState: 'linked',
    contact: 'a.shestakov@example.com', category: { specialization: 'frontend', grade: 'senior' }, stack: ['Svelte', 'TypeScript', 'SSE', 'Service Worker', 'Node.js'],
    claims: [['fe.realtime-client', 'artifact'], ['fe.architecture', 'third_party'], ['fe.server-state', 'third_party'], ['fe.render-perf', 'artifact'], ['fe.event-loop', 'third_party'], ['fe.browser-storage', 'artifact'], ['common.http', 'artifact'], ['common.security-basics', 'artifact'], ['fe.frontend-platform', 'third_party']],
  },
];
