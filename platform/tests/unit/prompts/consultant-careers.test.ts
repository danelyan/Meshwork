// Аудит промптов, лейн consultant-careers: данные, по которым консультант даёт карьерные советы,
// без сети и БД — следующий шаг пути (<journey>), рекомендация теста (decideGrade) и карточки
// рекомендаций в чате (normalizeRecommendation). Живые сценарии — eval/prompt-audit/consultant-careers.
import { describe, expect, it } from 'vitest';

import { normalizeRecommendation } from '@/lib/claims-view';
import { AI_CONSENT_HINT, CALL_NO_SOURCES_HINT, journeyPromptBlock, PROJECT_FOR_LIVE_HINT, stepHint, STEP_HINT, type JourneyState } from '@/server/agent/journey';
import { decideGrade, inferSpecialization } from '@/server/recommend/test';
import type { CatalogEntry } from '@/server/claims/types';

const state = (s: Partial<JourneyState> & Pick<JourneyState, 'nextStep'>): JourneyState => ({
  steps: { onboarding: true, test: false, call: false, project: false, ai_defense: false },
  counts: { sources: 0, proposed: 0, confirmed: 0, pendingInvitations: 0, acceptedInvitations: 0 },
  hasCategory: false,
  callNeedsSources: false,
  onboardedAt: new Date('2026-10-11T10:00:00Z'),
  hired: null,
  aiConsent: true,
  hidden: false,
  ...s,
});

describe('следующий шаг пути (stepHint / <journey>)', () => {
  it('нет категории — тест, и подсказка говорит «категорию даёт только он»', () => {
    expect(stepHint(state({ nextStep: 'test' }))).toMatch(/категорию даёт только он/u);
  });

  it('созвон без утверждений — отдельная подсказка про источники', () => {
    const h = stepHint(state({ nextStep: 'call', callNeedsSources: true, hasCategory: true }));
    expect(h).toBe(CALL_NO_SOURCES_HINT);
  });

  it('принятое приглашение без проекта — проект, а не живая защита', () => {
    expect(stepHint(state({ nextStep: 'project', counts: { sources: 1, proposed: 0, confirmed: 3, pendingInvitations: 0, acceptedInvitations: 1 } }))).toBe(PROJECT_FOR_LIVE_HINT);
  });

  it('нет согласия на оценку ИИ — согласие впереди шага теста', () => {
    expect(stepHint(state({ nextStep: 'test', aiConsent: false }))).toBe(`${AI_CONSENT_HINT} ${STEP_HINT.test}`);
  });

  it('waiting: подсказка про скрытый профиль и /settings; в блоке — «Профиль скрыт: да»', () => {
    expect(STEP_HINT.waiting).toMatch(/\/settings/u);
    const block = journeyPromptBlock(state({ nextStep: 'waiting', hidden: true, hasCategory: true }));
    expect(block).toMatch(/СЛЕДУЮЩИЙ ШАГ: waiting/u);
    expect(block).toMatch(/Профиль скрыт: да/u);
  });

  it('категория есть — блок не зовёт на тест', () => {
    const block = journeyPromptBlock(state({ nextStep: 'call', hasCategory: true, steps: { onboarding: true, test: true, call: false, project: false, ai_defense: false } }));
    expect(block).toMatch(/Категория: есть/u);
    expect(block).not.toMatch(/СЛЕДУЮЩИЙ ШАГ: test/u);
  });

  // Находка аудита: в блоке нет специализации и грейда категории — модель узнаёт их только вызовом
  // get_test_status/get_profile. Тест фиксирует текущее поведение, чтобы смена была осознанной.
  it('в блоке нет названия категории (только «есть/нет»)', () => {
    const block = journeyPromptBlock(state({ nextStep: 'call', hasCategory: true }));
    expect(block).not.toMatch(/backend|frontend|junior|middle|senior/iu);
  });
});

const entry = (id: string, m: number, j = 0): CatalogEntry =>
  ({ id, specialization: 'backend', statement: `утверждение ${id}`, weight: m, weights: { junior: j, middle: m, senior: m } }) as unknown as CatalogEntry;

describe('рекомендация теста (decideGrade): только рекомендация, Senior не предлагает', () => {
  const sig = [entry('be.a', 3), entry('be.b', 3), entry('be.c', 2), entry('be.d', 2)].map((e) => ({ ...e, weight: e.weight as 1 | 2 | 3 }));

  it('покрытие ≥ 25 % — Middle', () => {
    expect(decideGrade(sig, new Set(['be.a'])).grade).toBe('middle');
  });

  it('15–25 % — Junior с «Middle - если уверены» и списком нехватки', () => {
    const d = decideGrade([...sig, entry('be.e', 3), entry('be.f', 3)].map((e) => ({ ...e, weight: e.weight as 1 | 2 | 3 })), new Set(['be.a']));
    expect(d.grade).toBe('junior');
    expect(d.reason).toMatch(/Middle - если уверены/u);
    expect(d.reason).toMatch(/Для Middle не хватает заявленных:/u);
  });

  it('пусто — Junior; Senior не рекомендуется никогда (выбор Senior — только кандидата)', () => {
    expect(decideGrade(sig, new Set()).grade).toBe('junior');
    expect(decideGrade(sig, new Set(sig.map((e) => e.id))).grade).toBe('middle');
  });

  it('направление по утверждениям: лидер по префиксу; ничья — null', () => {
    expect(inferSpecialization(['fe.forms', 'fe.components', 'be.cache'])).toBe('frontend');
    expect(inferSpecialization(['fe.forms', 'be.cache'])).toBeNull();
  });
});

describe('карточки рекомендаций в чате (normalizeRecommendation)', () => {
  it('тест: хвост «не хватает» — отдельным списком, ссылка на /test с направлением и грейдом', () => {
    const c = normalizeRecommendation({ specialization: 'frontend', grade: 'junior', allowed: true, reason: 'Заявлено 20% того, что отличает Middle, - предлагаем Junior; Middle - если уверены. Для Middle не хватает заявленных: A; B; C.' }, 0)!;
    expect(c.kind).toBe('test');
    expect(c.title).toBe('Тест: Frontend · Junior');
    expect(c.missing).toEqual(['A', 'B', 'C']);
    expect(c.reason).not.toMatch(/не хватает/u);
    expect(c.href).toBe('/test?specialization=frontend&grade=junior');
  });

  it('тест закрыт интервалом: без кнопки, с пометкой', () => {
    const c = normalizeRecommendation({ specialization: 'ai', grade: 'middle', allowed: false, reason: 'x' }, 1)!;
    expect(c.href).toBeUndefined();
    expect(c.meta).toBe('сейчас недоступен');
  });

  it('вакансия: «закрываешь k из n» и чего не хватает, без вероятности', () => {
    const c = normalizeRecommendation({ vacancyId: 'v1', title: 'Backend Go', companyName: 'Северный поток', covered: 5, total: 7, missing: [{ statement: 'Кэш' }], reason: 'По вакансиям на платформе' }, 0)!;
    expect(c.meta).toBe('закрываешь 5 из 7');
    expect(c.missing).toEqual(['Кэш']);
    expect(JSON.stringify(c)).not.toMatch(/%|шанс|вероятн/u);
  });

  it('задание из банка — тема практики без ссылки (/projects/:id — задания компаний)', () => {
    const c = normalizeRecommendation({ taskId: 't 1', title: 'Шардирование', family: 'backend.highload', grade: 'senior' }, 0)!;
    expect(c.href).toBeUndefined();
    expect(c.meta).toBe('backend.highload · Senior');
  });

  it('мусор — null', () => {
    expect(normalizeRecommendation(null, 0)).toBeNull();
    expect(normalizeRecommendation({}, 0)).toBeNull();
  });
});
