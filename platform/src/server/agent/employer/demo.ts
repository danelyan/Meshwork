// Демо и план В помощника работодателя: без языковой модели решения «какой инструмент
// вызвать» принимает код по ключевым словам, а инструменты — те же, что у модели
// (тот же dispatch, те же события и сообщения в БД). Ответ — шаблоны по их выходу.
import { prisma } from '@/server/db';
import { listVacancies } from '@/server/employer';
import { categoryLabel } from '@/server/employer/ranking';
import type { ToolCall } from '@/server/llm/types';
import type { Grade, Specialization } from '@/server/types';

import { dispatchToolCall } from '../dispatch';

import { parseGrade, parseSpecialization, parseStack } from './tools/create_need_draft';
import type { EmployerTool } from './tools/shared';
import { saveEmployerMessage } from './store';
import type { AssistantCandidate, CandidatesBlock, EmployerToolContext, EmployerTurnInput, InvitationDraft, NeedDraft } from './types';

const LEVEL_TEXT = { self_reported: 'со слов', artifact: 'есть ссылка на работу', platform: 'проверено платформой', third_party: 'третья сторона' } as const;
const ORDINAL: Record<string, number> = { перв: 0, втор: 1, трет: 2, четв: 3, пят: 4 };

interface Shown {
  block: CandidatesBlock | null;
  byAlias: Map<string, string>;
}

/** Что уже показано в разговоре: последняя выдача и псевдонимы → candidateId (из результатов инструментов). */
async function shownInConversation(conversationId: string): Promise<Shown> {
  const rows = await prisma.employerMessage.findMany({ where: { conversationId, role: 'tool' }, orderBy: { createdAt: 'asc' }, select: { content: true } });
  const byAlias = new Map<string, string>();
  let block: CandidatesBlock | null = null;
  for (const r of rows) {
    let out: unknown;
    try {
      out = JSON.parse(r.content);
    } catch {
      continue;
    }
    if (out && typeof out === 'object' && 'items' in out && Array.isArray((out as CandidatesBlock).items)) {
      block = out as CandidatesBlock;
      for (const it of block.items) byAlias.set(it.alias.replace('Кандидат ', '').toUpperCase(), it.candidateId);
    }
  }
  return { block, byAlias };
}

function pickCandidate(text: string, shown: Shown): AssistantCandidate | { candidateId: string } | null {
  const alias = /#([0-9a-f]{6})/i.exec(text);
  if (alias) {
    const id = shown.byAlias.get(`#${alias[1]!.toUpperCase()}`);
    const it = shown.block?.items.find((i) => i.candidateId === id);
    return it ?? (id ? { candidateId: id } : null);
  }
  const t = text.toLowerCase();
  for (const [stem, idx] of Object.entries(ORDINAL)) if (t.includes(stem)) return shown.block?.items[idx] ?? null;
  if (/(его|ему|лидер|топ|лучш)/.test(t)) return shown.block?.items[0] ?? null;
  return null;
}

type Page = EmployerTurnInput['page'];
type Plan = { name: string; arguments: Record<string, unknown> };

/** Значение после метки («описание: …»); до конца строки или до следующей метки через «;». */
function labelled(text: string, label: RegExp): string | null {
  const m = new RegExp(`(?:${label.source})[^:\\n]{0,20}:\\s*([^\\n;]+)`, 'i').exec(text);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** Поля профиля компании из реплики; «null» = не нашли, поле не меняем. */
export function extractCompanyFields(text: string): { name?: string; industry?: string; description?: string; contact?: string } {
  const out: { name?: string; industry?: string; description?: string; contact?: string } = {};
  const name = labelled(text, /назван/);
  const industry = labelled(text, /отрасл/);
  const description = labelled(text, /описани/);
  const contact = labelled(text, /контакт|связь|связи/) ?? /[\w.+-]+@[\w-]+\.[\w.-]+|@[A-Za-z][\w]{3,}/.exec(text)?.[0] ?? null;
  if (name && name.length >= 2) out.name = name.slice(0, 120);
  if (industry && industry.length >= 2) out.industry = industry.slice(0, 80);
  if (description && description.length >= 20) out.description = description.slice(0, 2000);
  if (contact && contact.length >= 3) out.contact = contact.slice(0, 200);
  return out;
}

/** Решение без модели: какой инструмент вызвать на эту реплику. */
export async function planDemoCall(ctx: EmployerToolContext, text: string, page?: Page): Promise<Plan> {
  const t = text.toLowerCase();
  const shown = await shownInConversation(ctx.conversationId);
  const who = pickCandidate(text, shown);
  const vacancyId = shown.block?.vacancy?.id;

  if (who && /(приглас|оффер|позов|позвать|напиши ему)/.test(t)) {
    return { name: 'draft_invitation', arguments: { candidateId: who.candidateId, ...(vacancyId ? { vacancyId } : {}) } };
  }
  if (who && /(почему|объясни|разбер|чем|ниже|выше|место|подробн)/.test(t)) {
    return { name: 'explain_candidate', arguments: { candidateId: who.candidateId, ...(vacancyId ? { vacancyId } : {}) } };
  }
  const active = (await listVacancies(ctx.companyId)).filter((v) => !v.archived);
  // Вакансия со страницы: только своя и активная, чужой id молча игнорируется.
  const pageVac = page?.vacancyId ? active.find((v) => v.id === page.vacancyId) : undefined;
  const byTitle = active.find((v) => t.includes(v.title.toLowerCase()));

  if (/(задани|тестов|проект)/.test(t) && !/потребност/.test(t)) {
    const vac = byTitle ?? pageVac ?? (active.length === 1 ? active[0] : undefined);
    if (!vac) {
      if (active.length > 1) return { name: 'ask_user', arguments: { question: 'Для какой вакансии сделать задание?', options: active.slice(0, 4).map((v) => v.title.slice(0, 80)) } };
      return { name: 'get_employer_context', arguments: {} };
    }
    const wishes = labelled(text, /пожелани/);
    const visibility = /(только приглашённ|только приглашенн|только тем, кого приглас)/.test(t) ? 'invited' : /(в ленте|всем кандидат)/.test(t) ? 'feed' : null;
    return {
      name: 'create_project_task_draft',
      arguments: { vacancyId: vac.id, ...(wishes ? { wishes } : {}), ...(visibility ? { visibility } : {}), rationale: `Проверка навыков проектом по вакансии «${vac.title}»` },
    };
  }
  if (/(компан|описани|контакт|отрасл)/.test(t) && !/(потребност|вакан)/.test(t)) {
    const fields = extractCompanyFields(text);
    if (!Object.keys(fields).length) {
      return { name: 'ask_user', arguments: { question: 'Что поправить в профиле компании?', options: ['Описание', 'Контакт для кандидатов', 'Отрасль'] } };
    }
    return { name: 'draft_company_profile', arguments: { ...fields, rationale: 'Изменения со слов работодателя' } };
  }
  if (byTitle) return { name: 'match_for_need', arguments: { vacancyId: byTitle.id } };
  const spec = parseSpecialization(text);
  const grade = parseGrade(text);
  if (/(создай|заведи|оформи|новая потребност|новую потребност|опиши потребност)/.test(t) || (/(нужен|нужна|требуется)/.test(t) && spec)) {
    return { name: 'create_need_draft', arguments: { description: text } };
  }
  if (/(по всей базе|по базе|найди|поиск|ищу|фильтр|с фсп)/.test(t)) {
    const stack = parseStack(text);
    return {
      name: 'search_candidates',
      arguments: { ...(spec ? { specialization: spec } : {}), ...(grade ? { grade } : {}), ...(stack.length ? { stack } : {}), ...(/фсп/.test(t) ? { fsp: true } : {}) },
    };
  }
  if (/(подбер|подборк|потребност|кандидат|кого|покажи)/.test(t) || spec || grade) {
    // Страница вакансии - подсказка: без уточнений в реплике подбираем по ней.
    if (pageVac && !spec && !grade) return { name: 'match_for_need', arguments: { vacancyId: pageVac.id } };
    // Несколько потребностей и ни одной подсказки в реплике — спросить, а не брать первую.
    if (!spec && !grade && active.length > 1) {
      return { name: 'ask_user', arguments: { question: 'Под какую потребность подобрать?', options: active.slice(0, 4).map((v) => v.title.slice(0, 80)) } };
    }
    const fit = (s: Specialization | null, g: Grade | null) => active.filter((v) => (!s || v.specialization === s) && (!g || v.grade === g));
    const pick = (fit(spec, grade).length ? fit(spec, grade)[0] : undefined) ?? (active.length === 1 ? active[0] : undefined);
    if (pick) return { name: 'match_for_need', arguments: { vacancyId: pick.id } };
    if (active.length > 1) {
      return { name: 'ask_user', arguments: { question: 'Под какую потребность подобрать?', options: active.slice(0, 4).map((v) => v.title.slice(0, 80)) } };
    }
    return { name: 'search_candidates', arguments: { ...(spec ? { specialization: spec } : {}), ...(grade ? { grade } : {}) } };
  }
  return { name: 'get_employer_context', arguments: {} };
}

function candidateLine(c: AssistantCandidate): string {
  const proven = c.coveredItems.filter((i) => i.level !== 'self_reported').length;
  return [
    `${c.alias} закрывает ${c.covered} из ${c.total} требований`,
    proven ? `${proven} из них доказаны артефактами и выше` : 'всё пока со слов',
    c.category ? `категория ${c.category} по тесту` : 'теста не проходил',
    c.fsp ? 'есть ФСП' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export function describeBlock(b: CandidatesBlock): string {
  const where = b.vacancy ? `Под «${b.vacancy.title}»` : 'По базе';
  if (!b.items.length) {
    return b.vacancy
      ? `${where} пока никого: никто не закрыл ни одного требования. Расширь стек или снизь грейд - или попробуй поиск по всей базе.`
      : `${where} пока никого: ничего не нашлось. Ослабь фильтры.`;
  }
  const top = b.items[0]!;
  const lines = [`${where} нашлось ${b.total} - первые ${b.items.length} ниже карточками.`, `Первый: ${candidateLine(top)}.`];
  if (top.missing.length) lines.push(`Не хватает: ${top.missing.slice(0, 2).join('; ')}.`);
  lines.push(`Нажми «Пригласить» в карточке - или спроси «почему ${top.alias.replace('Кандидат ', '')} первый».`);
  return lines.join('\n');
}

interface ExplainOut {
  inSelection: boolean;
  target: string;
  total?: number;
  alias?: string;
  reason?: string;
  candidate?: AssistantCandidate;
  breakdown?: { coverage: number; category: number; fsp: number; stack: number; specPenalty: number };
  leader?: { alias: string; score: number; covered: number; total: number } | null;
}

export function describeExplain(o: ExplainOut): string {
  if (!o.inSelection || !o.candidate) return `${o.alias}: ${o.reason}`;
  const c = o.candidate;
  const b = o.breakdown!;
  const lines = [`${c.alias} - ${c.rank}-й из ${o.total} (${o.target}), балл ${c.score.toFixed(2)}.`];
  if (c.coveredItems.length) lines.push(`Закрыто: ${c.coveredItems.map((i) => `${i.statement} (${LEVEL_TEXT[i.level]})`).join('; ')}.`);
  if (c.missing.length) lines.push(`Не хватает: ${c.missing.join('; ')}.`);
  const parts = [`покрытие ${b.coverage.toFixed(2)}`];
  if (b.category) parts.push(`+${b.category.toFixed(2)} за категорию`);
  if (b.fsp) parts.push(`+${b.fsp.toFixed(2)} за ФСП`);
  if (b.stack) parts.push(`+${b.stack.toFixed(2)} за стек`);
  if (b.specPenalty) parts.push(`−${b.specPenalty.toFixed(2)} другая специализация`);
  lines.push(`Балл: ${parts.join(', ')}.`);
  if (o.leader) lines.push(`У первого места (${o.leader.alias}) ${o.leader.covered} из ${o.leader.total}, балл ${o.leader.score.toFixed(2)}.`);
  lines.push('Подготовить приглашение?');
  return lines.join('\n');
}

export function describeDraft(d: InvitationDraft): string {
  if (d.blocked === 'no_company_contact') return `Сначала укажи способ связи компании (почту или Telegram) на странице «Компания»: кандидат видит его в приглашении ещё до ответа, без него отправка закрыта.`;
  if (d.blocked === 'open_invitation') return `${d.alias} ещё не ответил на прошлое приглашение компании - новое можно будет отправить после его ответа.`;
  if (d.blocked === 'daily_limit') return `Лимит исчерпан: ${d.limit.sent} из ${d.limit.limit} приглашений за сутки. Черновик сохранится в ленте - отправишь, когда освободится место.`;
  return `Черновик приглашения для ${d.alias} ниже: проверь текст и зарплату и нажми «Отправить приглашение» - отправляешь ты, не я. Осталось ${d.limit.left} из ${d.limit.limit} на сутки.`;
}

export function describeNeed(d: NeedDraft): string {
  const lines = [
    `Собрал черновик: ${categoryLabel(d)}${d.stack.length ? `, стек ${d.stack.join(', ')}` : ''}${d.salaryFrom ? `, от ${d.salaryFrom.toLocaleString('ru-RU')} ₽` : ''}; ${d.needs.length} требований из каталога.`,
    'Открой форму, поправь и сохрани - после этого подберу кандидатов.',
  ];
  return lines.join('\n');
}

interface ContextOut {
  company: { name: string };
  needs: { title: string; specialization: Specialization; grade: Grade }[];
  invitations: { left: number; limit: number };
}

function describeContext(o: ContextOut): string {
  const needs = o.needs.length
    ? `Потребности ${o.company.name}: ${o.needs.map((n) => `«${n.title}» (${categoryLabel(n)})`).join(', ')}.`
    : `У ${o.company.name} пока нет потребностей - опиши словами, кто нужен, и я соберу черновик.`;
  return [needs, `Приглашений на сутки осталось ${o.invitations.left} из ${o.invitations.limit}.`, 'Путь такой: потребность (направление, грейд, стек, вилка зарплаты) → подборка с обоснованием → приглашение с зарплатой; контакты кандидат откроет сам, приняв его.', 'Скажи «подбери под потребность», «найди по базе Frontend с ФСП» или «создай потребность: …».'].join('\n');
}

function describe(name: string, out: unknown): string {
  switch (name) {
    case 'match_for_need':
    case 'search_candidates':
      return describeBlock(out as CandidatesBlock);
    case 'explain_candidate':
      return describeExplain(out as ExplainOut);
    case 'draft_invitation':
      return describeDraft(out as InvitationDraft);
    case 'create_need_draft':
      return describeNeed(out as NeedDraft);
    case 'draft_company_profile':
      return 'Черновик изменений профиля компании ниже: проверь и нажми кнопку применения - сохраняешь ты, не я.';
    case 'create_project_task_draft':
      return 'Черновик проектного задания ниже: проверь шаблон и критерии, сохранить и сформировать задание можно кнопкой.';
    case 'get_employer_context':
      return describeContext(out as ContextOut);
    default:
      return '';
  }
}

let seq = 0;

/**
 * Ход без модели: один инструмент по ключевым словам → те же события и записи в БД →
 * ответ шаблоном. Возвращает текст (ask_user — пустая строка: вопрос уже в ленте).
 */
export async function runScriptedTurn(ctx: EmployerToolContext, registry: EmployerTool[], text: string, page?: Page): Promise<string> {
  const plan = await planDemoCall(ctx, text, page);
  const call: ToolCall = { id: `demo-${Date.now().toString(36)}-${++seq}`, name: plan.name, arguments: plan.arguments };
  await saveEmployerMessage(ctx.conversationId, { role: 'assistant', content: '', toolCalls: [call] });
  const r = await dispatchToolCall(registry, ctx, call);
  await saveEmployerMessage(ctx.conversationId, { role: 'tool', content: r.content, toolCallId: call.id });
  if (r.terminal) return '';
  if (!r.ok) {
    const msg = (() => {
      try {
        return (JSON.parse(r.content) as { error: { message: string } }).error.message;
      } catch {
        return 'Не получилось.';
      }
    })();
    return `${msg}`;
  }
  return describe(plan.name, r.output);
}
