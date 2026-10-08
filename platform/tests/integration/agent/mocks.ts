/**
 * Моки контрактов других лейнов (claims, collector, recommend) для интеграционных
 * тестов агента: реализации там — заглушки `not implemented`. Поведение
 * моков близко к контракту: проверяющий требует дословную цитату из видимой
 * строки и id из каталога; уровень — по типу источника; proposeClaims пишет
 * реальные строки Claim (нужны start_verification и get_profile).
 */
import { vi } from 'vitest';

import type { Prisma } from '@prisma/client';

import type { CatalogEntry, ProfileView, ProposedClaim, VerifiedClaim, VerifyResult } from '@/server/claims/types';
import type { ExtractedDoc, ProfileKind, SourceKind } from '@/server/collector/types';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import type { Gap, TargetRec, TaskRec, TestRecommendation } from '@/server/recommend/types';

export const CATALOG: CatalogEntry[] = [
  { id: 'be.framework', specialization: 'backend', statement: 'Писал HTTP-эндпоинты на веб-фреймворке', grades: ['junior'], weight: 1, proof: ['task:crud-api'], markers: ['Flask', 'FastAPI', 'Django', 'эндпоинт'], limits: 'Резюме не подтверждает умение сейчас' },
  { id: 'be.idempotency', specialization: 'backend', statement: 'Делал идемпотентную обработку запросов', grades: ['middle'], weight: 3, proof: ['task:payment-retry', 'interview:defend'], markers: ['идемпотент', 'Idempotency-Key'], limits: 'Резюме не подтверждает умение сейчас' },
  { id: 'be.distributed-consistency', specialization: 'backend', statement: 'Обеспечивал согласованность между сервисами', grades: ['middle'], weight: 3, proof: ['interview:defend'], markers: ['saga', 'outbox'], limits: '' },
  { id: 'be.service-boundaries', specialization: 'backend', statement: 'Выделял границы сервисов', grades: ['middle'], weight: 2, proof: ['interview:defend'], markers: ['границы сервисов'], limits: '' },
  { id: 'fe.forms', specialization: 'frontend', statement: 'Делал формы с валидацией', grades: ['junior'], weight: 1, proof: ['task:form-validation'], markers: ['форм', 'валидац'], limits: '' },
  { id: 'fe.ssr', specialization: 'frontend', statement: 'Настраивал серверный рендеринг', grades: ['middle'], weight: 2, proof: ['interview:defend'], markers: ['SSR', 'серверный рендеринг'], limits: '' },
  { id: 'common.ci-basics', specialization: 'common', statement: 'Настраивал запуск тестов в CI', grades: ['junior', 'middle'], weight: 1, proof: ['task:ci-pipeline'], markers: ['GitLab CI', 'GitHub Actions', 'CI'], limits: '' },
];

export const LEVEL_BY_KIND: Record<SourceKind, VerifiedClaim['level']> = {
  resume: 'self_reported',
  document: 'self_reported',
  chat: 'self_reported',
  url: 'self_reported',
  github: 'artifact',
  stackoverflow: 'artifact',
  codeforces: 'third_party',
  fsp: 'third_party',
};

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function makeDoc(args: { kind?: SourceKind; origin?: string; title?: string; lines: string[]; hidden?: string[]; injectionSuspect?: boolean }): ExtractedDoc {
  const origin = args.origin ?? 'cv.pdf';
  return {
    sourceKind: args.kind ?? 'resume',
    title: args.title ?? origin,
    origin,
    lines: args.lines.map((text, i) => ({ ref: `${origin}#p1:l${i + 1}`, text })),
    text: args.lines.join('\n'),
    flags: {
      ...(args.hidden?.length ? { hiddenText: { count: args.hidden.length, sample: args.hidden } } : {}),
      ...(args.injectionSuspect ? { injectionSuspect: true } : {}),
    },
    fetchedAt: '2026-10-09T00:00:00.000Z',
  };
}

function verify(p: ProposedClaim[], docs: ExtractedDoc[], catalog: CatalogEntry[]): VerifyResult {
  const accepted: VerifiedClaim[] = [];
  const rejected: VerifyResult['rejected'] = [];
  const seen = new Set<string>();
  for (const claim of p) {
    const entry = catalog.find((e) => e.id === claim.catalogId);
    if (!entry) {
      rejected.push({ claim, reason: 'unknown_catalog_id' });
      continue;
    }
    if (seen.has(claim.catalogId)) {
      rejected.push({ claim, reason: 'duplicate' });
      continue;
    }
    const q = norm(claim.quote);
    const doc = docs.find((d) => {
      const hidden = new Set(d.flags.hiddenText?.sample ?? []);
      return d.lines.some((l) => !hidden.has(l.text) && norm(l.text).includes(q));
    });
    if (!doc || !q) {
      rejected.push({ claim, reason: 'no_quote' });
      continue;
    }
    seen.add(claim.catalogId);
    accepted.push({ ...claim, level: LEVEL_BY_KIND[doc.sourceKind], limits: entry.limits, suggestedProof: entry.proof, sourceKind: doc.sourceKind });
  }
  return { accepted, rejected };
}

export const claimsMock = {
  getCatalog: vi.fn(async () => CATALOG),
  maxLevelFor: vi.fn((kind: SourceKind) => LEVEL_BY_KIND[kind]),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- сигнатура контракта нужна для типизации mockImplementation
  extractClaims: vi.fn(async (doc: ExtractedDoc, catalog: CatalogEntry[]): Promise<ProposedClaim[]> => []),
  verifyClaims: vi.fn(verify),
  proposeClaims: vi.fn(async (candidateId: string, verified: VerifiedClaim[]) => {
    const rejectedBefore = await prisma.claim.findMany({ where: { candidateId, status: 'rejected' }, select: { catalogId: true } });
    const skip = new Set(rejectedBefore.map((r) => r.catalogId));
    const out = [];
    for (const v of verified) {
      if (skip.has(v.catalogId)) continue;
      out.push(
        await prisma.claim.create({
          data: {
            candidateId,
            catalogId: v.catalogId,
            statement: v.statement,
            level: v.level,
            quote: v.quote,
            sourceRef: v.sourceRef,
            sourceKind: v.sourceKind,
            confidence: v.confidence,
            limits: v.limits,
            suggestedProof: v.suggestedProof as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }
    return out;
  }),
  confirmClaim: vi.fn(),
  editClaim: vi.fn(),
  rejectClaim: vi.fn(),
  getProfile: vi.fn(async (candidateId: string): Promise<ProfileView> => {
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const cat = await prisma.candidateCategory.findFirst({ where: { candidateId } });
    const claims = await prisma.claim.findMany({ where: { candidateId }, orderBy: { createdAt: 'asc' } });
    const view: Omit<ProfileView, 'byLevel'> = {
      candidate: { id: c.id, name: c.name, specialization: c.specialization, fspState: c.fspState },
      category: cat ? { specialization: cat.specialization, grade: cat.grade, confirmedAt: cat.confirmedAt.toISOString() } : null,
      claims: claims.map((k) => ({
        id: k.id,
        catalogId: k.catalogId,
        statement: k.statement,
        level: k.level,
        quote: k.quote,
        sourceRef: k.sourceRef,
        sourceKind: k.sourceKind,
        limits: k.limits,
        suggestedProof: (k.suggestedProof as string[]) ?? [],
        status: k.status,
        createdAt: k.createdAt.toISOString(),
        confirmedAt: k.confirmedAt?.toISOString() ?? null,
      })),
    };
    const byLevel: ProfileView['byLevel'] = { platform: [], third_party: [], artifact: [], self_reported: [] };
    for (const cl of view.claims) byLevel[cl.level].push(cl);
    return { ...view, byLevel };
  }),
};

export const GITHUB_DOC = makeDoc({
  kind: 'github',
  origin: 'github:demo-ryabinin',
  title: 'github.com/demo-ryabinin',
  lines: ['demo-ryabinin/payments-idempotency: Go-сервис приёма платежей', 'README: ключ идемпотентности в заголовке Idempotency-Key, повтор запроса возвращает сохранённый результат', 'CI: GitHub Actions'],
});

const BLOCKED_RE = /^(https?:\/\/)?(localhost|127\.|169\.254\.|10\.|192\.168\.|\[::1\])/i;

export const collectorMock = {
  extractFile: vi.fn(),
  fetchUrl: vi.fn(async (url: string): Promise<ExtractedDoc> => {
    if (BLOCKED_RE.test(url.replace(/^https?:\/\//, ''))) throw new AppError('blocked_url', 'Адрес запрещён фильтром SSRF', 400);
    return makeDoc({ kind: 'url', origin: url, title: new URL(url).host, lines: ['Портфолио: лендинги и формы с валидацией на чистом JS'] });
  }),
  fetchProfile: vi.fn(async (kind: ProfileKind, handle: string): Promise<ExtractedDoc> => {
    if (kind === 'github') return { ...GITHUB_DOC, origin: `github:${handle}` };
    if (kind === 'fsp') return makeDoc({ kind: 'fsp', origin: `fsp:${handle}`, lines: ['Нет достижений'] });
    return makeDoc({ kind, origin: `${kind}:${handle}`, lines: ['Рейтинг 1400'] });
  }),
  maskContacts: vi.fn((text: string) => {
    let masked = 0;
    const out = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+|\+7[\d\s()-]{10,}/g, () => {
      masked++;
      return '[скрыто]';
    });
    return { text: out, masked };
  }),
};

export const TARGETS: TargetRec[] = [
  { vacancyId: 'v1', companyId: 'co1', companyName: 'Альфа-Финтех', title: 'Backend-разработчик (платежи)', specialization: 'backend', grade: 'middle', salaryFrom: 180000, salaryTo: 260000, covered: 4, total: 6, missing: [{ catalogId: 'be.distributed-consistency', statement: 'Обеспечивал согласованность между сервисами' }], reason: 'закрываешь 4 из 6, не хватает: согласованность между сервисами' },
  { vacancyId: 'v2', companyId: 'co2', companyName: 'Бета-Банк', title: 'Junior Backend', specialization: 'backend', grade: 'junior', salaryFrom: 90000, salaryTo: 130000, covered: 3, total: 3, missing: [], reason: 'закрываешь 3 из 3' },
];
export const TEST_REC: TestRecommendation = { specialization: 'backend', grade: 'middle', reason: 'подтверждено 2 из 3 утверждений Middle', allowed: true };
export const TASKS: TaskRec[] = [{ taskId: 'task:payment-retry', title: 'Повтор платежа без дубля', family: 'payments', grade: 'middle', closes: ['be.idempotency'], reason: 'закрывает be.idempotency' }];
export const GAPS: Gap[] = [{ id: 'be.distributed-consistency', catalogId: 'be.distributed-consistency', statement: 'Обеспечивал согласованность между сервисами', weight: 3, currentLevel: null, priority: 3, suggestedProof: ['interview:defend'] }];

export const recommendMock = {
  recommendTargets: vi.fn(async (_c: string, limit: number) => TARGETS.slice(0, limit)),
  recommendTest: vi.fn(async () => TEST_REC),
  recommendTasks: vi.fn(async (_c: string, gapIds: string[], limit: number) => TASKS.filter((t) => t.closes.some((x) => gapIds.includes(x))).slice(0, limit)),
  gapMap: vi.fn(async () => GAPS),
  explainInvitation: vi.fn(async (_c: string, invitationId: string) => ({ invitationId, vacancyId: 'v1', items: [], score: 0.6, covered: 4, total: 6, explanation: 'закрыто 4 из 6' })),
};

export async function seedCatalog(): Promise<void> {
  await prisma.claimCatalog.createMany({
    data: CATALOG.map((e) => ({ id: e.id, specialization: e.specialization, statement: e.statement, grades: e.grades, weight: e.weight, proof: e.proof, markers: e.markers, limits: e.limits })),
  });
}

export async function seedCandidate(id = 'cand-a', name = 'Кандидат А') {
  return prisma.candidate.create({ data: { id, email: `${id}@example.test`, name } });
}

export async function seedUpload(candidateId: string, doc: ExtractedDoc, filename = 'cv.pdf') {
  return prisma.upload.create({
    data: {
      candidateId,
      filename,
      mime: 'application/pdf',
      sha256: `${candidateId}-${filename}-${Math.random()}`,
      size: doc.text.length,
      extracted: doc as unknown as Prisma.InputJsonValue,
      flags: doc.flags as unknown as Prisma.InputJsonValue,
    },
  });
}

export function resetMocks(): void {
  for (const m of [claimsMock, collectorMock, recommendMock]) for (const fn of Object.values(m)) fn.mockClear();
  claimsMock.extractClaims.mockImplementation(async () => []);
}
