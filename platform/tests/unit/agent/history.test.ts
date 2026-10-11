import type { Prisma } from '@prisma/client';

import { buildHistory, fitHistory, HISTORY_WINDOW, INTERRUPTED_TOOL_RESULT, OMITTED_NOTE } from '@/server/agent/history';
import type { ChatMessage } from '@/server/llm/types';

type Row = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls: Prisma.JsonValue; toolCallId: string | null };
const row = (role: Row['role'], content: string, extra: Partial<Row> = {}): Row => ({ role, content, toolCalls: null, toolCallId: null, ...extra });

describe('buildHistory', () => {
  it('system-строки не попадают в модель; toolCalls и toolCallId восстанавливаются', () => {
    const h = buildHistory([
      row('system', 'prompt:consultant-v1'),
      row('user', 'привет'),
      row('assistant', '', { toolCalls: [{ id: 'c1', name: 'get_profile', arguments: {} }] }),
      row('tool', '{}', { toolCallId: 'c1' }),
      row('assistant', 'готово'),
    ]);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(h[1]?.toolCalls?.[0]?.name).toBe('get_profile');
    expect(h[2]?.toolCallId).toBe('c1');
  });

  it('ход остановлен посреди пачки вызовов: вызовам без результата дописывается заглушка', () => {
    const calls = ['c1', 'c2', 'c3'].map((id) => ({ id, name: 'get_profile', arguments: {} }));
    const h = buildHistory([
      row('user', 'покажи профиль'),
      row('assistant', '', { toolCalls: calls }),
      row('tool', '{"ok":1}', { toolCallId: 'c1' }),
      // «Стоп»: c2 и c3 не выполнялись, следующего сообщения ассистента нет
      row('user', 'ещё раз'),
      row('assistant', '', { toolCalls: [{ id: 'd1', name: 'get_profile', arguments: {} }] }),
    ]);
    expect(h.map((m) => [m.role, m.toolCallId ?? null])).toEqual([
      ['user', null],
      ['assistant', null],
      ['tool', 'c1'],
      ['tool', 'c2'],
      ['tool', 'c3'],
      ['user', null],
      ['assistant', null],
      ['tool', 'd1'],
    ]);
    expect(h[2]?.content).toBe('{"ok":1}');
    for (const i of [3, 4, 7]) expect(h[i]?.content).toBe(INTERRUPTED_TOOL_RESULT);
    expect(JSON.parse(INTERRUPTED_TOOL_RESULT)).toMatchObject({ error: { code: 'aborted' } });
    // у каждого id из toolCalls ровно один результат
    for (const m of h.filter((x) => x.toolCalls?.length)) {
      for (const c of m.toolCalls ?? []) expect(h.filter((x) => x.role === 'tool' && x.toolCallId === c.id)).toHaveLength(1);
    }
  });

  it('полная пачка вызовов не меняется', () => {
    const rows = [
      row('user', 'привет'),
      row('assistant', '', { toolCalls: [{ id: 'c1', name: 't', arguments: {} }, { id: 'c2', name: 't', arguments: {} }] }),
      row('tool', 'раз', { toolCallId: 'c1' }),
      row('tool', 'два', { toolCallId: 'c2' }),
      row('assistant', 'готово'),
    ];
    expect(buildHistory(rows).map((m) => m.content)).toEqual(['привет', '', 'раз', 'два', 'готово']);
  });

  it('окно сдвигается к ближайшему user, чтобы не начинать с осиротевшего tool; старое – сводкой', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(row('user', `вопрос ${i}`));
      rows.push(row('assistant', '', { toolCalls: [{ id: `c${i}`, name: 't', arguments: {} }] }));
      rows.push(row('tool', `результат ${i}`, { toolCallId: `c${i}` }));
      rows.push(row('assistant', `ответ ${i}`));
    }
    const h = buildHistory(rows, { window: 10 });
    expect(h[0]?.role).toBe('user');
    expect(h[0]?.content).toContain('Сводка более ранней части диалога');
    expect(h[1]?.role).toBe('user');
    expect(h.length).toBeLessThanOrEqual(10 + 4);
    expect(h[h.length - 1]?.content).toBe('ответ 14');
  });

  it('старые результаты инструментов режутся, последний ход – нет', () => {
    const long = 'x'.repeat(5_000);
    const h = buildHistory(
      [
        row('user', 'a'),
        row('assistant', '', { toolCalls: [{ id: 'c1', name: 't', arguments: {} }] }),
        row('tool', long, { toolCallId: 'c1' }),
        row('assistant', 'ok'),
        row('user', 'b'),
        row('assistant', '', { toolCalls: [{ id: 'c2', name: 't', arguments: {} }] }),
        row('tool', long, { toolCallId: 'c2' }),
      ],
      { maxChars: 100 },
    );
    expect(h[2]?.content.length).toBeLessThan(200);
    expect(h[2]?.content).toContain('обрезано');
    expect(h[6]?.content.length).toBe(5_000);
  });

  it('короткая история отдаётся как есть', () => {
    const h = buildHistory([row('user', 'x')]);
    expect(h).toEqual([{ role: 'user', content: 'x' }]);
    expect(HISTORY_WINDOW).toBeGreaterThan(5);
  });
});

describe('fitHistory: бюджет контекста', () => {
  const m = (role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ role, content, ...extra });
  const turn = (i: number, size: number): ChatMessage[] => [
    m('user', `вопрос ${i}`),
    m('assistant', '', { toolCalls: [{ id: `c${i}`, name: 'get_profile', arguments: {} }] }),
    m('tool', 'x'.repeat(size), { toolCallId: `c${i}` }),
    m('assistant', `ответ ${i}`),
  ];

  it('влезает – возвращается как есть', () => {
    const h = [...turn(1, 100), m('user', 'ещё')];
    expect(fitHistory(h, 10_000)).toBe(h);
  });

  it('старые ходы выкидываются целыми с пометкой; последний ход цел', () => {
    const h = [...turn(1, 5_000), ...turn(2, 5_000), ...turn(3, 100), m('user', 'последний вопрос')];
    const out = fitHistory(h, 6_000);
    expect(out[0]?.content).toBe(OMITTED_NOTE);
    expect(out.at(-1)?.content).toBe('последний вопрос');
    expect(out.some((x) => x.content === 'вопрос 1')).toBe(false);
    expect(out.some((x) => x.content === 'вопрос 3')).toBe(true);
    // у каждого tool остался свой вызов
    const callIds = new Set(out.flatMap((x) => x.toolCalls ?? []).map((c) => c.id));
    for (const t of out.filter((x) => x.role === 'tool')) expect(callIds.has(t.toolCallId as string)).toBe(true);
  });

  it('последний ход сам не влез – его результаты инструментов режутся, структура сохраняется', () => {
    const h = [m('user', 'прочитай'), m('assistant', '', { toolCalls: [{ id: 'a', name: 'read_upload', arguments: {} }] }), m('tool', 'y'.repeat(50_000), { toolCallId: 'a' })];
    const out = fitHistory(h, 10_000);
    expect(out.map((x) => x.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out[2]!.content.length).toBeLessThan(11_000);
    expect(out[2]!.content).toContain('[… обрезано]');
  });
});
