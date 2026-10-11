import { signExpertToken } from '@/server/expert';
import { signAdminToken, signPreToken, verifyAdminToken, verifyPreToken } from '@/server/admin/session';
import { parseSession, signUserSession } from '@/server/session';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000;

describe('кука персонала fsp_admin: отдельный домен подписи', () => {
  it('своя подпись принимается, истёкшая и подделанная — нет', () => {
    const t = signAdminToken('sess1', SECRET, NOW);
    expect(verifyAdminToken(t, SECRET, NOW + 1)).toBe('sess1');
    expect(verifyAdminToken(t, SECRET, NOW + 13 * 3600)).toBeNull();
    expect(verifyAdminToken(t.replace('sess1', 'sess2'), SECRET, NOW + 1)).toBeNull();
    expect(verifyAdminToken(t, 'other-secret', NOW + 1)).toBeNull();
  });

  it('пользовательская cid и кука эксперта не принимаются как кука персонала', () => {
    const cid = signUserSession({ userId: 'u1', role: 'employer', employerProfileId: 'e1' }, SECRET, NOW);
    expect(verifyAdminToken(cid, SECRET, NOW + 1)).toBeNull();
    expect(verifyAdminToken(signExpertToken('c1', SECRET, NOW), SECRET, NOW + 1)).toBeNull();
    // и наоборот: кука персонала — не сессия пользователя
    expect(parseSession(signAdminToken('sess1', SECRET, NOW), SECRET, NOW + 1)).toBeNull();
  });

  it('та же полезная нагрузка с подписью другого домена (эксперт) отвергается', () => {
    const forged = signExpertToken('sess1', SECRET, NOW).replace(/^x\./, 'a.');
    expect(verifyAdminToken(forged, SECRET, NOW + 1)).toBeNull();
  });

  it('промежуточный токен: 5 минут, не взаимозаменяем с сессионным', () => {
    const p = signPreToken('staff1', 'pv123', SECRET, NOW);
    expect(verifyPreToken(p, SECRET, NOW + 60)).toEqual({ staffId: 'staff1', pv: 'pv123' });
    expect(verifyPreToken(p, SECRET, NOW + 301)).toBeNull();
    expect(verifyAdminToken(p, SECRET, NOW + 60)).toBeNull();
    expect(verifyPreToken(signAdminToken('staff1', SECRET, NOW), SECRET, NOW + 60)).toBeNull();
  });
});
