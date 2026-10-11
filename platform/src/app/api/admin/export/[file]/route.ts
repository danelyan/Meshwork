import { audit } from '@/server/admin/audit';
import { EXPORT_KINDS, type ExportKind, buildExport } from '@/server/admin/metrics/export';
import { parseDays } from '@/server/admin/metrics/period';
import { requireStaff } from '@/server/admin/session';
import { errors, withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * Обезличенная выгрузка агрегатов: `/api/admin/export/{test|matching|llm}.csv?days=30`. Только owner (`export_csv`);
 * каждая выгрузка пишется в журнал (вид, период, число строк). Группы меньше 5 скрыты.
 */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ file: string }> }) => {
  const staff = await requireStaff(req, 'export_csv');
  const { file } = await ctx.params;
  const kind = file.endsWith('.csv') ? file.slice(0, -4) : '';
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw errors.notFound('Нет такой выгрузки');
  const days = parseDays(new URL(req.url).searchParams.get('days'));
  const { csv, rowCount } = await buildExport(kind as ExportKind, days);
  await audit({ actor: staff, action: 'export_csv', target: { type: 'metrics_export', id: kind }, after: { days, rows: rowCount } });
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fsp-${kind}-${days}d.csv"`,
      'cache-control': 'no-store',
    },
  });
});
