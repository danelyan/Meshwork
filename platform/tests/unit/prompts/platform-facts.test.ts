// Лейн аудита промптов `platform-facts`: факты из platform-facts.md и базы знаний (knowledge/docs) сверяются с константами
// и поведением кода. Поменялась константа или правило — тест падает, пока не поправлен текст и не пересобраны промпты
// (npx tsx scripts/build-prompts.ts). Без сети и БД.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS } from '@/server/admin/settings/registry';
import { EMPLOYER_PROMPT, EMPLOYER_PROMPT_VERSION } from '@/server/agent/employer/prompt';
import { buildCorpusSource } from '@/server/agent/knowledge/build';
import { CONSULTANT_PROMPT, CONSULTANT_PROMPT_VERSION } from '@/server/agent/prompt';
import { assemblePrompt, factsBlock, promptVersion } from '@/server/agent/prompts/assemble';
import { CALL_LIMITS } from '@/server/call/plan';
import { LEVEL_ORDER } from '@/server/claims/levels';
import { LIMITS } from '@/server/collector/limits';
import { CALL_RECORDING_RETENTION_DAYS_DEFAULT } from '@/server/consent/texts';
import { candidateContact, toCandidateCard } from '@/server/employer/privacy';
import { dropUncovered, passesFilters, type CandidateEvidence } from '@/server/employer/ranking';
import {
  CALL_TOPIC_BONUS,
  CATEGORY_BASE,
  DAILY_INVITATION_LIMIT,
  FSP_BOOST,
  MIN_COVERED_FOR_VACANCY,
  PROJECT_BONUS_PER_SCORE,
  SPEC_MISMATCH_PENALTY,
} from '@/server/employer/weights';
import { INTERVIEW_LIMITS } from '@/server/interview/plan';
import { ONBOARDING_PROMPT, ONBOARDING_PROMPT_VERSION } from '@/server/onboarding/prompt';
import { GRADE_CHANGE_INTERVAL_DAYS, RETAKE_SAME_GRADE_DAYS } from '@/server/recommend/weights';
import { CONFIRM_PROB, JUNIOR_PROBE_MAX, MAX_ITEMS, MIDDLE_PROBE_MAX, SENIOR_MAIN_MAX } from '@/server/test/policy';
import { MAX_ATTACHMENTS } from '@/components/chat/attachments';
import { MAX_UPLOAD_BYTES, validateUploadFile } from '@/lib/api';
import { SPEC_LABEL } from '@/lib/directions';
import { LEVEL_LABEL } from '@/lib/labels';
import { DEFAULT_ITEM_LIMITS } from '@/lib/test-limits';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const factsMd = read('src/server/agent/prompts/platform-facts.md');
const block = factsBlock(factsMd);
const kdir = 'src/server/agent/knowledge/docs';
const kdoc = (id: string) => read(`${kdir}/${id}.md`);

/** Текст факта F<n> из блока (одна строка). */
function fact(id: string): string {
  const line = block.split('\n').find((l) => l.startsWith(`${id}. `));
  if (!line) throw new Error(`нет факта ${id}`);
  return line;
}

/** Текст секции {#id} документа базы знаний. */
function section(docId: string, id: string): string {
  const md = kdoc(docId);
  const m = new RegExp(`\\{#${id}\\}\\n([^\\n]+)`).exec(md);
  if (!m) throw new Error(`нет секции ${docId}#${id}`);
  return m[1]!;
}

const MB = 1024 * 1024;

describe('platform-facts: сгенерированные файлы в синхроне с .md (пересборка в памяти)', () => {
  it('prompt.ts консультанта, работодателя и онбординга = assemblePrompt(.md, platform-facts.md)', () => {
    const cases = [
      ['consultant.md', CONSULTANT_PROMPT, CONSULTANT_PROMPT_VERSION],
      ['employer.md', EMPLOYER_PROMPT, EMPLOYER_PROMPT_VERSION],
      ['onboarding.md', ONBOARDING_PROMPT, ONBOARDING_PROMPT_VERSION],
    ] as const;
    for (const [file, prompt, version] of cases) {
      const md = read(`src/server/agent/prompts/${file}`);
      expect(prompt, `${file}: пересобери npx tsx scripts/build-prompts.ts`).toBe(assemblePrompt(md, factsMd));
      expect(version).toBe(promptVersion(md));
    }
  });

  it('corpus.ts = buildCorpusSource(platform-facts.md, knowledge/docs/*.md)', () => {
    const docs = readdirSync(path.join(root, kdir))
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ docId: f.replace(/\.md$/, ''), md: kdoc(f.replace(/\.md$/, '')) }));
    expect(read('src/server/agent/knowledge/corpus.ts')).toBe(buildCorpusSource(factsMd, docs).source);
  });
});

describe('platform-facts: числа из констант кода', () => {
  it('интервалы пересдачи и смены грейда: в фактах их нет (их даёт get_test_status), в базе знаний — = константам', () => {
    expect(fact('F7')).toContain('get_test_status');
    expect(block).not.toMatch(/\d+\s+дн/);
    const retake = section('grade-test', 'retake');
    expect(retake).toContain(`через ${RETAKE_SAME_GRADE_DAYS} дней`);
    expect(retake).toContain(`раза в ${GRADE_CHANGE_INTERVAL_DAYS} дней`);
    // Интервалы правятся в админке без деплоя: умолчание реестра — те же константы.
    expect(SETTINGS['test.retakeSameGradeDays'].default()).toBe(RETAKE_SAME_GRADE_DAYS);
    expect(SETTINGS['test.gradeChangeIntervalDays'].default()).toBe(GRADE_CHANGE_INTERVAL_DAYS);
  });

  it('длина теста, дозадавание и порог подтверждения = policy.ts', () => {
    const how = section('grade-test', 'how');
    expect(how).toContain(`${DEFAULT_ITEM_LIMITS.min}–${DEFAULT_ITEM_LIMITS.max} заданий`);
    expect(how).toContain(`Senior — ${SENIOR_MAIN_MAX})`);
    expect(how).toContain(`до ${JUNIOR_PROBE_MAX} заданий Junior`);
    expect(how).toContain(`до ${MIDDLE_PROBE_MAX} заданий Middle`);
    const decision = section('grade-test', 'decision');
    expect(decision).toContain(`не ниже ${Math.round(CONFIRM_PROB * 100)} %`);
    expect(decision).toContain(`раньше ${MAX_ITEMS} заданий`);
    expect(section('grade-test', 'accuracy')).toContain(`Порог ${Math.round(CONFIRM_PROB * 100)} %`);
  });

  it('число вопросов ИИнтервью и квалифицирующего созвона = interview/plan.ts и call/plan.ts', () => {
    const s = section('grade-test', 'interview');
    expect(s).toContain(`${INTERVIEW_LIMITS.minQuestions}-${INTERVIEW_LIMITS.maxQuestions} вопросов (до ${INTERVIEW_LIMITS.hardMaxQuestions} с уточняющими)`);
    expect(s).toContain(`${CALL_LIMITS.minQuestions}-${CALL_LIMITS.maxQuestions} вопросов (до ${CALL_LIMITS.hardMaxQuestions} с уточняющими)`);
  });

  it('срок хранения аудио созвонов = умолчанию согласия', () => {
    expect(section('faq', 'retention')).toContain(`по умолчанию хранится ${CALL_RECORDING_RETENTION_DAYS_DEFAULT} дней`);
  });

  it('загрузки (F16): форматы, размер, страницы PDF, число вложений = коду', () => {
    const f = fact('F16');
    expect(MAX_UPLOAD_BYTES).toBe(LIMITS.fileMaxBytes);
    expect(f).toContain(`до ${MAX_UPLOAD_BYTES / MB} МБ`);
    expect(f).toContain(`PDF до ${LIMITS.pdfMaxPages} страниц`);
    expect(f).toContain(`до ${MAX_ATTACHMENTS} файлов`);
    const formats = 'PDF, DOCX, MD, TXT, CSV, JPG и PNG';
    expect(f).toContain(formats);
    // Тот же список — в тексте ошибки клиента; каждый формат принимается, Excel — нет.
    expect(validateUploadFile({ name: 'a.xlsx', size: 1 })).toContain(formats);
    for (const ext of formats.replace(' и ', ', ').split(', ')) expect(validateUploadFile({ name: `a.${ext.toLowerCase()}`, size: 1 }), ext).toBeNull();
    expect(validateUploadFile({ name: 'a.png', size: MAX_UPLOAD_BYTES + 1 })).not.toBeNull();
    expect(f).toContain('OCR');
    // Лимит загрузок — настройка админки (0 — без лимита), числа в факте нет.
    expect(SETTINGS['uploads.dailyLimit'].schema.safeParse(0).success).toBe(true);
    expect(f).toMatch(/суточный лимит[^.]*задаёт администратор/);
  });

  it('лимит приглашений и прочие числа, которые даёт инструмент, в факты не зашиты', () => {
    expect(fact('F6')).toContain('get_employer_context');
    expect(fact('F6')).not.toMatch(new RegExp(`\\b${DAILY_INVITATION_LIMIT}\\b`));
    expect(SETTINGS['employer.dailyInvitationLimit'].default()).toBe(DAILY_INVITATION_LIMIT);
    // Лимиты созвонов и токенов по умолчанию выключены — в фактах о них не обещаем ничего.
    expect(SETTINGS['call.dailyLimit'].default()).toBe(0);
    expect(SETTINGS['llm.dailyTokenBudget'].default()).toBe(0);
    expect(block).not.toMatch(/созвонов в сутки|токен/);
  });
});

describe('platform-facts: правила, сверенные с поведением кода', () => {
  const ev = (over: Partial<CandidateEvidence> = {}): CandidateEvidence => ({ id: 'c1', specialization: 'backend', fspState: 'not_linked', category: null, claims: [], ...over }) as CandidateEvidence;

  it('F7: направления и грейды = lib/directions.ts', () => {
    for (const label of Object.values(SPEC_LABEL)) {
      expect(fact('F7')).toContain(label);
      expect(section('grade-test', 'what')).toContain(label);
    }
    for (const g of ['Junior', 'Middle', 'Senior']) expect(fact('F7')).toContain(g);
  });

  it('F8: порядок уровней доказанности = LEVEL_ORDER', () => {
    const name = (l: (typeof LEVEL_ORDER)[number]) => (l === 'platform' ? 'проверено платформой' : LEVEL_LABEL[l]);
    for (const text of [fact('F8'), section('evidence', 'levels')]) {
      const pos = LEVEL_ORDER.map((l) => text.indexOf(`«${name(l)}»`));
      expect(pos.every((p) => p >= 0), text).toBe(true);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    }
    for (const text of [fact('F8'), section('evidence', 'levels')]) expect(text).toMatch(/созвоне с консультантом/);
  });

  it('F2: без категории из теста кандидат виден только в расширенном пуле', () => {
    expect(passesFilters(ev(), {})).toBe(false);
    expect(passesFilters(ev(), { expandPool: true })).toBe(true);
    expect(passesFilters(ev({ category: { specialization: 'backend', grade: 'junior' } }), {})).toBe(true);
    expect(fact('F2')).toMatch(/расширит пул/);
    expect(section('employer-view', 'pool')).toMatch(/расширит пул/);
    for (const t of [fact('F2'), section('employer-view', 'pool'), section('faq', 'hide')]) expect(t).toContain('«Настройках»');
  });

  it('F3: в подборку под потребность попадают по покрытию, совпавшей категории или проекту; сигналы ранжирования названы', () => {
    expect(MIN_COVERED_FOR_VACANCY).toBe(1);
    const keep = dropUncovered([
      { covered: 1, categoryMatch: false },
      { covered: 0, categoryMatch: true },
      { covered: 0, categoryMatch: false, ownProject: true },
      { covered: 0, categoryMatch: false },
    ]);
    expect(keep).toHaveLength(3);
    for (const t of [fact('F3'), section('employer-view', 'ranking') + section('employer-view', 'pool')]) {
      expect(t).toMatch(/хотя бы одно[^.]*требование/);
      expect(t).toMatch(/подходящей категорией из теста/);
      expect(t).toMatch(/проект(ом)? под эту потребность/);
      if (PROJECT_BONUS_PER_SCORE > 0) expect(t).toMatch(/проверенный проект/);
      if (CALL_TOPIC_BONUS > 0) expect(t).toMatch(/подтверждённые на созвоне/);
      if (FSP_BOOST > 0) expect(t).toMatch(/достижения ФСП/);
      if (SPEC_MISMATCH_PENALTY > 0) expect(t).toMatch(/другая специализация снижает/);
      expect(t).toMatch(/подкатегории идут выше/);
    }
    expect(CATEGORY_BASE).toBeGreaterThan(0);
  });

  it('F5: до принятия — псевдоним и публичная карточка со стажем; после — имя и контакт (иначе почта аккаунта)', () => {
    const src = {
      id: 'c1', name: 'Иван', email: 'ivan@example.ru', contact: null, specialization: 'backend' as const, fspState: 'not_linked' as const, category: null, claims: [],
      experience: { experienceYears: 3, roles: ['Backend-разработчик'], softSkills: [] },
    };
    const closed = toCandidateCard(src, false);
    expect(closed.displayName).toMatch(/^Кандидат #/);
    expect(closed.contacts).toBeNull();
    expect(closed.experience?.years).toBe(3);
    expect(toCandidateCard(src, true).contacts).toEqual({ name: 'Иван', contact: 'ivan@example.ru' });
    expect(candidateContact({ contact: '@ivan', email: 'ivan@example.ru' })).toBe('@ivan');
    const f5 = fact('F5');
    expect(f5).toContain('стаж');
    expect(f5).toContain('Имени, контакта, цитат и резюме он не видит');
    expect(f5).toContain('почту аккаунта');
    expect(f5).toContain('«Моих согласиях»');
    expect(section('employer-view', 'card')).toContain('стаж');
  });
});
