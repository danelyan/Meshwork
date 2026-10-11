'use client';

import { stableSentences } from '@/lib/sentences';
import { MAX_TTS_PARTS } from '@/lib/tts-parts';

import type { CompanionVoice } from '../avatar/voice';
import { planRest } from '../call/useReplySpeech';

/** Предложений озвучиваем прямо из потока, остаток – частями по приходу реплики целиком (лимит /api/tts – 20 в минуту). */
const STREAM_SENTENCES = MAX_TTS_PARTS - 1;

type SpeechEvent = { type: string; id?: string; text?: string };

/**
 * Озвучка ответа чата по мере стриминга (решение владельца 11.10: голос стартует, как только текст появился).
 * Готовые предложения из дельт (`stableSentences` – уже не изменятся) уходят в очередь голоса сразу, реплика
 * целиком досказывает остаток (`planRest`). Ключ части – `${id}#…`: пузырь и «стоп» узнают реплику по префиксу.
 */
export function createStreamSpeech(voice: () => CompanionVoice | null | undefined) {
  const streams = new Map<string, { text: string; spoken: string[] }>();
  return (ev: SpeechEvent) => {
    const v = voice();
    if (ev.type === 'delta' && ev.id) {
      const cur = streams.get(ev.id) ?? { text: '', spoken: [] };
      streams.set(ev.id, cur);
      cur.text += ev.text ?? '';
      if (!v?.enabled) return;
      const ready = stableSentences(cur.text);
      while (cur.spoken.length < Math.min(ready.length, STREAM_SENTENCES)) {
        const n = cur.spoken.length;
        cur.spoken.push(ready[n]!);
        v.speak(ready[n]!, `${ev.id}#s${n}`);
      }
      return;
    }
    if (ev.type === 'discard' && ev.id) {
      streams.delete(ev.id);
      if (v?.speakingKey && isSpeakKeyOf(v.speakingKey, ev.id)) v.stop();
      return;
    }
    if (ev.type !== 'message' || !ev.text) return;
    if (!ev.id) {
      v?.speak(ev.text);
      return;
    }
    const spoken = streams.get(ev.id)?.spoken ?? [];
    streams.delete(ev.id);
    const plan = planRest(ev.text, spoken);
    plan.parts.forEach((p, i) => {
      if (p.text) v?.speak(p.text, `${ev.id}#p${plan.from + i}`);
    });
  };
}

/** Звучит часть этой реплики: ключ целиком (повтор «озвучить») или `${key}#…` (части из потока). */
export function isSpeakKeyOf(speakingKey: string, key: string): boolean {
  return speakingKey === key || speakingKey.startsWith(`${key}#`);
}
