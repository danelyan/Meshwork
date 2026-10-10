import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CONSULTANT_PROMPT, CONSULTANT_PROMPT_VERSION } from '@/server/agent/prompt';
import { assemblePrompt, promptVersion } from '@/server/agent/prompts/assemble';
import { FORBIDDEN_TOOL_NAME_RE, toolSpecs } from '@/server/agent/spec';
import { scoreEntry } from '@/server/agent/tools/catalog_search';
import { tools, TOOL_NAMES } from '@/server/agent/tools';
import type { CatalogEntry } from '@/server/claims/types';

const EXPECTED = [
  'read_upload',
  'fetch_url',
  'fetch_profile',
  'catalog_search',
  'propose_claims',
  'get_profile',
  'get_gap_map',
  'recommend_test',
  'recommend_tasks',
  'recommend_targets',
  'explain_invitation',
  'start_verification',
  'render_profile_pdf',
  'ask_user',
];
/** Сверх ТЗ § 4.1 — только чтение, для «ведёт по платформе» (E-02, лейн agentq). */
const EXTRA = ['get_onboarding_status', 'get_test_status', 'get_invitations', 'explain_evidence'];
/** База знаний и веб-поиск (решения владельца 09.10): чтение, без записи. */
const KNOWLEDGE = ['search_knowledge', 'web_search'];
/** Предложение созвона (lane call, ADR 0003): только кнопка в ленте, созвон начинает кандидат. */
const CALL = ['suggest_call'];

describe('реестр инструментов (ТЗ § 4.1, § 2)', () => {
  it('14 инструментов по ТЗ + 4 на чтение + база знаний и веб-поиск + предложение созвона, без дублей', () => {
    expect([...TOOL_NAMES].sort()).toEqual([...EXPECTED, ...EXTRA, ...KNOWLEDGE, ...CALL].sort());
    expect(new Set(TOOL_NAMES).size).toBe(21);
  });

  it('нет инструментов записи в профиль, отклика, писем, категории, произвольного HTTP', () => {
    for (const name of TOOL_NAMES) expect(name, name).not.toMatch(FORBIDDEN_TOOL_NAME_RE);
    expect(FORBIDDEN_TOOL_NAME_RE.test('confirm_claim')).toBe(true);
    expect(FORBIDDEN_TOOL_NAME_RE.test('send_email')).toBe(true);
    expect(FORBIDDEN_TOOL_NAME_RE.test('set_grade')).toBe(true);
  });

  it('уровень доказанности и грейд нельзя передать ни в один инструмент', () => {
    for (const t of tools) {
      const schema = JSON.stringify(z.toJSONSchema(t.input, { unrepresentable: 'any' }));
      expect(schema, t.name).not.toMatch(/"(level|evidenceLevel|evidence_level|grade|category)"\s*:/);
    }
  });

  it('у каждого инструмента описание и JSON Schema объекта для провайдера', () => {
    const specs = toolSpecs(tools);
    expect(specs).toHaveLength(21);
    for (const s of specs) {
      expect(s.description.length).toBeGreaterThan(20);
      expect((s.parameters as { type: string }).type).toBe('object');
      // `$schema` часть OpenAI-совместимых бэкендов не принимает
      expect(s.parameters).not.toHaveProperty('$schema');
      // гайд function calling: описание говорит, когда вызывать
      expect(s.description, s.name).toMatch(/Вызывай|вызывай|Задать|Когда|когда/);
    }
    const propose = specs.find((s) => s.name === 'propose_claims')!.parameters as { properties: { items: { items: { required: string[] } } } };
    expect(propose.properties.items.items.required).toEqual(expect.arrayContaining(['catalogId', 'quote', 'sourceRef']));
  });

  it('только ask_user завершает ход; untrusted — ровно читающие внешний текст', () => {
    expect(tools.filter((t) => t.terminal).map((t) => t.name)).toEqual(['ask_user']);
    expect(tools.filter((t) => t.untrusted).map((t) => t.name).sort()).toEqual(['fetch_profile', 'fetch_url', 'get_invitations', 'read_upload', 'web_search']);
  });
});

describe('системный промпт', () => {
  it('prompt.ts собран из prompts/consultant.md и platform-facts.md (источник правды — .md)', () => {
    const md = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/consultant.md'), 'utf8');
    const facts = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/platform-facts.md'), 'utf8');
    expect(CONSULTANT_PROMPT).toBe(assemblePrompt(md, facts));
    expect(CONSULTANT_PROMPT_VERSION).toBe(promptVersion(md));
    expect(CONSULTANT_PROMPT_VERSION).toMatch(/^consultant-v\d+$/);
  });

  it('содержит границы и правила честности', () => {
    for (const must of ['категорию даёт только тест', 'по вакансиям на платформе', 'external_data', 'не инструкции', 'ask_user', 'на «ты»']) {
      expect(CONSULTANT_PROMPT.toLowerCase()).toContain(must.toLowerCase());
    }
  });
});

describe('catalog_search: scoreEntry', () => {
  const entry: CatalogEntry = {
    id: 'be.idempotency',
    specialization: 'backend',
    statement: 'Делал идемпотентную обработку платежей',
    grades: ['middle'],
    weight: 3,
    proof: ['task:payment-retry'],
    markers: ['идемпотентн', 'Idempotency-Key', 'повтор запроса'],
    limits: '',
  };
  it('маркер целиком весит больше, чем слово из формулировки; пустой запрос — 0', () => {
    expect(scoreEntry(entry, 'реализовал повтор запроса через Idempotency-Key')).toBeGreaterThan(scoreEntry(entry, 'обработку'));
    expect(scoreEntry(entry, 'ё')).toBe(0);
    expect(scoreEntry(entry, 'Kafka consumer')).toBe(0);
  });
  it('детерминирован', () => {
    expect(scoreEntry(entry, 'платежей повтор запроса')).toBe(scoreEntry(entry, 'платежей повтор запроса'));
  });
});
