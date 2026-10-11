// Сводка матрицы инструментов: чистые функции над записями ходов.
import type { TurnObs, Verdict } from './checks';

export interface TurnRecord {
  scenario: string;
  user: string;
  turn: number;
  text: string;
  fmt: string[];
  expect: string[];
  none: boolean;
  injection: boolean;
  obs: TurnObs;
  verdict: Verdict;
}

export interface ToolRow {
  /** Ходов, где инструмент был в списке ожидаемых. */
  expected: number;
  /** Ходов, где он был вызван (любых). */
  called: number;
  /** Ожидали и вызвали. */
  hit: number;
  /** Вызовов с ошибкой. */
  errors: number;
}

export interface Report {
  turns: number;
  pass: number;
  ms: number;
  inTokens: number;
  outTokens: number;
  byTool: Record<string, ToolRow>;
  byFormat: Record<string, { n: number; uploaded: number; rejected: number; rejections: string[]; replies: string[] }>;
  byUser: Record<string, { label: string; n: number; pass: number }>;
}

export function buildReport(records: TurnRecord[], allTools: string[], users: Record<string, string>): Report {
  const byTool: Record<string, ToolRow> = Object.fromEntries(allTools.map((t) => [t, { expected: 0, called: 0, hit: 0, errors: 0 }]));
  const row = (t: string) => (byTool[t] ??= { expected: 0, called: 0, hit: 0, errors: 0 });
  const byFormat: Report['byFormat'] = {};
  const byUser: Report['byUser'] = {};
  for (const r of records) {
    const called = new Set(r.obs.calls.map((c) => c.name));
    for (const t of r.expect) {
      row(t).expected++;
      if (called.has(t)) row(t).hit++;
    }
    for (const t of called) row(t).called++;
    for (const c of r.obs.calls) if (!c.ok) row(c.name).errors++;
    r.fmt.forEach((f, i) => {
      const u = r.obs.uploads[i];
      const e = (byFormat[f] ??= { n: 0, uploaded: 0, rejected: 0, rejections: [], replies: [] });
      e.n++;
      if (u && u.status < 300 && !u.uiBlocked) e.uploaded++;
      else {
        e.rejected++;
        const why = u?.uiBlocked ?? `сервер ${u?.status}: ${u?.error ?? ''}`;
        if (!e.rejections.includes(why)) e.rejections.push(why);
      }
      e.replies.push(r.obs.text.replace(/\s+/g, ' ').slice(0, 280));
    });
    const u = (byUser[r.user] ??= { label: users[r.user] ?? r.user, n: 0, pass: 0 });
    u.n++;
    if (r.verdict.pass) u.pass++;
  }
  return {
    turns: records.length,
    pass: records.filter((r) => r.verdict.pass).length,
    ms: records.reduce((a, r) => a + r.obs.ms, 0),
    inTokens: records.reduce((a, r) => a + r.obs.inTokens, 0),
    outTokens: records.reduce((a, r) => a + r.obs.outTokens, 0),
    byTool,
    byFormat,
    byUser,
  };
}

export function renderMarkdown(label: string, model: string, prompt: string, rep: Report, records: TurnRecord[]): string {
  const L: string[] = [];
  const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
  L.push(`# Матрица инструментов – ${label}`, '', `Модель ${model}, промпт ${prompt}. Ходов ${rep.turns}, прошли ${rep.pass} (${rep.turns ? Math.round((100 * rep.pass) / rep.turns) : 0} %). Токены: ${rep.inTokens} вход / ${rep.outTokens} выход. Время ходов: ${Math.round(rep.ms / 1000)} с (среднее ${rep.turns ? Math.round(rep.ms / rep.turns / 100) / 10 : 0} с).`, '');
  L.push('## Инструменты', '', '| инструмент | ожидали (ходов) | вызвали и ожидали | вызвали всего | ошибки |', '|---|---|---|---|---|');
  for (const [t, r] of Object.entries(rep.byTool)) L.push(`| ${t} | ${r.expected} | ${r.hit} | ${r.called} | ${r.errors} |`);
  L.push('', 'Ожидание мягкое: ход засчитан, если вызван хотя бы один инструмент из списка хода; «ожидали» считает ходы, где инструмент в списке.', '');
  L.push('## Форматы файлов', '', '| формат | попыток | дошёл до агента | отклонён | причины отказа | что ответила Кира (первые ответы) |', '|---|---|---|---|---|---|');
  for (const [f, r] of Object.entries(rep.byFormat)) L.push(`| ${cell(f)} | ${r.n} | ${r.uploaded} | ${r.rejected} | ${cell(r.rejections.join('; '))} | ${cell(r.replies.slice(0, 2).join(' // '))} |`);
  L.push('', '## Пользователи', '', '| профиль | ходов | прошли |', '|---|---|---|');
  for (const [, u] of Object.entries(rep.byUser)) L.push(`| ${cell(u.label)} | ${u.n} | ${u.pass} |`);
  const bad = records.filter((r) => !r.verdict.pass);
  L.push('', `## Провалы (${bad.length})`, '');
  for (const r of bad) {
    L.push(`### ${r.scenario} #${r.turn} (${r.user})`, `- реплика: ${r.text}`, `- вызвано: ${r.obs.calls.map((c) => c.name).join(', ') || '–'}`, ...r.verdict.fails.map((f) => `- ${f}`), `- ответ: «${r.obs.text.replace(/\s+/g, ' ').slice(0, 400)}»`, '');
  }
  return L.join('\n');
}
