import { createSseParser, parseAgentEvent, parseSseChunks } from '@/lib/sse';
import { encodeSseForTest } from './sse-helper';

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe('SSE-парсер', () => {
  it('разбирает один кадр', () => {
    expect(parseSseChunks([frame({ type: 'step', text: 'читаю резюме' })])).toEqual([{ type: 'step', text: 'читаю резюме' }]);
  });

  it('несколько событий в одном чанке', () => {
    const chunk = frame({ type: 'step', text: 'a' }) + frame({ type: 'queue', position: 2 }) + frame({ type: 'done' });
    expect(parseSseChunks([chunk]).map((e) => e.type)).toEqual(['step', 'queue', 'done']);
  });

  it('кадр разрезан между чанками в любом месте', () => {
    const full = frame({ type: 'message', text: 'Привет, мир' }) + frame({ type: 'done' });
    for (let cut = 1; cut < full.length; cut++) {
      const events = parseSseChunks([full.slice(0, cut), full.slice(cut)]);
      expect(events.map((e) => e.type)).toEqual(['message', 'done']);
    }
  });

  it('побайтовая подача даёт тот же результат', () => {
    const full = frame({ type: 'ask', question: 'Backend?', options: ['да', 'нет'] }) + frame({ type: 'done' });
    expect(parseSseChunks([...full]).map((e) => e.type)).toEqual(['ask', 'done']);
  });

  it('граница кадра \\n\\n между чанками', () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"done"}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ type: 'done' }]);
  });

  it('CRLF-разделители', () => {
    expect(parseSseChunks(['data: {"type":"done"}\r\n\r\ndata: {"type":"step","text":"x"}\r\n\r\n']).map((e) => e.type)).toEqual(['done', 'step']);
  });

  it('игнорирует мусор, комментарии, невалидный JSON и неизвестные типы', () => {
    const chunk = [
      ': keep-alive\n\n',
      'data: not json\n\n',
      'data: {"type":"unknown"}\n\n',
      'data: 42\n\n',
      'data: null\n\n',
      'event: ping\n\n',
      'random garbage without frame end',
      '\n\n',
      frame({ type: 'done' }),
    ];
    expect(parseSseChunks(chunk)).toEqual([{ type: 'done' }]);
  });

  it('data без пробела после двоеточия и многострочный data', () => {
    expect(parseSseChunks(['data:{"type":"done"}\n\n'])).toEqual([{ type: 'done' }]);
    expect(parseSseChunks(['data: {"type":\ndata: "done"}\n\n'])).toEqual([{ type: 'done' }]);
  });

  it('flush разбирает хвост без завершающей пустой строки', () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"done"}')).toEqual([]);
    expect(p.flush()).toEqual([{ type: 'done' }]);
    expect(p.flush()).toEqual([]);
  });

  it('кириллица и эмодзи в тексте целы', () => {
    const e = parseSseChunks([frame({ type: 'message', text: 'Нашёл 11 утверждений 🎯' })]);
    expect(e[0]).toEqual({ type: 'message', text: 'Нашёл 11 утверждений 🎯' });
  });

  it('parseAgentEvent отклоняет не-объекты', () => {
    expect(parseAgentEvent('"str"')).toBeNull();
    expect(parseAgentEvent('[]')).toBeNull();
    expect(parseAgentEvent('{"type":5}')).toBeNull();
  });

  it('совместим с форматом сервера «data: json\\n\\n»', () => {
    expect(encodeSseForTest({ type: 'done' })).toBe('data: {"type":"done"}\n\n');
  });
});
