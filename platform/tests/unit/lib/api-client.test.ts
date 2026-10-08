import { answerDefenseApi, getRecommendations, startDefenseApi, uploadFile } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (m: ReturnType<typeof vi.fn>, i = 0) => m.mock.calls[i] as unknown as [string, RequestInit | undefined];

describe('клиент API ↔ реальные роуты', () => {
  it('uploads: ответ collector {uploadId, deduplicated, doc}', async () => {
    const f = vi.fn(async () => json({ uploadId: 'u1', deduplicated: true, doc: { title: 'cv.pdf', sourceKind: 'resume', lines: 3, pages: 1, flags: {}, preview: '' } }, 201));
    vi.stubGlobal('fetch', f);
    const r = await uploadFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }));
    expect(r).toEqual({ id: 'u1', filename: 'cv.pdf', deduplicated: true });
    expect(call(f)[0]).toBe('/api/uploads');
    expect((call(f)[1]?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('recommendations: target уходит в query, без него — без query', async () => {
    const f = vi.fn(async () => json({ target: 'category:backend:junior', test: {}, gaps: [], tasks: [], targets: [] }));
    vi.stubGlobal('fetch', f);
    expect((await getRecommendations()).target).toBe('category:backend:junior');
    await getRecommendations('vacancy:v-1');
    expect(call(f, 0)[0]).toBe('/api/recommendations');
    expect(call(f, 1)[0]).toBe('/api/recommendations?target=vacancy%3Av-1');
  });

  it('defense: старт {claimId}, ответ POST /api/defense/[id] {answer} → {next | verdict}', async () => {
    const f = vi
      .fn()
      .mockImplementationOnce(async () => json({ sessionId: 's1', question: { index: 0, question: 'Почему?' }, resumed: false }, 201))
      .mockImplementationOnce(async () => json({ next: { index: 1, question: 'А дальше?' } }))
      .mockImplementationOnce(async () => json({ verdict: { passed: true, total: 6 } }));
    vi.stubGlobal('fetch', f);
    expect(await startDefenseApi('c1')).toMatchObject({ sessionId: 's1', resumed: false });
    expect(JSON.parse(call(f, 0)[1]?.body as string)).toEqual({ claimId: 'c1' });
    expect(await answerDefenseApi('s1', 'потому что')).toEqual({ sessionId: 's1', question: { index: 1, question: 'А дальше?' } });
    expect(call(f, 1)[0]).toBe('/api/defense/s1');
    expect(JSON.parse(call(f, 1)[1]?.body as string)).toEqual({ answer: 'потому что' });
    expect(await answerDefenseApi('s1', 'итог')).toMatchObject({ sessionId: 's1', verdict: { passed: true } });
  });
});
