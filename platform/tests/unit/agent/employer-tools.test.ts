import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AssistantCandidateSchema, toAssistantCandidate } from '@/server/agent/employer/cards';
import { parseNeedPrefill } from '@/server/agent/employer/prefill';
import { EMPLOYER_PROMPT, EMPLOYER_PROMPT_VERSION } from '@/server/agent/employer/prompt';
import { employerTools, EMPLOYER_TOOL_NAMES } from '@/server/agent/employer/tools';
import { needFormHref, parseGrade, parseSalary, parseSpecialization, parseStack } from '@/server/agent/employer/tools/create_need_draft';
import type { EmployerToolContext } from '@/server/agent/employer/types';
import { dispatchToolCall } from '@/server/agent/dispatch';
import { toolSpecs } from '@/server/agent/spec';
import { tools as candidateTools, TOOL_NAMES } from '@/server/agent/tools';
import type { MatchItem } from '@/server/employer/matching';
import { pseudonym } from '@/server/employer/privacy';

const ctx = (): EmployerToolContext => ({
  employerProfileId: 'p1',
  companyId: 'co1',
  conversationId: 'conv1',
  emit: () => undefined,
  llm: {} as EmployerToolContext['llm'],
});

describe('реестр помощника работодателя', () => {
  it('7 инструментов: 6 по решению владельца + ask_user', () => {
    expect([...EMPLOYER_TOOL_NAMES].sort()).toEqual(
      ['ask_user', 'create_need_draft', 'draft_invitation', 'explain_candidate', 'get_employer_context', 'match_for_need', 'search_candidates'].sort(),
    );
  });

  it('роли не смешиваются: ни одного общего объекта, общее имя — только ask_user', () => {
    const shared = employerTools.filter((t) => (candidateTools as unknown[]).includes(t));
    expect(shared).toEqual([]);
    expect(EMPLOYER_TOOL_NAMES.filter((n) => TOOL_NAMES.includes(n))).toEqual(['ask_user']);
  });

  it('кандидатский инструмент работодателю недоступен: unknown_tool, хендлер не вызывается', async () => {
    for (const name of ['get_profile', 'propose_claims', 'read_upload', 'get_invitations']) {
      const r = await dispatchToolCall(employerTools, ctx(), { id: 'x', name, arguments: {} });
      expect(r.errorCode, name).toBe('unknown_tool');
    }
  });

  it('нет инструментов отправки, сохранения, удаления, произвольного HTTP', () => {
    for (const n of EMPLOYER_TOOL_NAMES) expect(n).not.toMatch(/(send|accept|decline|delete|remove|save|confirm|update|apply|mail|exec|shell|http|fetch_url|contact)/i);
  });

  it('описания и JSON Schema для провайдера; завершает ход только ask_user', () => {
    const specs = toolSpecs(employerTools);
    for (const s of specs) {
      expect(s.description.length, s.name).toBeGreaterThan(40);
      expect((s.parameters as { type: string }).type).toBe('object');
      expect(s.parameters).not.toHaveProperty('$schema');
    }
    expect(employerTools.filter((t) => t.terminal).map((t) => t.name)).toEqual(['ask_user']);
  });
});

describe('промпт помощника работодателя', () => {
  it('prompt.ts совпадает с prompts/employer.md', () => {
    const md = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/employer.md'), 'utf8');
    expect(EMPLOYER_PROMPT).toBe(md);
    expect(EMPLOYER_PROMPT_VERSION).toMatch(/^employer-v\d+$/);
  });

  it('границы: приватность, отправка кнопкой, лимит, недоверенные данные', () => {
    for (const must of ['<privacy>', 'примет приглашение', 'Отправить приглашение', '20 приглашений', 'external_data', 'Кандидат #', '<examples>']) {
      expect(EMPLOYER_PROMPT, must).toContain(must);
    }
  });
});

describe('граница приватности: карточка помощника', () => {
  const accepted: MatchItem = {
    candidateId: 'cand-secret',
    rank: 1,
    score: 0.8,
    coverageScore: 0.6,
    covered: 2,
    total: 3,
    provenCount: 1,
    boosts: { category: 0.1, fsp: 0.05, stack: 0.02, specPenalty: 0 },
    explanation: {
      summary: 'Закрывает 2 из 3',
      covered: [
        { statement: 'Идемпотентность', level: 'artifact' },
        { statement: 'Транзакции', level: 'self_reported' },
      ],
      proven: ['Идемпотентность'],
      missing: ['Очереди'],
      fsp: 'есть',
      category: 'Backend · Middle (тест)',
      stackMatched: ['Go'],
    },
    candidate: {
      id: 'cand-secret',
      // после принятия кабинет показывает имя и контакты — помощнику они не уходят
      displayName: 'Мария Секретова',
      specialization: 'backend',
      category: { specialization: 'backend', grade: 'middle', label: 'Backend · Middle' },
      fsp: { state: 'linked', hasAchievements: true },
      claims: [{ catalogId: 'be.idempotency', statement: 'Идемпотентность', level: 'artifact', sourceType: 'github' }],
      contacts: { name: 'Мария Секретова', email: 'maria@secret.example' },
    },
    invitation: { id: 'i1', status: 'accepted', vacancyId: 'v1' },
  };

  it('даже после принятия: псевдоним вместо имени, без почты, имени и цитат', () => {
    const card = toAssistantCandidate(accepted);
    const json = JSON.stringify(card);
    expect(card.alias).toBe(pseudonym('cand-secret'));
    expect(json).not.toContain('Секретова');
    expect(json).not.toContain('maria@');
    expect(json).not.toMatch(/"(quote|contacts|email|name|displayName)"/);
    expect(card.coveredItems[0]).toEqual({ statement: 'Идемпотентность', level: 'artifact', sourceType: 'github' });
    expect(card.invitation).toBe('accepted');
    expect(AssistantCandidateSchema.safeParse(card).success).toBe(true);
  });

  it('strict-схема: лишнее поле (имя, контакты, цитата) роняет проверку выхода', () => {
    const card = toAssistantCandidate(accepted);
    expect(AssistantCandidateSchema.safeParse({ ...card, contacts: { email: 'x@y' } }).success).toBe(false);
    expect(AssistantCandidateSchema.safeParse({ ...card, name: 'Мария' }).success).toBe(false);
    expect(
      AssistantCandidateSchema.safeParse({ ...card, coveredItems: [{ statement: 's', level: 'artifact', sourceType: null, quote: 'цитата' }] }).success,
    ).toBe(false);
  });
});

describe('черновик потребности из слов', () => {
  it('специализация, грейд, стек, вилка', () => {
    expect(parseSpecialization('Нужен бэкенд на Go')).toBe('backend');
    expect(parseSpecialization('ищем фронтенд React')).toBe('frontend');
    expect(parseSpecialization('нужен человек')).toBeNull();
    expect(parseGrade('мидл')).toBe('middle');
    expect(parseGrade('джун')).toBe('junior');
    expect(parseStack('Go, Kafka и PostgreSQL; работаем в Google')).toEqual(['Go', 'PostgreSQL', 'Kafka']);
    expect(parseStack('good google')).toEqual([]);
    expect(parseSalary('200–260 тыс')).toEqual({ from: 200_000, to: 260_000 });
    expect(parseSalary('от 150к')).toEqual({ from: 150_000, to: null });
    expect(parseSalary('180 000 – 220 000 ₽')).toEqual({ from: 180_000, to: 220_000 });
    expect(parseSalary('опыт 2 года')).toEqual({ from: null, to: null });
  });

  it('ссылка на форму → предзаполнение; чужие требования и мусор отбрасываются', () => {
    const href = needFormHref({
      title: 'Backend платежей',
      specialization: 'backend',
      grade: 'middle',
      stack: ['Go', 'Kafka'],
      salaryFrom: 200_000,
      salaryTo: 260_000,
      teamDescription: 'Платёжная команда',
      needs: [
        { catalogId: 'be.idempotency', statement: '', weight: 3 },
        { catalogId: 'fe.ssr', statement: '', weight: 2 },
      ],
    });
    const raw = Object.fromEntries(new URL(href, 'http://x').searchParams);
    const p = parseNeedPrefill(raw, [
      { id: 'be.idempotency', specialization: 'backend' },
      { id: 'fe.ssr', specialization: 'frontend' },
    ]);
    expect(p).toMatchObject({ title: 'Backend платежей', specialization: 'backend', grade: 'middle', salaryFrom: 200_000, salaryTo: 260_000, stack: ['Go', 'Kafka'] });
    expect(p?.needs.map((n) => n.catalogId)).toEqual(['be.idempotency']);
    expect(parseNeedPrefill({}, [])).toBeNull();
    expect(parseNeedPrefill({ spec: 'hacker' }, [])).toBeNull();
    expect(parseNeedPrefill({ spec: 'backend', from: '-5', to: 'abc' }, [])?.salaryFrom).toBe(0);
  });
});
