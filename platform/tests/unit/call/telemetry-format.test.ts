import { describe, expect, it } from 'vitest';

import { timingLine } from '@/components/call/CallPanel';
import { serverTiming } from '@/lib/call-api';

describe('телеметрия созвона: Server-Timing и строка панели', () => {
  it('serverTiming: метрика по имени, dur округляется, нет — null', () => {
    expect(serverTiming('stt;dur=812', 'stt')).toBe(812);
    expect(serverTiming('llm;dur=1510.4, first;dur=640;desc="x"', 'first')).toBe(640);
    expect(serverTiming('llm;dur=1510', 'stt')).toBeNull();
    expect(serverTiming(null, 'stt')).toBeNull();
    expect(serverTiming('stt;dur=abc', 'stt')).toBeNull();
  });

  it('timingLine: только известные шаги, секунды с запятой', () => {
    expect(timingLine({ index: 2, uploadMs: 812, endToFirstDeltaMs: null, endToReplyMs: 2100, endToSoundMs: 2350, streamed: false, ackMs: 200 })).toBe('речь→текст 0,8 с · реплика 2,1 с · звук 2,4 с · угу 0,2 с');
    expect(timingLine({ index: 2, uploadMs: null, endToFirstDeltaMs: 1400, endToReplyMs: null, endToSoundMs: 1600, streamed: true, ackMs: null })).toBe('текстом · поток 1,4 с · звук 1,6 с');
  });
});
