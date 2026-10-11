import { describe, expect, it } from 'vitest';

import { principalFromClaims } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { ApiError } from '../src/http.js';

describe('principalFromClaims', () => {
  it('пользователь с fsp_id и ролью athlete — спортсмен', () => {
    const p = principalFromClaims({ sub: 'u1', azp: 'fsp-career', fsp_id: 'FSP-10001', realm_access: { roles: ['athlete', 'default-roles-fsp-id'] } });
    expect(p).toMatchObject({ kind: 'athlete', fspId: 'FSP-10001', clientId: 'fsp-career' });
  });

  it('сервисный аккаунт с ролью partner — партнёр без fsp_id', () => {
    const p = principalFromClaims({ sub: 'sa', azp: 'fsp-partner-demo', realm_access: { roles: ['partner'] } });
    expect(p).toMatchObject({ kind: 'partner', fspId: null, clientId: 'fsp-partner-demo' });
  });

  it('без нужной роли — 403', () => {
    expect(() => principalFromClaims({ sub: 'x', realm_access: { roles: ['uma_authorization'] } })).toThrow(ApiError);
    expect(() => principalFromClaims({ sub: 'x', fsp_id: 'FSP-10001' })).toThrow(/athlete/);
  });
});

describe('loadConfig', () => {
  it('выводит issuer и JWKS из PUBLIC_URL и KC_INTERNAL_URL, срезая завершающий слэш', () => {
    const c = loadConfig({ PUBLIC_URL: 'https://example.test/', KC_INTERNAL_URL: 'http://keycloak:8080/auth/' });
    expect(c.issuer).toBe('https://example.test/auth/realms/fsp-id');
    expect(c.jwksUrl).toBe('http://keycloak:8080/auth/realms/fsp-id/protocol/openid-connect/certs');
    expect(c.audience).toBe('fsp-api');
  });

  it('отклоняет неверный PUBLIC_URL', () => {
    expect(() => loadConfig({ PUBLIC_URL: 'not-a-url' })).toThrow(/PUBLIC_URL/);
  });
});
