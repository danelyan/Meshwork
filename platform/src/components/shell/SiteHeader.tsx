import { getPageSession } from '@/server/auth/page';

import { HeaderBar } from './HeaderBar';
import { linksFor } from './nav';

/**
 * Единая шапка сайта (серверный компонент): читает сессию и отдаёт клиентскому `HeaderBar` ссылки роли.
 * Подключена один раз в `app/layout.tsx`. Лэйаут не перерисовывается при клиентской навигации, поэтому
 * после входа и выхода нужен `router.refresh()` (его и делают экраны входа и «Выйти»).
 */
export async function SiteHeader() {
  const session = await getPageSession();
  const role = session ? session.role : null;
  return <HeaderBar signedIn={session !== null} links={linksFor(role)} />;
}
