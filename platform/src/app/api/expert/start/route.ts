import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSubcategory, SPECIALIZATIONS, subcategoriesFor } from '@/lib/directions';
import { GRADES } from '@/lib/grades';
import { assertSameOrigin } from '@/server/auth/csrf';
import { AppError, withErrors } from '@/server/errors';
import { assertExpertEnabled, createExpert, deleteExpert, expertCookie } from '@/server/expert';
import { startAttempt } from '@/server/test';
import { hasTestForSubcategory, unavailableReason } from '@/server/test/generators';

export const dynamic = 'force-dynamic';

const Body = z.object({
  specialization: z.enum(SPECIALIZATIONS),
  grade: z.enum(GRADES),
  subcategoryId: z.string().min(1).max(64),
});

/** GET /api/expert/start – направления и подкатегории, по которым тест эксперта доступен (банк заданий собран). Флаг DEMO_LOGIN. */
export const GET = withErrors(async () => {
  assertExpertEnabled();
  const directions = SPECIALIZATIONS.map((spec) => ({
    specialization: spec,
    subcategories: subcategoriesFor(spec).map((s) => ({ id: s.id, title: s.title, available: hasTestForSubcategory(spec, s.id) })),
  }));
  return Response.json({ directions });
});

/**
 * POST /api/expert/start {specialization, grade, subcategoryId} – режим эксперта: новый одноразовый эксперт (без
 * регистрации, скрыт от работодателей) и попытка теста на грейд тем же сервисом, что у кандидата. Кука `fsp_expert`
 * (path /api/expert). Лимиты: адрес клиента и суточный потолок (429). Флаг DEMO_LOGIN выключен → 404.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  assertExpertEnabled();
  const body = Body.parse(await req.json().catch(() => ({})));
  // Проверка до создания записи: на неверный выбор эксперт не заводится.
  if (getSubcategory(body.subcategoryId)?.specialization !== body.specialization) {
    throw new AppError('subcategory_required', 'Выберите подкатегорию этого направления.', 422);
  }
  const reason = unavailableReason(body.specialization, body.subcategoryId);
  if (reason) throw new AppError('no_test', reason, 422);
  const candidateId = await createExpert(req);
  let attemptId: string;
  try {
    ({ attemptId } = await startAttempt(candidateId, body.specialization, body.grade, new Date(), { subcategoryId: body.subcategoryId }));
  } catch (e) {
    await deleteExpert(candidateId).catch(() => undefined);
    throw e;
  }
  const res = NextResponse.json({ attemptId }, { status: 201 });
  res.cookies.set(expertCookie(candidateId));
  return res;
});
