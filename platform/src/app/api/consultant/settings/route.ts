import { loadConsultantSettings, saveConsultantSettings } from '@/server/consultant/settings';
import { SettingsInput } from '@/server/consultant/skills';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Как работает консультант кандидата: включённые скиллы (id из каталога) и свои инструкции.
 * Только свои настройки кандидата; меняют стиль и фокус ответов консультанта, не подборку и не тест.
 */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  return Response.json(await loadConsultantSettings(candidateId));
});

/** Сохранить настройки целиком. Неизвестный id скилла или текст длиннее 500 символов — 400. */
export const PUT = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const body = SettingsInput.parse(await req.json().catch(() => ({})));
  return Response.json(await saveConsultantSettings(candidateId, body));
});
