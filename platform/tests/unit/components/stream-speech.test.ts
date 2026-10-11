import { describe, expect, it, vi } from 'vitest';

import type { CompanionVoice } from '@/components/avatar/voice';
import { createStreamSpeech, isSpeakKeyOf } from '@/components/chat/stream-speech';

function fakeVoice(enabled = true) {
  const speak = vi.fn();
  const stop = vi.fn();
  return { voice: { enabled, speak, stop, speakingKey: null } as unknown as CompanionVoice, speak, stop };
}

describe('озвучка по мере стриминга', () => {
  it('готовое предложение звучит до конца реплики, остаток — по реплике целиком', () => {
    const { voice, speak } = fakeVoice();
    const on = createStreamSpeech(() => voice);
    on({ type: 'delta', id: 'm1', text: 'Я Кира, помогаю с карьерой. ' });
    expect(speak).not.toHaveBeenCalled(); // хвост ещё короткий — предложение может склеиться
    on({ type: 'delta', id: 'm1', text: 'Работаю на твоей стороне' });
    expect(speak).toHaveBeenCalledWith('Я Кира, помогаю с карьерой.', 'm1#s0');
    on({ type: 'message', id: 'm1', text: 'Я Кира, помогаю с карьерой. Работаю на твоей стороне.' });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak.mock.calls[1]).toEqual(['Работаю на твоей стороне.', 'm1#p1']);
  });

  it('выключенная озвучка ничего не ставит в очередь из потока', () => {
    const { voice, speak } = fakeVoice(false);
    const on = createStreamSpeech(() => voice);
    on({ type: 'delta', id: 'm1', text: 'Первое предложение готово. Второе тоже пишется' });
    expect(speak).not.toHaveBeenCalled();
  });

  it('ключ части узнаётся по префиксу реплики', () => {
    expect(isSpeakKeyOf('m1#s0', 'm1')).toBe(true);
    expect(isSpeakKeyOf('m1', 'm1')).toBe(true);
    expect(isSpeakKeyOf('m10#s0', 'm1')).toBe(false);
  });
});
