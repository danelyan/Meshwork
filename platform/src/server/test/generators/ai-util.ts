// Общие помощники генераторов AI (ai.ts, ai-extra.ts).

export const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар', 'Инна', 'Кирилл', 'Лев', 'Мария'];
export const SURNAMES = ['Иванова', 'Петров', 'Смирнова', 'Кузнецов', 'Попова', 'Соколов', 'Лебедева', 'Новиков'];
export const CITIES = ['Казань', 'Самара', 'Тверь', 'Омск', 'Пермь', 'Томск'];
export const DOMAINS = [
  { ru: 'обращения в поддержку банка', intents: ['card_block', 'limit_change', 'complaint'] },
  { ru: 'заявки в службу доставки', intents: ['track', 'cancel', 'reschedule'] },
  { ru: 'обращения клиентов телеком-оператора', intents: ['tariff', 'roaming', 'billing'] },
  { ru: 'вопросы сотрудников к HR-боту', intents: ['vacation', 'payroll', 'sick_leave'] },
];

export function table(cols: string[], rows: (string | number)[][]): string {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) => cells.map((c, i) => String(c).padEnd(w[i]!)).join(' | ');
  return [line(cols), w.map((x) => '-'.repeat(x)).join('-+-'), ...rows.map(line)].join('\n');
}

/** Число без хвоста двоичной погрешности: 0.30000000000000004 → "0.3". */
export function num(x: number): string {
  return String(Number(x.toFixed(6)));
}
