// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { answer, buildIndex, chunkText, loadCorpus, retrieve } from '../src/rag';

const DOCS = [
  { id: 'hr/vacation.md', text: 'Ежегодный оплачиваемый отпуск составляет 28 календарных дней. Заявление на отпуск подают за две недели.' },
  { id: 'hr/remote.md', text: 'Удалённо можно работать до трёх дней в неделю по согласованию с руководителем.' },
  { id: 'it/laptop.md', text: 'Ноутбук выдаёт ИТ-отдел в первый рабочий день. Пароль меняется каждые 90 дней.' },
  { id: 'it/vpn.txt', text: 'VPN обязателен при работе из дома. Клиент VPN ставится из портала самообслуживания.' },
];

function fakeLlm(reply: string | ((req: { system: string; user: string }) => string)) {
  const calls: { system: string; user: string }[] = [];
  return {
    calls,
    llm: {
      async complete(req: { system: string; user: string }) {
        calls.push(req);
        return typeof reply === 'function' ? reply(req) : reply;
      },
    },
  };
}

describe('chunkText', () => {
  it('схлопывает пробелы, окна по формуле, последний доходит до конца', () => {
    expect(chunkText('  a   b\n\nc  ', { size: 3, overlap: 1 })).toEqual(['a b', 'b c']);
    expect(chunkText('0123456789', { size: 5, overlap: 2 })).toEqual(['01234', '34567', '6789']);
    expect(chunkText('короткий', { size: 800, overlap: 100 })).toEqual(['короткий']);
  });

  it('по умолчанию 800/100; пустой текст – []', () => {
    const text = 'x'.repeat(1500);
    const chunks = chunkText(text);
    expect(chunks.map((c) => c.length)).toEqual([800, 800]);
    expect(chunks[1]).toBe(text.slice(700, 1500));
    expect(chunkText('   \n ')).toEqual([]);
  });

  it('overlap ≥ size или size < 1 – RangeError', () => {
    expect(() => chunkText('abc', { size: 3, overlap: 3 })).toThrow(RangeError);
    expect(() => chunkText('abc', { size: 0, overlap: 0 })).toThrow(RangeError);
  });
});

describe('loadCorpus и buildIndex', () => {
  it('рекурсивно .md и .txt, id через /, по алфавиту', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rag-'));
    try {
      mkdirSync(path.join(dir, 'b', 'c'), { recursive: true });
      writeFileSync(path.join(dir, 'z.md'), 'зет');
      writeFileSync(path.join(dir, 'b', 'c', 'deep.txt'), 'глубоко');
      writeFileSync(path.join(dir, 'b', 'a.md'), 'а');
      writeFileSync(path.join(dir, 'b', 'image.png'), 'png');
      writeFileSync(path.join(dir, 'notes.json'), '{}');
      const docs = await loadCorpus(dir);
      expect(docs.map((d) => d.id)).toEqual(['b/a.md', 'b/c/deep.txt', 'z.md']);
      expect(docs[1]!.text).toBe('глубоко');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chunkId = docId#n', () => {
    const idx = buildIndex([{ id: 'a.md', text: 'x'.repeat(30) }], { size: 10, overlap: 0 });
    const hits = retrieve(buildIndex([{ id: 'a.md', text: 'кот '.repeat(10) }], { size: 12, overlap: 0 }), 'кот', 10);
    expect(hits.map((h) => h.chunkId)).toEqual(['a.md#0', 'a.md#1', 'a.md#2', 'a.md#3']);
    expect(idx).toBeTruthy();
  });
});

describe('retrieve', () => {
  let idx: ReturnType<typeof buildIndex>;
  beforeAll(() => {
    idx = buildIndex(DOCS);
  });
  it('релевантный документ первым для разных запросов', () => {
    expect(retrieve(idx, 'Сколько дней длится ежегодный отпуск?')[0]!.docId).toBe('hr/vacation.md');
    expect(retrieve(idx, 'нужен ли VPN дома')[0]!.docId).toBe('it/vpn.txt');
    expect(retrieve(idx, 'кто выдаёт ноутбук')[0]!.docId).toBe('it/laptop.md');
  });

  it('без общих токенов – пусто; не больше k; оценки по убыванию', () => {
    expect(retrieve(idx, 'квантовая хромодинамика')).toEqual([]);
    const hits = retrieve(idx, 'дней работать отпуск пароль', 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(hits.every((h) => h.score > 0 && typeof h.text === 'string')).toBe(true);
  });

  it('редкий термин весит больше частого (IDF)', () => {
    const docs = [
      { id: 'a', text: 'дней дней дней дней правило' },
      { id: 'b', text: 'дней пароль' },
      { id: 'c', text: 'дней дней' },
    ];
    expect(retrieve(buildIndex(docs), 'дней пароль')[0]!.docId).toBe('b');
  });
});

describe('answer', () => {
  let idx: ReturnType<typeof buildIndex>;
  beforeAll(() => {
    idx = buildIndex(DOCS);
  });

  it('нет опоры – отказ без вызова модели', async () => {
    const f = fakeLlm('что-то');
    const res = await answer('квантовая хромодинамика', { index: idx, llm: f.llm });
    expect(res).toEqual({ answer: 'Не нашёл ответа в документах.', citations: [], refused: true });
    expect(f.calls).toHaveLength(0);
  });

  it('промпт: инструкции в system, чанки с заголовками [chunkId] в порядке ретрива', async () => {
    const f = fakeLlm('28 дней [hr/vacation.md#0]');
    await answer('Сколько дней длится ежегодный отпуск?', { index: idx, llm: f.llm });
    expect(f.calls).toHaveLength(1);
    const { system, user } = f.calls[0]!;
    expect(system).toMatch(/\[chunkId\]|\[[^\]]*#/i);
    expect(system.toLowerCase()).toMatch(/данн/);
    expect(user).toContain('Сколько дней длится ежегодный отпуск?');
    const order = retrieve(idx, 'Сколько дней длится ежегодный отпуск?').map((h) => h.chunkId);
    const pos = order.map((id) => user.indexOf(`[${id}]`));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('цитаты: порядок первого появления, без повторов, галлюцинации выброшены', async () => {
    const f = fakeLlm('См. [hr/vacation.md#0] и [secret/fake.md#3], ещё раз [hr/vacation.md#0], а также [hr/remote.md#0].');
    const res = await answer('отпуск дней работать', { index: idx, llm: f.llm, k: 3 });
    expect(res.refused).toBe(false);
    expect(res.citations).toEqual(['hr/vacation.md#0', 'hr/remote.md#0']);
    expect(res.answer).toContain('[secret/fake.md#3]');
  });

  it('модель без валидных ссылок – отказ', async () => {
    const f = fakeLlm('Отпуск 35 дней, источник [made/up.md#0].');
    const res = await answer('Сколько дней длится ежегодный отпуск?', { index: idx, llm: f.llm });
    expect(res).toEqual({ answer: 'Не нашёл ответа в документах.', citations: [], refused: true });
  });

  it('бюджет контекста и цитата не из промпта', async () => {
    const big = [
      { id: 'a.md', text: `отпуск ${'а'.repeat(500)}` },
      { id: 'b.md', text: `отпуск отпуск ${'б'.repeat(500)}` },
      { id: 'c.md', text: `отпуск отпуск отпуск ${'в'.repeat(500)}` },
    ];
    const index = buildIndex(big);
    const order = retrieve(index, 'отпуск').map((h) => h.chunkId);
    const f = fakeLlm((req) => `ответ [${order[1]}] [${order[0]}]`);
    const res = await answer('отпуск', { index, llm: f.llm, maxContextChars: 1100 });
    const user = f.calls[0]!.user;
    expect(user).toContain(`[${order[0]}]`);
    expect(user).toContain(`[${order[1]}]`);
    expect(user).not.toContain(`[${order[2]}]`);
    expect(res.citations).toEqual([order[1], order[0]]);
    const g = fakeLlm(`[${order[0]}]`);
    await answer('отпуск', { index, llm: g.llm, maxContextChars: 100 });
    expect(g.calls[0]!.user).toContain(`[${order[0]}]`);
    expect(g.calls[0]!.user).not.toContain(`[${order[1]}]`);
    expect(g.calls[0]!.user).not.toContain('а'.repeat(200));
  });
});
