import { ATS_EVENT, buildAtsWebhook, sendAtsWebhook, signBody, verifySignature, type AtsStatusChange } from '@/server/employer/ats-webhook';
import { parseEnv } from '@/server/env';

const change: AtsStatusChange = { invitationId: 'inv1', status: 'accepted', companyId: 'co1', vacancyId: 'v1', candidateId: 'cand-secret-id' };
const SECRET = 'test-secret-value';
const NOW = new Date('2026-10-10T12:00:00Z');

describe('buildAtsWebhook', () => {
  it('заголовки, подпись HMAC-SHA256 по телу и идемпотентный id', () => {
    const h = buildAtsWebhook(change, SECRET, NOW);
    expect(h.headers['X-FSP-Event']).toBe(ATS_EVENT);
    expect(h.headers['X-FSP-Event-Id']).toBe(h.id);
    expect(h.headers['X-FSP-Signature']).toBe(signBody(h.body, SECRET));
    expect(h.headers['X-FSP-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(h.body, h.headers['X-FSP-Signature']!, SECRET)).toBe(true);
    expect(verifySignature(h.body, h.headers['X-FSP-Signature']!, 'другой секрет')).toBe(false);
    expect(verifySignature(h.body + ' ', h.headers['X-FSP-Signature']!, SECRET)).toBe(false);
    expect(buildAtsWebhook(change, SECRET, new Date('2027-01-01')).id).toBe(h.id);
    expect(buildAtsWebhook({ ...change, status: 'declined' }, SECRET, NOW).id).not.toBe(h.id);
  });

  it('в теле нет id кандидата, имени и контактов: псевдоним и флаг', () => {
    const body = JSON.parse(buildAtsWebhook(change, SECRET, NOW).body);
    expect(body.data).toMatchObject({ invitationId: 'inv1', status: 'accepted', contactsOpen: true, candidate: expect.stringMatching(/^Кандидат #[0-9A-F]{6}$/) });
    expect(JSON.stringify(body)).not.toContain('cand-secret-id');
    expect(buildAtsWebhook({ ...change, status: 'sent' }, SECRET).body).toContain('"contactsOpen":false');
  });
});

describe('sendAtsWebhook', () => {
  it('без url или секрета — no-op, сеть не трогается', async () => {
    const f = vi.fn();
    expect(await sendAtsWebhook(change, {}, f as never)).toBe(false);
    expect(await sendAtsWebhook(change, { url: 'https://ats.example/hook' }, f as never)).toBe(false);
    expect(await sendAtsWebhook(change, { secret: SECRET }, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('POST с подписанным телом; сбой сети не бросает', async () => {
    const ok = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await sendAtsWebhook(change, { url: 'https://ats.example/hook', secret: SECRET }, ok as never)).toBe(true);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ats.example/hook');
    expect(init.method).toBe('POST');
    expect(verifySignature(init.body as string, (init.headers as Record<string, string>)['X-FSP-Signature']!, SECRET)).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fail = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await sendAtsWebhook(change, { url: 'https://ats.example/hook', secret: SECRET }, fail as never)).toBe(false);
    warn.mockRestore();
  });
});

describe('env', () => {
  const base = { DATABASE_URL: 'postgresql://x', SESSION_SECRET: 'x'.repeat(32) };
  it('переменные ATS необязательны', () => {
    const e = parseEnv(base);
    expect(e.ATS_WEBHOOK_URL).toBeUndefined();
    expect(e.ATS_WEBHOOK_SECRET).toBeUndefined();
    expect(parseEnv({ ...base, ATS_WEBHOOK_URL: 'https://ats.example/h', ATS_WEBHOOK_SECRET: 's' }).ATS_WEBHOOK_URL).toBe('https://ats.example/h');
    expect(parseEnv({ ...base, ATS_WEBHOOK_URL: '', ATS_WEBHOOK_SECRET: '' }).ATS_WEBHOOK_URL).toBeUndefined();
  });
});
