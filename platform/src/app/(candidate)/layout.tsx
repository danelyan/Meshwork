import type { ReactNode } from 'react';

import { Header } from '@/components/Header';

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main">{children}</main>
    </>
  );
}
