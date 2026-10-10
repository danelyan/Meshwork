import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement } from 'react';

import { bodyRole } from '@/components/shell/bodyRole';

const page = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('@/server/auth/page', () => ({ getPageSession: async () => page.session }));
vi.mock('next/font/google', () => ({ Golos_Text: () => ({ variable: 'golos' }) }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'mono' }) }));
vi.mock('@/components/devtools/DevPanelGate', () => ({ DevPanelGate: () => null }));
vi.mock('@/components/auth/AuthEntry', () => ({ AuthEntry: () => null }));
vi.mock('@/components/shell/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/shell/ShellFrame', () => ({ ShellFrame: () => null }));
vi.mock('@/server/auth/role-switch', () => ({ headerAccountFor: async () => null }));
vi.mock('@/server/auth/yandex', () => ({ yandexConfig: () => null }));
vi.mock('@/server/env', () => ({ getEnv: () => ({ DEMO_LOGIN: false }) }));
vi.mock('@/server/stt', () => ({ sttMode: () => 'off' }));

const principal = (role: string) => ({ userId: 'u1', role, candidateId: null, employerProfileId: null });

describe('bodyRole', () => {
  it('candidate и employer пропускает как есть, гость и pending - без роли', () => {
    expect(bodyRole(principal('candidate'))).toBe('candidate');
    expect(bodyRole(principal('employer'))).toBe('employer');
    expect(bodyRole(principal('pending'))).toBeUndefined();
    expect(bodyRole(null)).toBeUndefined();
  });
});

describe('корневой layout: data-role на <body>', () => {
  async function bodyProps(session: unknown): Promise<Record<string, unknown>> {
    page.session = session;
    const { default: RootLayout } = await import('@/app/layout');
    const html = (await RootLayout({ children: null })) as ReactElement<{ children: ReactElement<Record<string, unknown>>[] | ReactElement<Record<string, unknown>> }>;
    const kids = [html.props.children].flat() as ReactElement<Record<string, unknown>>[];
    const body = kids.find((k) => k.type === 'body');
    return (body as ReactElement<Record<string, unknown>>).props;
  }

  it('кандидат -> candidate', async () => expect((await bodyProps(principal('candidate')))['data-role']).toBe('candidate'));
  it('работодатель -> employer', async () => expect((await bodyProps(principal('employer')))['data-role']).toBe('employer'));
  it('гость -> без атрибута', async () => expect((await bodyProps(null))['data-role']).toBeUndefined());
  it('pending -> без атрибута', async () => expect((await bodyProps(principal('pending')))['data-role']).toBeUndefined());
});

describe('ролевые токены', () => {
  const css = readFileSync(join(__dirname, '../../../src/styles/tokens.css'), 'utf8');
  const shell = readFileSync(join(__dirname, '../../../src/components/shell/shell.module.css'), 'utf8');
  const employer = /\[data-role='employer'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('блок employer переопределяет все ролевые токены, по умолчанию они есть на :root', () => {
    for (const t of ['--role-bar-bg', '--role-rule', '--role-rule-w', '--role-nav-active']) {
      expect(employer).toContain(`${t}:`);
      expect(css).toMatch(new RegExp(`:root \\{[^}]*${t}:`));
    }
  });

  it('шапка и подвал берут рамку и фон из токенов', () => {
    expect(shell).toContain('var(--role-bar-bg)');
    expect(shell).toContain('var(--role-rule)');
    expect(shell).toContain('var(--role-nav-active)');
  });

  it('контраст текста шапки на фоне работодателя не ниже WCAG AA (4,5:1)', () => {
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const bg = /--role-bar-bg:\s*(#[0-9a-f]{6})/i.exec(employer)?.[1] as string;
    expect(bg).toBeTruthy();
    const root = (name: string) => /--NAME:\s*(#[0-9a-f]{6})/i.exec(css.replace(new RegExp(`--${name}:`, 'g'), '--NAME:'))?.[1] as string;
    expect(ratio(root('ink'), bg)).toBeGreaterThan(14);
    expect(ratio(root('muted'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(root('blue'), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
