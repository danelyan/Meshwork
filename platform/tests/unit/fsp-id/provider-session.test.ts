import { type FspOidcConfig, endProviderSession, httpTransport, resetFspOidcCache } from '@/server/fsp-id/client';
import { mockTransport } from '@/server/fsp-id/mock/provider';

const ISSUER = 'https://sim.example/auth/realms/fsp-id';
const OIDC = `${ISSUER}/protocol/openid-connect`;
const cfg: FspOidcConfig = { issuer: ISSUER, clientId: 'fsp-career', clientSecret: 'client-secret', apiUrl: null, redirectUri: 'https://app.example/api/fsp-id/callback' };
const discoveryDoc = (over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${OIDC}/auth`,
  token_endpoint: `${OIDC}/token`,
  jwks_uri: `${OIDC}/certs`,
  end_session_endpoint: `${OIDC}/logout`,
  ...over,
});

/** Подменённый fetch: discovery и logout endpoint провайдера; записывает запросы. */
function provider(logout: () => Response | Promise<Response>, doc: Record<string, unknown> = discoveryDoc()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return new Response(JSON.stringify(doc), { status: 200 });
    if (url === `${OIDC}/logout`) return logout();
    throw new Error(`unexpected fetch ${url}`);
  }));
  return calls;
}

describe('завершение сессии участника у внешнего провайдера ФСП ID', () => {
  beforeEach(resetFspOidcCache);
  afterEach(() => vi.unstubAllGlobals());

  it('POST на end_session_endpoint из discovery: refresh token и учётные данные клиента в теле', async () => {
    const calls = provider(() => new Response(null, { status: 204 }));
    await endProviderSession(httpTransport(cfg), 'refresh-token-value');
    const logout = calls.find((c) => c.url === `${OIDC}/logout`)!;
    expect(logout.init!.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(logout.init!.body)))).toEqual({
      client_id: 'fsp-career',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token-value',
    });
  });

  it('сбой завершения (сеть, отказ провайдера) вход не роняет и токен в лог не пишет', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    provider(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(endProviderSession(httpTransport(cfg), 'refresh-token-value')).resolves.toBeUndefined();
    provider(() => { throw new TypeError('fetch failed'); });
    await expect(endProviderSession(httpTransport(cfg), 'refresh-token-value')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('refresh-token-value');
    warn.mockRestore();
  });

  it('провайдер без end_session_endpoint, без refresh token или встроенный мок — запроса нет', async () => {
    let calls = provider(() => new Response(null, { status: 204 }), discoveryDoc({ end_session_endpoint: undefined }));
    await endProviderSession(httpTransport(cfg), 'refresh-token-value');
    expect(calls.filter((c) => c.url === `${OIDC}/logout`)).toHaveLength(0);

    resetFspOidcCache();
    calls = provider(() => new Response(null, { status: 204 }));
    await endProviderSession(httpTransport(cfg), null);
    await endProviderSession(mockTransport('https://app.example'), 'refresh-token-value');
    expect(calls).toHaveLength(0);
  });
});
