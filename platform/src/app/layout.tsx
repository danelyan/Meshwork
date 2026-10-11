import type { Metadata, Viewport } from 'next';
import { Golos_Text } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { DevPanelGate } from '@/components/devtools/DevPanelGate';
import { AuthEntry } from '@/components/auth/AuthEntry';
import { getPageSession } from '@/server/auth/page';
import { headerAccountFor } from '@/server/auth/role-switch';
import { yandexConfig } from '@/server/auth/yandex';
import { fspDemoHint } from '@/server/fsp-id/client';
import { ShellFrame } from '@/components/shell/ShellFrame';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { bodyRole } from '@/components/shell/bodyRole';
import { SiteHeader } from '@/components/shell/SiteHeader';
import { THEME_SCRIPT } from '@/components/shell/theme-script';
import { EmployerSidebarSummary } from '@/components/employer/EmployerSidebarSummary';
import { getEnv } from '@/server/env';
import { sttMode } from '@/server/stt';

import '@/styles/tokens.css';

// Golos Text скачивается и самохостится при `next build`/`next dev` (нужна сеть к Google Fonts на сборке).
const golos = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-golos',
});

const mono = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/JetBrainsMono-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  icons: {
    icon: [{ url: '/assets/favicon.png?v=transparent-2', type: 'image/png', sizes: '64x64' }, { url: '/assets/favicon.svg?v=transparent-2', type: 'image/svg+xml', sizes: 'any' }],
    apple: { url: '/assets/apple-touch-icon.png', sizes: '180x180' },
  },
  title: 'MESHWORK - консультант',
  description: 'Карьерный консультант платформы MESHWORK',
};

// Клавиатура на мобильном уменьшает область вёрстки (Chrome Android): dvh и липкий ввод остаются видны. Safari параметр игнорирует.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getPageSession();
  const role = bodyRole(session);
  const account = session ? await headerAccountFor(session.userId, session.role) : null;
  return (
    // suppressHydrationWarning: data-theme на <html> ставит инлайн-скрипт до гидрации (тема /consultant, без мигания)
    <html lang="ru" className={`${golos.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* data-stt — режим голосового ввода для композера чата (server/stt, env STT_PROVIDER) */}
      <body data-stt={sttMode()} data-role={role}>
        <AuthEntry yandexEnabled={yandexConfig() !== null} fspHint={fspDemoHint()} demoEnabled={getEnv().DEMO_LOGIN}>
        <ShellFrame account={account} employerSummary={session?.role === 'employer' && session.employerProfileId ? <EmployerSidebarSummary employerProfileId={session.employerProfileId} /> : null} header={<SiteHeader />} footer={<SiteFooter demo={getEnv().DEMO_LOGIN} />}>
          {children}
        </ShellFrame>
        </AuthEntry>
        <DevPanelGate />
      </body>
    </html>
  );
}
