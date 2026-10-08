import { extractClaims } from '@/server/claims/extractor';
import { catalogFromFile } from '@/server/claims/catalog-file';
import { registerExtractorDemoStub } from '@/server/claims/stub-demo';
import { clearStubResponses, createStubProvider } from '@/server/llm/providers';
import type { ExtractedDoc } from '@/server/collector/types';

afterEach(() => clearStubResponses());

const doc = (lines: string[]): ExtractedDoc => ({
  sourceKind: 'resume',
  title: 'cv.pdf',
  origin: 'cv.pdf',
  lines: lines.map((text, i) => ({ ref: `cv.pdf#p1:l${i + 1}`, text })),
  text: lines.join('\n'),
  flags: {},
  fetchedAt: '2026-10-09T00:00:00.000Z',
});

describe('демо-заглушка извлекателя (LLM_STUB_DEMO)', () => {
  const resume = doc(['Иван, backend', 'Опыт:', 'Разработал идемпотентный приём платежей с ключом идемпотентности в PostgreSQL']);

  it('без регистрации заглушка извлекателя ничего не находит', async () => {
    expect(await extractClaims(resume, catalogFromFile(), createStubProvider())).toEqual([]);
  });

  it('с регистрацией — утверждения словарём каталога с координатой строки', async () => {
    registerExtractorDemoStub();
    const out = await extractClaims(resume, catalogFromFile(), createStubProvider());
    expect(out.map((c) => c.catalogId)).toContain('be.idempotency');
    expect(out.find((c) => c.catalogId === 'be.idempotency')?.sourceRef).toBe('cv.pdf#p1:l3');
  });
});
