import { redirect } from 'next/navigation';

import { requirePageCandidate } from '@/server/auth/page';

/** /interview/room — старая комната звонка; созвон идёт только в консультанте (решение владельца 12.10). */
export default async function Page() {
  await requirePageCandidate('/interview/room');
  redirect('/consultant?call=1');
}
