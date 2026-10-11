import 'server-only';

import { llmByDay, llmByPurpose } from './llm-monitor';
import { matchingFunnel } from './matching-monitor';
import { MIN_GROUP, maskSmall, round, toCsv } from './csv';
import { testItemStats } from './test-monitor';

export const EXPORT_KINDS = ['test', 'matching', 'llm'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Содержимое выгрузки по виду. Счётчики малых групп скрыты (`<5`), доли в них не отдаём. */
export async function buildExport(kind: ExportKind, days: number): Promise<{ csv: string; rowCount: number }> {
  if (kind === 'test') {
    const rows = await testItemStats(days);
    const body = rows.map((r) => {
      const small = r.answered < MIN_GROUP;
      return [r.templateId, r.specialization, r.grade, r.paramsSource, maskSmall(r.shown), maskSmall(r.answered), small ? null : round(r.correctShare), small ? null : round(r.discrimination), small || r.medianSec === null ? null : Math.round(r.medianSec), r.flags.length ? 'да' : 'нет'];
    });
    return { csv: toCsv(['template_id', 'specialization', 'grade', 'params_source', 'shown', 'answered', 'correct_share', 'discrimination', 'median_sec', 'needs_recalibration'], body), rowCount: body.length };
  }
  if (kind === 'matching') {
    const rows = await matchingFunnel(days);
    const body = rows.map((r) => {
      const small = r.sent < MIN_GROUP || r.invitedCandidates < MIN_GROUP;
      return [r.specialization, r.grade, maskSmall(r.sent), small ? null : r.viewed, small ? null : r.accepted, small ? null : r.declined, small ? null : round(r.acceptedShare), maskSmall(r.invitedCandidates), small ? null : round(r.medianHoursToFirst, 1)];
    });
    return { csv: toCsv(['specialization', 'grade', 'sent', 'viewed', 'accepted', 'declined', 'accepted_share', 'invited_candidates', 'median_hours_to_first_invitation'], body), rowCount: body.length };
  }
  const [byPurpose, byDay] = await Promise.all([llmByPurpose(days), llmByDay(days)]);
  const body = [
    ...byPurpose.map((r) => ['purpose', r.purpose, r.runs, r.inputTokens, r.outputTokens, round(r.p50Ms, 0), round(r.p95Ms, 0), round(r.invalidJsonShare), r.retries]),
    ...byDay.map((r) => ['day', r.day, r.runs, r.inputTokens, r.outputTokens, null, null, null, null]),
  ];
  return { csv: toCsv(['group', 'key', 'runs', 'input_tokens', 'output_tokens', 'p50_ms', 'p95_ms', 'invalid_json_share', 'retries'], body), rowCount: body.length };
}
