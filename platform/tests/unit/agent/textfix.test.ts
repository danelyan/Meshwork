import { readFileSync } from 'node:fs';

import { docLabel } from '@/server/agent/pipeline';
import { claimsStepText, countByReason, describeRejects } from '@/server/agent/tools/propose_claims';
import { DEMO_RESUMES, demoResumeFor } from '@/server/demo/resumes';
import type { ExtractedDoc } from '@/server/collector/types';

const doc = (over: Partial<ExtractedDoc>, n: number): ExtractedDoc =>
  ({ sourceKind: 'github', origin: 'https://github.com/demo-ryabinin', title: 'github demo-ryabinin (демо)', lines: Array.from({ length: n }, (_, i) => ({ ref: `r${i}`, text: 'x' })), flags: {}, text: '', ...over }) as unknown as ExtractedDoc;

describe('docLabel', () => {
  it('не дублирует вид источника и склоняет «строк»', () => {
    expect(docLabel(doc({}, 4))).toBe('github demo-ryabinin (демо) (4 строки)');
    expect(docLabel(doc({}, 29))).toBe('github demo-ryabinin (демо) (29 строк)');
    expect(docLabel(doc({}, 1))).toBe('github demo-ryabinin (демо) (1 строка)');
  });
  it('резюме: вид добавляется', () => {
    expect(docLabel(doc({ sourceKind: 'resume', title: 'cv.pdf' }, 2))).toBe('резюме cv.pdf (2 строки)');
  });
});

describe('причины отказа', () => {
  it('дубли — не отказ, а объединение повторов', () => {
    const r = ['duplicate', 'duplicate', 'duplicate'];
    expect(describeRejects(r)).toBe('');
    expect(claimsStepText(5, r)).toBe('нашёл 5, объединил 3 повтора одинаковых утверждений');
  });
  it('смесь причин', () => {
    const r = ['no_quote', 'unknown_catalog_id', 'duplicate', 'hidden_text'];
    expect(countByReason(r)).toEqual({ no_quote: 1, unknown_catalog_id: 1, duplicate: 1, hidden_text: 1 });
    expect(claimsStepText(2, r)).toBe('нашёл 2, отбросил 3 — 1 без цитаты в источнике, 1 вне каталога, 1 из скрытого текста, объединил 1 повтор одинаковых утверждений');
  });
});

describe('демо-резюме', () => {
  it('у всех трёх кандидатов есть файл и ссылка', () => {
    for (const id of ['demo-backend-strong', 'demo-frontend-mid', 'demo-injection']) {
      const r = demoResumeFor(id);
      expect(r?.fileName).toMatch(/^demo-\d\.pdf$/);
      expect(r?.link).toMatch(/^https:\/\/github\.com\/demo-/);
    }
    expect(Object.keys(DEMO_RESUMES)).toHaveLength(3);
  });
});

describe('каталог-сид', () => {
  it('limits без префикса «Не доказывает:»', () => {
    const j = readFileSync('prisma/seed/claims-catalog.json', 'utf8');
    expect(j).not.toMatch(/"limits": "Не доказывает/);
  });
});
