import type { Metadata, Viewport } from 'next';
import { Golos_Text } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { DevPanelGate } from '@/components/devtools/DevPanelGate';
import { AuthEntry } from '@/components/auth/AuthEntry';
import { getPageSession } from '@/server/auth/page';
import { yandexConfig } from '@/server/auth/yandex';
import { ShellFrame } from '@/components/shell/ShellFrame';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { bodyRole } from '@/components/shell/bodyRole';
import { SiteHeader } from '@/components/shell/SiteHeader';
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
  title: 'ФСП Карьера - консультант',
  description: 'Карьерный консультант платформы ФСП Карьера',
};

// Клавиатура на мобильном уменьшает область вёрстки (Chrome Android): dvh и липкий ввод остаются видны. Safari параметр игнорирует.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const role = bodyRole(await getPageSession());
  return (
    <html lang="ru" className={`${golos.variable} ${mono.variable}`}>
      {/* data-stt — режим голосового ввода для композера чата (server/stt, env STT_PROVIDER) */}
      <body data-stt={sttMode()} data-role={role}>
        <AuthEntry yandexEnabled={yandexConfig() !== null} demoEnabled={getEnv().DEMO_LOGIN}>
        <ShellFrame header={<SiteHeader />} footer={<SiteFooter demo={getEnv().DEMO_LOGIN} />}>
          {children}
        </ShellFrame>
        </AuthEntry>
        <DevPanelGate />
      </body>
    </html>
  );
}
