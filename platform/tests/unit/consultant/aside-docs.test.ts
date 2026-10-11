import { loadCandidateDocs } from '@/server/consultant/aside';

const db = vi.hoisted(() => ({ uploads: vi.fn(), sources: vi.fn(), claims: vi.fn() }));
vi.mock('@/server/db', () => ({
  prisma: { upload: { findMany: db.uploads }, source: { findMany: db.sources }, claim: { findMany: db.claims } },
}));

beforeEach(() => vi.resetAllMocks());

describe('документы в колонке консультанта: статус ссылки', () => {
  it('утверждения ссылки считаются по sourceRef, как у файлов (Claim.sourceId не заполняется)', async () => {
    db.uploads.mockResolvedValue([{ id: 'u1', filename: 'cv.pdf', extracted: {}, storageKey: 'k' }]);
    // claims: [] – так отвечает база: связь Claim.sourceId конвейер не пишет
    db.sources.mockResolvedValue([
      { id: 's-gh', kind: 'github', origin: 'github:octo', claims: [] },
      { id: 's-url', kind: 'url', origin: 'https://example.test/cv', claims: [] },
      { id: 's-cf', kind: 'codeforces', origin: 'codeforces:tourist', claims: [] },
    ]);
    db.claims.mockResolvedValue([
      { sourceRef: 'cv.pdf#p1:l3' },
      { sourceRef: 'github:octo#profile:l2' },
      { sourceRef: 'github:octo/payments#README:l4..github:octo/payments#README:l5' },
      { sourceRef: 'https://example.test/cv#l7' },
      // чужие источники с похожим началом не считаются
      { sourceRef: 'github:octocat/repo#meta:l1' },
      { sourceRef: 'https://example.test/cv/other#l1' },
    ]);
    const docs = await loadCandidateDocs('c1');
    expect(docs.map((d) => [d.id, d.status])).toEqual([
      ['u1', 'разобран, 1 утверждение'],
      ['s-gh', 'разобран, 2 утверждения'],
      ['s-url', 'разобран, 1 утверждение'],
      ['s-cf', 'разобран, утверждений нет'],
    ]);
  });
});
