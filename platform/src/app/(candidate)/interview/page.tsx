import { redirect } from 'next/navigation';

import { requirePageCandidate } from '@/server/auth/page';

/**
 * /interview — старый вход в созвон. Единая точка созвона с ИИ — окно консультанта (решение владельца 12.10):
 * старые ссылки и закладки ведём в консультанта с сразу открытым режимом созвона. Guard — только кандидат.
 */
export default async function Page() {
  await requirePageCandidate('/interview');
  redirect('/consultant?call=1');
}
