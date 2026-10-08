import { decodeSse, encodeSse } from '@/server/agent/events';

describe('encodeSse', () => {
  it('один кадр `data: <json>\\n\\n`, перевод строки внутри текста экранирован', () => {
    const frame = encodeSse({ type: 'message', text: 'строка 1\nстрока 2' });
    expect(frame.startsWith('data: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.slice(0, -2)).not.toContain('\n');
    expect(JSON.parse(frame.slice(6))).toEqual({ type: 'message', text: 'строка 1\nстрока 2' });
  });

  it('U+2028/U+2029 уходят как \\u-последовательности', () => {
    const frame = encodeSse({ type: 'message', text: 'a\u2028b\u2029c' });
    expect(frame).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(frame.slice(6))).toEqual({ type: 'message', text: 'a\u2028b\u2029c' });
  });

  it('decodeSse разбирает поток обратно и оставляет неполный хвост', () => {
    const stream = encodeSse({ type: 'step', text: 'x' }) + encodeSse({ type: 'done' }) + 'data: {"type":"mess';
    const { events, rest } = decodeSse(stream);
    expect(events).toEqual([{ type: 'step', text: 'x' }, { type: 'done' }]);
    expect(rest).toBe('data: {"type":"mess');
  });
});
