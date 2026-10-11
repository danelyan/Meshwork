import { readFileSync } from 'node:fs';
import path from 'node:path';

import { catalogFromFile } from '@/server/claims/catalog-file';
import { CALL_RECORDING_CONSENT_PARAGRAPHS, CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { CONSENT_TEXTS } from '@/server/consent/texts';
import {
  AnswerError,
  answerLabel,
  currentStep,
  historyOf,
  isClosed,
  nextOpen,
  progress,
  validateAnswer,
  visibleSteps,
} from '@/server/onboarding/engine';
import { checkInn } from '@/server/onboarding/inn';
import { MAX_NEEDS, computeNeeds } from '@/server/onboarding/needs';
import { cleanLead, firstName, templateLead } from '@/server/onboarding/phrase';
import { ONBOARDING_PROMPT } from '@/server/onboarding/prompt';
import { assemblePrompt } from '@/server/agent/prompts/assemble';
import { BASE_STEPS, CANDIDATE_STEPS, EMPLOYER_STEPS, findStep } from '@/server/onboarding/scenario';
import type { Answers, Facts, StepContext } from '@/server/onboarding/types';

// Согласия онбординга (ADR 0005) по умолчанию уже решены: проверки порядка шагов — без шага consents.
const facts = (f: Partial<Facts> = {}): Facts => ({ role: 'pending', consent: false, candidateConsents: true, employerConsents: true, name: 'Иван Петров', fspState: null, specialization: null, ...f });
const ctx = (answers: Answers = {}, f: Partial<Facts> = {}): StepContext => ({ answers, facts: facts(f) });
const ids = (c: StepContext) => visibleSteps(c).map((s) => s.id);
const step = (id: string) => findStep(id)!;

describe('сценарий онбординга', () => {
  it('порядок шагов кандидата: цель, документы, ФСП, направление, опыт (приватный), грейд, условия', () => {
    expect(CANDIDATE_STEPS.map((s) => s.id)).toEqual(['candidateConsents', 'goal', 'documents', 'fsp', 'specialization', 'subcategory', 'experience', 'experienceSummary', 'candidateIndustries', 'grade', 'stack', 'formats', 'city', 'salary', 'candidateContact', 'fspParticipation']);
  });

  it('новые self-report поля приватны, необязательны и ограничены; произвольного грейда нет', () => {
    const c = ctx({}, { role: 'candidate', consent: true });
    for (const id of ['experience', 'experienceSummary', 'candidateIndustries']) {
      expect(step(id).required).not.toBe(true);
      expect(step(id).target).toContain('OnboardingState.answers.');
    }
    expect(validateAnswer(step('experience'), 'oneToThree', c)).toBe('oneToThree');
    expect(() => validateAnswer(step('experience'), 'senior', c)).toThrow(AnswerError);
    expect(() => validateAnswer(step('experienceSummary'), 'x'.repeat(1001), c)).toThrow(AnswerError);
    expect(validateAnswer(step('experienceSummary'), 'x'.repeat(1000), c)).toHaveLength(1000);
    expect(() => validateAnswer(step('candidateIndustries'), Array(13).fill('Образование'), c)).toThrow(AnswerError);
    expect(() => validateAnswer(step('candidateIndustries'), ['x'.repeat(61)], c)).toThrow(AnswerError);
    expect(() => validateAnswer(step('grade'), 'principal', c)).toThrow(AnswerError);
  });

  it('каждый шаг трассируется на R-* и цель записи', () => {
    for (const s of [...CANDIDATE_STEPS, ...EMPLOYER_STEPS]) {
      expect(s.req).toMatch(/R-[A-Z]+-\d+/);
      expect(s.target.length).toBeGreaterThan(3);
    }
  });

  it('до выбора роли — только согласие и роль; роль выбирает ветку', () => {
    expect(ids(ctx())).toEqual(['consent', 'role', 'summary']);
    expect(ids(ctx({ role: 'candidate' }))).toContain('goal');
    expect(ids(ctx({}, { role: 'employer' }))).toContain('needSalary');
    expect(ids(ctx({}, { role: 'employer' }))).not.toContain('goal');
  });

  it('согласия (ADR 0005): шаг consents первым у кандидата и после названия компании у работодателя; ноль галочек — ответ', () => {
    const c = ctx({}, { consent: true, role: 'candidate', candidateConsents: false });
    expect(nextOpen(c, [], null).id).toBe('candidateConsents');
    expect(validateAnswer(step('candidateConsents'), [], c)).toEqual([]);
    expect(validateAnswer(step('candidateConsents'), ['ai_assessment', 'ai_assessment'], c)).toEqual(['ai_assessment']);
    expect(() => validateAnswer(step('candidateConsents'), ['employer_offer'], c)).toThrow(AnswerError);
    expect(answerLabel(step('candidateConsents'), [], c)).toBe('Без дополнительных согласий');
    const e = ctx({}, { consent: true, role: 'employer', employerConsents: false });
    expect(ids(e).slice(ids(e).indexOf('companyName'), ids(e).indexOf('companyName') + 2)).toEqual(['companyName', 'employerConsents']);
    expect(isClosed(step('candidateConsents'), ctx({}, { role: 'candidate', candidateConsents: true }), [])).toBe(true);
  });

  it('условия: город — только при офисе или гибриде; участие в ФСП — если ФСП ID не привязан', () => {
    const base = { role: 'candidate' };
    expect(ids(ctx({ ...base, formats: ['remote'] }))).not.toContain('city');
    expect(ids(ctx({ ...base, formats: ['remote', 'hybrid'] }))).toContain('city');
    expect(ids(ctx(base, { fspState: 'linked' }))).not.toContain('fspParticipation');
    expect(ids(ctx(base, { fspState: 'not_linked' }))).toContain('fspParticipation');
  });

  it('направления: четыре из справочника (ADR 0003, 10.10), остальные «скоро»', () => {
    const opts = step('specialization').options as { value: string; disabled?: boolean }[];
    expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['backend', 'frontend', 'ai', 'engineering']);
    expect(opts.filter((o) => o.disabled).length).toBeGreaterThanOrEqual(3);
  });

  it('подкатегория: шаг после направления, варианты только своего направления, обязательна (тест идёт по подкатегории)', () => {
    const base = { role: 'candidate' };
    expect(ids(ctx(base))).not.toContain('subcategory');
    expect(ids(ctx({ ...base, specialization: 'ai' }))).toContain('subcategory');
    expect(ids(ctx(base, { specialization: 'backend' }))).toContain('subcategory');
    const c = ctx({ ...base, specialization: 'ai' });
    const sub = step('subcategory');
    expect(sub.required).toBe(true);
    expect(step('needSubcategory').required).toBe(true);
    const values = (typeof sub.options === 'function' ? sub.options(c) : []).map((o) => o.value);
    expect(values).toEqual(['ai.llm-apps', 'ai.ai-integration', 'ai.ml-engineering', 'ai.mlops', 'ai.data-science', 'ai.bi-analytics']);
    expect(() => validateAnswer(sub, 'backend.web-api', c)).toThrow(AnswerError);
    expect(validateAnswer(sub, 'ai.mlops', c)).toBe('ai.mlops');
    const emp = ctx({ needSpecialization: 'engineering' }, { role: 'employer' });
    expect(ids(emp)).toContain('needSubcategory');
    const needOpts = step('needSubcategory').options as (x: StepContext) => { value: string }[];
    expect(needOpts(emp).map((o) => o.value)).toContain('engineering.data-eng');
  });
});

describe('движок: переходы, пропуски, восстановление', () => {
  it('согласие и роль закрываются фактами из БД', () => {
    const c = ctx({}, { consent: true, role: 'candidate' });
    expect(isClosed(step('consent'), c, [])).toBe(true);
    expect(isClosed(step('role'), c, [])).toBe(true);
    expect(nextOpen(c, [], null).id).toBe('goal');
  });

  it('следующий — первый незакрытый после текущего; пропуск закрывает шаг', () => {
    const c = ctx({ goal: 'job_search' }, { consent: true, role: 'candidate' });
    expect(nextOpen(c, [], 'goal').id).toBe('documents');
    expect(nextOpen(c, ['documents'], 'goal').id).toBe('fsp');
  });

  it('из итога вернулись к пропущенному и ответили — снова итог', () => {
    const answers: Answers = Object.fromEntries(
      CANDIDATE_STEPS.filter((s) => s.id !== 'city').map((s) => [s.id, 'x']),
    );
    delete answers.stack;
    const c = ctx({ ...answers, formats: ['remote'] }, { consent: true, role: 'candidate', fspState: 'not_linked' });
    expect(nextOpen(c, ['stack'], 'fspParticipation').id).toBe('summary');
    const after = ctx({ ...answers, formats: ['remote'], stack: ['Go'] }, c.facts);
    expect(nextOpen(after, [], 'stack').id).toBe('summary');
  });

  it('незакрытый шаг раньше текущего не теряется (пропуск через goto)', () => {
    const c = ctx({ goal: 'job_search' }, { consent: true, role: 'candidate' });
    // Последний шаг ответили, а documents открыт - после последнего ведём к нему, а не на итог.
    expect(nextOpen(c, [], 'fspParticipation').id).toBe('documents');
  });

  it('восстановление: сохранённый шаг продолжается после перезагрузки; закрытый фактом — пропускается', () => {
    const c = ctx({ goal: 'job_search' }, { consent: true, role: 'candidate' });
    expect(currentStep(c, { stepId: 'grade', answers: c.answers, skipped: [] }).id).toBe('grade');
    expect(currentStep(c, { stepId: 'consent', answers: c.answers, skipped: [] }).id).toBe('documents');
    expect(currentStep(c, { stepId: 'city', answers: c.answers, skipped: [] }).id).toBe('documents'); // city не виден
    // итог, когда есть открытые шаги, не показываем
    expect(currentStep(c, { stepId: 'summary', answers: c.answers, skipped: [] }).id).toBe('documents');
  });

  it('прогресс: пока роль не выбрана — по длине сценария кандидата; пропуск считается пройденным', () => {
    const p0 = progress(ctx(), []);
    expect(p0.done).toBe(0);
    expect(p0.total).toBe(visibleSteps(ctx({ role: 'candidate' })).length - 1);
    const p1 = progress(ctx({ goal: 'job_search' }, { consent: true, role: 'candidate' }), ['documents']);
    expect(p1.done).toBe(4); // роль, согласия онбординга (ADR 0005), цель, документы: согласие Г1 взято при регистрации и в чате не считается
  });

  it('роль из аккаунта: пока согласие не дано, шаг роли не в ленте и не в прогрессе', () => {
    const c = ctx({}, { role: 'candidate' });
    expect(currentStep(c, { stepId: null, answers: c.answers, skipped: [] }).id).toBe('consent');
    expect(historyOf(c, { stepId: null, answers: c.answers, skipped: [] }, step('consent'))).toEqual([]);
    expect(progress(c, []).done).toBe(0);
    const c2 = ctx({}, { role: 'candidate', consent: true });
    expect(progress(c2, []).done).toBe(2); // роль и шаг согласий (по умолчанию в фикстуре решён)
  });

  it('согласие взято при регистрации: шага согласия в чате нет, первый вопрос — роль с приветствием без модели', () => {
    const c = ctx({}, { consent: true });
    expect(ids(c)).toEqual(['role', 'summary']);
    expect(currentStep(c, { stepId: null, answers: {}, skipped: [] }).id).toBe('role');
    const lead = templateLead(step('role'), c, null);
    expect(lead).toMatch(/^Привет, Иван! Я Кира, помощница MESHWORK\./);
    expect(lead).not.toMatch(/согласи|данн/i);
    // Страховка: аккаунт без записанного согласия видит шаг согласия первым.
    expect(ids(ctx())[0]).toBe('consent');
  });

  it('лента — закрытые шаги без текущего', () => {
    const c = ctx({ goal: 'job_search' }, { consent: true, role: 'candidate' });
    const h = historyOf(c, { stepId: 'goal', answers: c.answers, skipped: [] }, step('goal'));
    expect(h.map((s) => s.id)).toEqual(['role', 'candidateConsents']);
  });
});

describe('проверка ответов', () => {
  const cand = ctx({ role: 'candidate' }, { role: 'candidate', consent: true });
  const bad = (id: string, v: unknown, c = cand) => expect(() => validateAnswer(step(id), v, c)).toThrow(AnswerError);

  it('one: вариант из списка; недоступный «скоро» и чужой — отказ; свой — где разрешён', () => {
    expect(validateAnswer(step('specialization'), 'backend', cand)).toBe('backend');
    bad('specialization', 'mobile');
    bad('goal', 'whatever');
    const emp = ctx({}, { role: 'employer', consent: true });
    expect(validateAnswer(step('industry'), '  Логистика ', emp)).toBe('Логистика');
  });

  it('many: только из вариантов, без дублей, не пусто', () => {
    expect(validateAnswer(step('formats'), ['remote', 'remote', 'office'], cand)).toEqual(['remote', 'office']);
    bad('formats', []);
    bad('formats', ['moon']);
  });

  it('chips: регистр приводится к варианту, своё разрешено, дубли схлопываются', () => {
    const c = ctx({ role: 'candidate', specialization: 'backend' }, cand.facts);
    expect(validateAnswer(step('stack'), ['go', 'Go', 'Erlang'], c)).toEqual(['Go', 'Erlang']);
    bad('stack', []);
    bad('stack', ['x'.repeat(61)]);
  });

  it('range: целые в границах, от ≤ до', () => {
    expect(validateAnswer(step('salary'), { from: 100, to: 200 }, cand)).toEqual({ from: 100, to: 200 });
    bad('salary', { from: 300, to: 200 });
    bad('salary', { from: 10, to: 200 });
    bad('salary', { from: 100.5, to: 200 });
  });

  it('text: длина; ИНН — по контрольной сумме', () => {
    const emp = ctx({}, { role: 'employer', consent: true });
    expect(validateAnswer(step('inn'), '7707083893', emp)).toBe('7707083893');
    expect(() => validateAnswer(step('inn'), '7707083894', emp)).toThrow(/контрольная/);
    expect(() => validateAnswer(step('about'), '', emp)).toThrow(AnswerError);
  });

  it('контакт (Q-35): шаг кандидата после зарплаты, почта или Telegram, служебная почта — отказ', () => {
    const order = ids(ctx({ role: 'candidate' }, { fspState: 'not_linked' }));
    expect(order.indexOf('candidateContact')).toBe(order.indexOf('salary') + 1);
    expect(order.indexOf('candidateContact')).toBeLessThan(order.indexOf('fspParticipation'));
    expect(step('candidateContact').target).toBe('Candidate.contact');
    expect(step('candidateContact').required).toBeFalsy();
    expect(validateAnswer(step('candidateContact'), ' ivan@mail.ru ', cand)).toBe('ivan@mail.ru');
    expect(validateAnswer(step('candidateContact'), '@ivan_dev', cand)).toBe('@ivan_dev');
    expect(validateAnswer(step('candidateContact'), 'ivan_dev', cand)).toBe('@ivan_dev');
    expect(validateAnswer(step('candidateContact'), 'https://t.me/ivan_dev', cand)).toBe('@ivan_dev');
    for (const v of ['напишите мне', '@abc', 'ivan@', 'user-1@users.invalid', '+7 900 000-00-00']) {
      expect(() => validateAnswer(step('candidateContact'), v, cand)).toThrow(/почту .* или Telegram/);
    }
    // контакт компании проверяется тем же правилом
    const emp = ctx({}, { role: 'employer', consent: true });
    expect(validateAnswer(step('contact'), 't.me/romashka_hr', emp)).toBe('@romashka_hr');
    expect(() => validateAnswer(step('contact'), 'звоните', emp)).toThrow(AnswerError);
  });

  it('files: нужен хотя бы файл или ссылка, ссылка — URL', () => {
    expect(validateAnswer(step('documents'), { uploadIds: ['u1'], claims: 3 }, cand)).toEqual({ uploadIds: ['u1'], urls: [], claims: 3 });
    bad('documents', { uploadIds: [], urls: [] });
    bad('documents', { urls: ['not a url'] });
  });

  it('consent и role', () => {
    expect(validateAnswer(step('consent'), { version: 'v1' }, ctx())).toEqual({ version: 'v1' });
    expect(validateAnswer(step('role'), 'employer', ctx())).toBe('employer');
    bad('role', 'admin', ctx());
  });

  it('подписи ответов для ленты и сводки', () => {
    expect(answerLabel(step('formats'), ['remote', 'office'], cand)).toBe('Удалённо, Офис');
    expect(answerLabel(step('salary'), { from: 100, to: 150 }, cand)).toBe('минимум 100, ожидаю 150 тыс ₽ / мес');
    expect(answerLabel(step('documents'), { uploadIds: ['a'], urls: [], claims: 2 }, cand)).toBe('файлов: 1, утверждений найдено: 2');
  });
});

describe('ИНН', () => {
  it('10 и 12 цифр с верной контрольной суммой проходят, опечатка — нет', () => {
    expect(checkInn('7707083893')).toEqual({ ok: true, kind: 'legal' });
    expect(checkInn('500100732259')).toEqual({ ok: true, kind: 'individual' });
    expect(checkInn('500100732258').ok).toBe(false);
    expect(checkInn('12345').ok).toBe(false);
    expect(checkInn('77070838a3').ok).toBe(false);
  });
});

describe('потребность → каталог', () => {
  const catalog = catalogFromFile();
  it('ядро грейда + записи по стеку, стек первым, не больше лимита', () => {
    const needs = computeNeeds(catalog, 'backend', 'middle', ['Kafka']);
    expect(needs.length).toBeLessThanOrEqual(MAX_NEEDS);
    expect(needs[0]!.catalogId).toBe('be.message-queue');
    expect(needs.every((n) => n.catalogId.startsWith('be.') || n.catalogId.startsWith('common.'))).toBe(true);
    expect(needs.every((n) => n.weight >= 1 && n.weight <= 3)).toBe(true);
  });
  it('запись без веса для грейда не попадает (message-queue у Junior)', () => {
    const needs = computeNeeds(catalog, 'backend', 'junior', ['Kafka']);
    expect(needs.map((n) => n.catalogId)).not.toContain('be.message-queue');
    expect(needs.length).toBeGreaterThan(0);
  });
});

describe('тексты вариантов', () => {
  it('ни один label варианта не совпадает с label варианта соседнего шага', () => {
    for (const steps of [[...BASE_STEPS, ...CANDIDATE_STEPS], [...BASE_STEPS, ...EMPLOYER_STEPS]]) {
      for (let i = 0; i + 1 < steps.length; i++) {
        const labels = (s: (typeof steps)[number]) => (Array.isArray(s.options) ? s.options.map((o) => o.label.toLowerCase()) : []);
        const next = new Set(labels(steps[i + 1]!));
        for (const l of labels(steps[i]!)) expect(next.has(l), `${steps[i]!.id} -> ${steps[i + 1]!.id}: «${l}»`).toBe(false);
      }
    }
  });
  it('роль и цель не повторяют друг друга', () => {
    const role = BASE_STEPS.find((s) => s.id === 'role')!.options as { label: string }[];
    const goal = CANDIDATE_STEPS.find((s) => s.id === 'goal')!.options as { label: string }[];
    for (const r of role) expect(goal.map((g) => g.label)).not.toContain(r.label);
  });
  it('связка опирается на предыдущий ответ', () => {
    const c = ctx({ goal: 'grade_confirm', specialization: 'backend' }, { role: 'candidate' });
    expect(templateLead(step('grade'), c, { step: step('specialization'), value: 'backend', label: 'Backend' })).toMatch(/подтвердить грейд/);
  });
});

describe('реплики помощника', () => {
  it('имя из аккаунта: без «Демо:» и скобок; мусор — пусто', () => {
    expect(firstName('Демо: Анна Кравец (HR, работодатель)')).toBe('Анна');
    expect(firstName('Иван Петров')).toBe('Иван');
    expect(firstName('user_123')).toBe('');
  });
  it('шаблоны: приветствие по имени, связка от цели, пропуск', () => {
    expect(templateLead(step('consent'), ctx(), null)).toMatch(/^Привет, Иван!/);
    const c = ctx({ goal: 'grade_confirm' }, { role: 'candidate' });
    expect(templateLead(step('documents'), c, { step: step('goal'), value: 'grade_confirm', label: 'x' })).toMatch(/тест/);
    expect(templateLead(step('fsp'), c, { step: step('documents'), value: undefined, label: null })).toMatch(/вернуться/);
  });
  it('шаблоны говорят от лица Киры в женском роде', () => {
    const prev = { step: step('goal'), value: 'job_search', label: 'Ищу работу' };
    const c = ctx({ specialization: 'backend', needSpecialization: 'frontend' }, { role: 'candidate' });
    expect(templateLead(step('grade'), c, prev)).toBe('Backend - поняла.');
    expect(templateLead(step('grade'), ctx({ goal: 'grade_confirm', specialization: 'backend' }), prev)).toMatch(/^Backend - поняла\. Раз хочешь/);
    expect(templateLead(step('grade'), ctx(), prev)).toBe('Поняла.');
    expect(templateLead(step('city'), c, prev)).toBe('Офис или гибрид - поняла.');
    expect(templateLead(step('inn'), c, prev)).toBe('Записала.');
    expect(templateLead(step('needGrades'), c, prev)).toBe('Frontend - поняла.');
    expect(templateLead(step('needGrades'), ctx(), prev)).toBe('Поняла.');
    // ни один шаблон не говорит о себе в мужском роде
    const masculine = /(?<![\p{L}])(понял|записал|принял|нашёл|нашел|собрал|прочитал|подготовил|смог|готов)(?![\p{L}])/iu;
    for (const s of [...BASE_STEPS, ...CANDIDATE_STEPS, ...EMPLOYER_STEPS]) {
      for (const cx of [c, ctx(), ctx({ goal: 'grade_confirm' }, { role: 'employer' })]) {
        for (const p of [prev, null]) expect(templateLead(s, cx, p), s.id).not.toMatch(masculine);
      }
    }
  });
  it('ответ модели: короткий текст без разметки, иначе — шаблон', () => {
    expect(cleanLead('«Отлично, Иван.»')).toBe('Отлично, Иван.');
    expect(cleanLead('# Заголовок')).toBeNull();
    expect(cleanLead('x'.repeat(300))).toBeNull();
    expect(cleanLead(undefined)).toBeNull();
  });
  it('prompt.ts собран из prompts/onboarding.md и platform-facts.md', () => {
    const md = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/onboarding.md'), 'utf8');
    const facts = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/platform-facts.md'), 'utf8');
    expect(ONBOARDING_PROMPT).toBe(assemblePrompt(md, facts));
  });
  it('тексты согласий совпадают с docs/consent.md (все виды, ADR 0005)', () => {
    const md = readFileSync(path.join(process.cwd(), '../docs/consent.md'), 'utf8').replace(/\s+/g, ' ');
    for (const p of [...CONSENT_PARAGRAPHS, ...CALL_RECORDING_CONSENT_PARAGRAPHS]) expect(md).toContain(p);
    for (const t of Object.values(CONSENT_TEXTS)) {
      expect(md).toContain(t.version);
      for (const p of t.paragraphs) expect(md).toContain(p);
    }
  });
});

it('ФСП: в ленте — состояние, а не действие кнопки', () => {
  const c = { answers: {}, facts: { role: 'candidate' as const, consent: true, name: '', fspState: null, specialization: null } };
  expect(answerLabel(findStep('fsp')!, 'linked', c)).toBe('ФСП ID привязан');
  expect(answerLabel(findStep('fsp')!, 'no_achievements', c)).toBe('ФСП ID привязан, достижений пока нет');
  expect(answerLabel(findStep('fsp')!, 'unavailable', c)).toBe('ФСП ID привязан, реестр сейчас недоступен');
  expect(answerLabel(findStep('fsp')!, 'not_linked', c)).toBe('Нет истории ФСП');
});

it('ФСП: «Войти через ФСП ID» — ссылка на OIDC-вход, ответом через API не принимается', () => {
  const c = { answers: {}, facts: { role: 'candidate' as const, consent: true, name: '', fspState: null, specialization: null } };
  const step = findStep('fsp')!;
  expect((step.options as { value: string; href?: string }[]).find((o) => o.value === 'linked')?.href).toBe('/api/fsp-id/link?return=consultant');
  expect(() => validateAnswer(step, 'linked', c)).toThrow(/вход во внешний сервис/);
  expect(validateAnswer(step, 'not_linked', c)).toBe('not_linked');
});
