import { describe, expect, it } from 'vitest';

import { signExpertToken, verifyExpertToken } from '@/server/expert';
import { parseSession, signSession } from '@/server/session';

const SECRET = 'x'.repeat(32);
const NOW = 1_800_000_000;

describe('кука эксперта', () => {
  it('подпись и проверка; подделка, чужой секрет и срок — null', () => {
    const t = signExpertToken('cand1', SECRET, NOW);
    expect(verifyExpertToken(t, SECRET, NOW + 10)).toBe('cand1');
    expect(verifyExpertToken(t.replace('cand1', 'cand2'), SECRET, NOW)).toBeNull();
    expect(verifyExpertToken(t, 'y'.repeat(32), NOW)).toBeNull();
    expect(verifyExpertToken(t, SECRET, NOW + 25 * 3600)).toBeNull();
  });

  it('токен эксперта не принимается как сессия cid, и наоборот', () => {
    expect(parseSession(signExpertToken('cand1', SECRET, NOW), SECRET, NOW)).toBeNull();
    expect(verifyExpertToken(signSession('cand1', SECRET, NOW), SECRET, NOW)).toBeNull();
  });
});
