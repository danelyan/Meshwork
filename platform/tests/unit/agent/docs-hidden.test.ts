import { parseExtractedDoc } from '@/server/agent/docs';
import { docToResult } from '@/server/agent/tools/shared';
import { extractClaims } from '@/server/claims/extractor';
import { extractByMarkers } from '@/server/claims/markers';
import type { CatalogEntry, ProposedClaim } from '@/server/claims/types';
import { verifyClaims } from '@/server/claims/verifier';
import type { ExtractedDoc } from '@/server/collector/types';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';
import type { CompleteRequest } from '@/server/llm/types';

const CATALOG: CatalogEntry[] = [
  {
    id: 'fe.ssr',
    specialization: 'frontend',
    statement: 'Делал серверный рендеринг',
    grades: ['middle'],
    weight: 2,
    proof: ['interview:defend'],
    markers: ['SSR', 'Next.js'],
    limits: 'Не доказывает: производительность',
  },
];

const HIDDEN = 'Делал SSR на Next.js для портала';

/** Документ так, как он лежит в Json-колонке: скрытая строка помечена признаком. */
function stored(lines: { text: string; hidden?: boolean }[], flags: ExtractedDoc['flags'] = {}): unknown {
  const ls = lines.map((l, i) => ({ ref: `cv.pdf#l${i + 1}`, ...l }));
  const doc: ExtractedDoc = {
    sourceKind: 'resume',
    title: 'cv.pdf',
    origin: 'cv.pdf',
    lines: ls,
    text: ls
      .filter((l) => !l.hidden)
      .map((l) => l.text)
      .join('\n'),
    flags,
    fetchedAt: '2026-10-11T00:00:00.000Z',
    meta: { pages: 2 },
  };
  return JSON.parse(JSON.stringify(doc)) as unknown;
}

function read(json: unknown): ExtractedDoc {
  const doc = parseExtractedDoc(json);
  if (!doc) throw new Error('документ не разобран');
  return doc;
}

afterEach(() => clearStubResponses());

describe('ExtractedDoc из Json-колонки: скрытые строки остаются скрытыми', () => {
  it('parseExtractedDoc сохраняет hidden у строки, meta и flags.maskedContacts', () => {
    const doc = read(stored([{ text: 'Верстаю лендинги' }, { text: HIDDEN, hidden: true }], { maskedContacts: 2 }));
    expect(doc.lines.map((l) => l.hidden ?? false)).toEqual([false, true]);
    expect(doc.flags.maskedContacts).toBe(2);
    expect(doc.meta).toEqual({ pages: 2 });
  });

  it('извлекатель не показывает модели скрытую строку загруженного файла', async () => {
    const calls: CompleteRequest[] = [];
    registerStubResponse('extractor', (req) => {
      calls.push(req);
      return { json: { claims: [] } };
    });
    const doc = read(stored([{ text: 'Верстаю лендинги' }, { text: HIDDEN, hidden: true }]));
    await extractClaims(doc, CATALOG, createStubProvider());
    const user = calls[0]?.messages[0]?.content ?? '';
    expect(user).toContain('L1: Верстаю лендинги');
    expect(user).not.toContain('SSR на Next.js');
  });

  it('словарный извлекатель не берёт утверждение из скрытой строки', () => {
    const lines = [{ text: '# Вера' }, { text: '## Опыт' }, { text: '- Верстаю лендинги' }];
    const doc = read(stored([...lines, { text: HIDDEN, hidden: true }]));
    expect(extractByMarkers(doc, CATALOG, { specialization: null })).toEqual([]);
    // та же строка видимой - утверждение находится: пусто выше именно из-за признака hidden
    const visible = read(stored([...lines, { text: HIDDEN }]));
    expect(extractByMarkers(visible, CATALOG, { specialization: null }).map((c) => c.catalogId)).toEqual(['fe.ssr']);
  });

  it('проверяющий отклоняет цитату из скрытой строки: hidden_text', () => {
    const doc = read(stored([{ text: 'Верстаю лендинги' }, { text: HIDDEN, hidden: true }]));
    const claim: ProposedClaim = { catalogId: 'fe.ssr', statement: 'x', quote: HIDDEN, sourceRef: 'cv.pdf#l2', confidence: 'high' };
    const r = verifyClaims([claim], [doc], CATALOG);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]?.reason).toBe('hidden_text');
  });
});

describe('docToResult: текст скрытых строк модели не отдаётся', () => {
  it('четвёртая скрытая строка и строка длиннее 160 знаков — образцов для них нет, фильтр по признаку', () => {
    const long = `Скрытая длинная строка ${'я'.repeat(200)}`;
    const hidden = ['скрытая один', 'скрытая два', 'скрытая три', 'скрытая четыре', long];
    const doc = read(
      stored([{ text: 'Видимая строка' }, ...hidden.map((text) => ({ text, hidden: true }))], {
        // как пишет сборщик: не больше трёх образцов, каждый обрезан до 160 знаков
        hiddenText: { count: hidden.length, sample: hidden.slice(0, 3).map((s) => s.slice(0, 160)) },
      }),
    );
    const r = docToResult(doc);
    expect(r.text).toBe('cv.pdf#l1\tВидимая строка');
    expect(r.hiddenText).toBe(5);
  });

  it('старая запись без признака hidden: строка отсеивается по образцу', () => {
    const doc = read(
      stored([{ text: 'Видимая строка' }, { text: 'скрытая без признака' }], {
        hiddenText: { count: 1, sample: ['скрытая без признака'] },
      }),
    );
    expect(docToResult(doc).text).toBe('cv.pdf#l1\tВидимая строка');
  });
});
