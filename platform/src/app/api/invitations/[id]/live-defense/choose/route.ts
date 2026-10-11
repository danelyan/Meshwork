import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { chooseSlot } from '@/server/live-defense';
import { LiveChooseInput } from '@/server/live-defense/schemas';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST `{ slotId, recordingConsentVersion? }` – выбрать слот живой защиты (ADR 0008 п. 3–4). Защита записывается:
 * без действующего согласия на запись (`call_recording`, ADR 0005) – 409 `recording_consent_required` с текстом и
 * версией согласия; с `recordingConsentVersion` согласие даётся тем же действием. Время занято другим кандидатом
 * компании – 409 `slot_taken`. Чужое приглашение – 404.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const input = LiveChooseInput.parse(await req.json().catch(() => ({})));
  return Response.json(await chooseSlot(candidateId, id, input));
});
