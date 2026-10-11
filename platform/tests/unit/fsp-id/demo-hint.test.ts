import { resetEnvCache } from '@/server/env';
import { fspDemoHint } from '@/server/fsp-id/client';

describe('подсказка входа в симулятор ФСП ID (FSP_OIDC_DEMO_HINT)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });
  const withEnv = (env: Record<string, string>) => {
    for (const k of ['FSP_OIDC_ISSUER', 'FSP_OIDC_CLIENT_SECRET', 'FSP_OIDC_DEMO_HINT']) delete process.env[k];
    Object.assign(process.env, env);
    resetEnvCache();
  };
  const EXTERNAL = { FSP_OIDC_ISSUER: 'https://sim.example/auth/realms/fsp-id', FSP_OIDC_CLIENT_SECRET: 'client-secret' };

  it('внешний провайдер и подсказка заданы – текст как есть', () => {
    withEnv({ ...EXTERNAL, FSP_OIDC_DEMO_HINT: ' логин fsp-10001, пароль demo-pass ' });
    expect(fspDemoHint()).toBe('логин fsp-10001, пароль demo-pass');
  });

  it('внешний провайдер без подсказки – null', () => {
    withEnv(EXTERNAL);
    expect(fspDemoHint()).toBeNull();
  });

  it('встроенный мок (нет issuer или секрета) – null, даже если подсказка задана: там логин не спрашивают', () => {
    withEnv({ FSP_OIDC_DEMO_HINT: 'логин fsp-10001' });
    expect(fspDemoHint()).toBeNull();
    withEnv({ FSP_OIDC_ISSUER: EXTERNAL.FSP_OIDC_ISSUER, FSP_OIDC_DEMO_HINT: 'логин fsp-10001' });
    expect(fspDemoHint()).toBeNull();
  });
});
