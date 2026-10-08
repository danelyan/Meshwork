import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@/styles/tokens.css';

export const metadata: Metadata = {
  title: 'ФСП Карьера — консультант',
  description: 'Карьерный консультант платформы ФСП Карьера',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
