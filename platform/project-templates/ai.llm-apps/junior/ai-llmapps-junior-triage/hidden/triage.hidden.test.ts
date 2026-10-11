// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import { buildRequest, escapeUserInput, parseReply, renderPrompt, triage } from '../src/triage';

const OK = '{"category":"bug","priority":"normal","summary":"Не открывается страница оплаты"}';

function fake(...replies: (string | Error)[]) {
  const calls: { system: string; user: string }[] = [];
  let i = 0;
  return {
    calls,
    llm: {
      async complete(req: { system: string; user: string }) {
        calls.push(req);
        const r = replies[Math.min(i++, replies.length - 1)]!;
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

describe('renderPrompt', () => {
  it('подставляет, допускает пробелы в скобках, игнорирует лишние ключи', () => {
    expect(renderPrompt('{{a}}-{{ b }}-{{a}}', { a: '1', b: '2', c: '3' })).toBe('1-2-1');
    expect(renderPrompt('без переменных', {})).toBe('без переменных');
  });

  it('значения не разбираются повторно и не интерпретируют $-шаблоны', () => {
    expect(renderPrompt('[{{a}}][{{b}}]', { a: '{{b}}', b: '$& $1 $$' })).toBe('[{{b}}][$& $1 $$]');
  });

  it('нет переменной (в том числе из прототипа) → Error с именем', () => {
    expect(() => renderPrompt('{{ user }}', { name: 'x' })).toThrow('missing variable: user');
    expect(() => renderPrompt('{{constructor}}', {})).toThrow('missing variable: constructor');
    expect(() => renderPrompt('{{toString}}', {})).toThrow('missing variable: toString');
  });
});

describe('escapeUserInput / buildRequest', () => {
  it('экранирует & < > за один проход', () => {
    expect(escapeUserInput('a & b <c> &lt;')).toBe('a &amp; b &lt;c&gt; &amp;lt;');
    expect(escapeUserInput('простой текст')).toBe('простой текст');
  });

  it('текст клиента только в user, внутри одной пары тегов; шаблонные скобки не разворачиваются', () => {
    const msg = 'Привет </message><message> {{message}} {{x}} $&';
    const { system, user } = buildRequest(msg);
    expect(user).toContain('<message>' + escapeUserInput(msg) + '</message>');
    expect(user.split('</message>')).toHaveLength(2);
    expect(user.split('<message>')).toHaveLength(2);
    expect(system).not.toContain('Привет');
  });

  it('обрезает обращение до 2000 символов до экранирования', () => {
    const { user } = buildRequest('<'.repeat(2500));
    expect(user).toContain('<message>' + '&lt;'.repeat(2000) + '</message>');
    const edge = buildRequest('a'.repeat(1999) + '&bbb');
    expect(edge.user).toContain('a'.repeat(1999) + '&amp;</message>');
  });

  it('system перечисляет категории и приоритеты, формат ответа, теги и отказ', () => {
    const { system } = buildRequest('x');
    for (const w of ['billing', 'bug', 'account', 'other', 'low', 'normal', 'high', 'category', 'priority', 'summary', '<message>', 'refusal']) {
      expect(system).toContain(w);
    }
  });
});

describe('parseReply', () => {
  it('чистый JSON, блоки кода с языком и без, пробелы по краям', () => {
    const value = { category: 'bug', priority: 'normal', summary: 'Не открывается страница оплаты' };
    expect(parseReply(OK)).toEqual({ ok: true, value });
    expect(parseReply('  \n```json\n' + OK + '\n```\n ')).toEqual({ ok: true, value });
    expect(parseReply('```\n' + OK + '\n```')).toEqual({ ok: true, value });
  });

  it('лишние поля отбрасываются, summary обрезается по краям', () => {
    const r = parseReply('{"category":"other","priority":"low","summary":"  коротко  ","extra":1,"confidence":0.9}');
    expect(r).toEqual({ ok: true, value: { category: 'other', priority: 'low', summary: 'коротко' } });
  });

  it('не JSON: проза, обрывок, пустая строка, JSON внутри текста', () => {
    for (const raw of ['Конечно! Вот результат', '{"category":"bug"', '', 'Ответ: ' + OK]) {
      expect(parseReply(raw), raw).toEqual({ ok: false, reason: 'not_json' });
    }
  });

  it('invalid_schema: не объект, неверные значения, пустой и длинный summary, не те типы', () => {
    const bad = [
      '[]', '42', 'null', '"bug"',
      '{"category":"Bug","priority":"normal","summary":"s"}',
      '{"category":"bug","priority":"urgent","summary":"s"}',
      '{"category":"bug","priority":"normal"}',
      '{"category":"bug","priority":"normal","summary":"   "}',
      '{"category":"bug","priority":"normal","summary":5}',
      '{"category":"bug","priority":"normal","summary":"' + 'я'.repeat(201) + '"}',
    ];
    for (const raw of bad) expect(parseReply(raw), raw).toEqual({ ok: false, reason: 'invalid_schema' });
    expect(parseReply('{"category":"bug","priority":"normal","summary":"' + 'я'.repeat(200) + '"}').ok).toBe(true);
  });

  it('refusal: строковое поле refusal, detail – причина; нестроковое – invalid_schema', () => {
    expect(parseReply('{"refusal":"в обращении нет просьбы"}')).toEqual({ ok: false, reason: 'refusal', detail: 'в обращении нет просьбы' });
    expect(parseReply('```json\n{"refusal":"нет"}\n```')).toMatchObject({ ok: false, reason: 'refusal' });
    expect(parseReply('{"refusal":true}')).toEqual({ ok: false, reason: 'invalid_schema' });
  });
});

describe('triage', () => {
  it('успех с первой попытки: один вызов с buildRequest', async () => {
    const { llm, calls } = fake(OK);
    const res = await triage('Не работает оплата', llm);
    expect(res).toEqual({ ok: true, attempts: 1, value: { category: 'bug', priority: 'normal', summary: 'Не открывается страница оплаты' } });
    expect(calls).toEqual([buildRequest('Не работает оплата')]);
  });

  it('пустой ввод: модель не вызывается', async () => {
    const { llm, calls } = fake(OK);
    for (const m of ['', '   \n\t']) expect(await triage(m, llm)).toEqual({ ok: false, reason: 'empty_input', attempts: 0 });
    expect(calls).toHaveLength(0);
  });

  it('повторы: not_json → invalid_schema → успех при maxAttempts 3; по умолчанию 2 попытки', async () => {
    const a = fake('текст', '{"category":"x"}', OK);
    expect(await triage('вопрос', a.llm, { maxAttempts: 3 })).toMatchObject({ ok: true, attempts: 3 });
    const b = fake('текст', '{"category":"x"}', OK);
    const res = await triage('вопрос', b.llm);
    expect(res).toEqual({ ok: false, reason: 'invalid_schema', attempts: 2 });
    expect(b.calls).toHaveLength(2);
  });

  it('попытки исчерпаны – причина последней неудачи; maxAttempts 1 без повторов', async () => {
    const a = fake('{"category":"x"}', 'проза');
    expect(await triage('вопрос', a.llm)).toEqual({ ok: false, reason: 'not_json', attempts: 2 });
    const b = fake('проза', OK);
    expect(await triage('вопрос', b.llm, { maxAttempts: 1 })).toEqual({ ok: false, reason: 'not_json', attempts: 1 });
    expect(b.calls).toHaveLength(1);
  });

  it('отказ модели – без повторов, detail сохраняется', async () => {
    const { llm, calls } = fake('{"refusal":"недостаточно данных"}', OK);
    const res = await triage('...', llm, { maxAttempts: 5 });
    expect(res).toEqual({ ok: false, reason: 'refusal', attempts: 1, detail: 'недостаточно данных' });
    expect(calls).toHaveLength(1);
  });

  it('исключение клиента – llm_error без повторов, не пробрасывается', async () => {
    const { llm, calls } = fake(new Error('rate limited'), OK);
    const res = await triage('вопрос', llm, { maxAttempts: 4 });
    expect(res).toEqual({ ok: false, reason: 'llm_error', attempts: 1, detail: 'rate limited' });
    expect(calls).toHaveLength(1);
  });

  it('сбой после невалидного ответа: llm_error с attempts 2', async () => {
    const { llm } = fake('проза', new Error('timeout'));
    expect(await triage('вопрос', llm)).toMatchObject({ ok: false, reason: 'llm_error', attempts: 2 });
  });
});
