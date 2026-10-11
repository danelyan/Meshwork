import { z } from 'zod';

import { getProfile } from '@/server/claims';
import type { AgentTool } from '../types';
import { EmptyInput } from './shared';

const Output = z.object({ url: z.string(), claims: z.number().int(), note: z.string() });

/** R-C-03: PDF профиля — серверный файл `GET /api/profile/pdf` (категория из теста, подтверждённые утверждения с уровнями, ФСП, ступени). */
export const renderProfilePdf: AgentTool<Record<string, never>, z.infer<typeof Output>> = {
  name: 'render_profile_pdf',
  description: 'Ссылка на PDF-версию профиля (подтверждённые утверждения с уровнями и источниками) — то, что видит работодатель. Вызывай, когда кандидат просит PDF, выгрузку или «как меня видит работодатель». Не вызывай, если подтверждённых утверждений нет — сначала предложи подтвердить карточки.',
  input: EmptyInput,
  output: Output,
  async handler(ctx) {
    const p = await getProfile(ctx.candidateId);
    const claims = p.claims.filter((c) => c.status === 'confirmed' || c.status === 'edited').length;
    return {
      url: '/api/profile/pdf',
      claims,
      note: claims ? 'Ссылка скачивает готовый PDF; в него попадают только подтверждённые утверждения, без цитат.' : 'Подтверждённых утверждений пока нет - в PDF будут только категория и анкета.',
    };
  },
};
