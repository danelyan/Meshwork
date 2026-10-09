import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMPLOYER_PROMPT } from '@/server/agent/employer/prompt';
import { CONSULTANT_PROMPT } from '@/server/agent/prompt';
import { assemblePrompt, factsBlock, FACTS_PLACEHOLDER, promptVersion, stripComments } from '@/server/agent/prompts/assemble';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';
import { ONBOARDING_PROMPT } from '@/server/onboarding/prompt';

const facts = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/platform-facts.md'), 'utf8');
const block = factsBlock(facts);
const PROMPTS = { consultant: CONSULTANT_PROMPT, employer: EMPLOYER_PROMPT, onboarding: ONBOARDING_PROMPT };

describe('общий файл фактов о платформе', () => {
  it('блок фактов целиком попадает во все три промпта', () => {
    expect(block.startsWith('<platform_facts>')).toBe(true);
    expect(block.endsWith('</platform_facts>')).toBe(true);
    for (const [name, p] of Object.entries(PROMPTS)) expect(p, name).toContain(block);
  });

  it('у каждого факта F1…Fn есть ссылка на код (комментарий), в промпт ссылки не идут', () => {
    const ids = [...facts.matchAll(/^F(\d+)\./gm)].map((m) => Number(m[1]));
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    const lines = facts.split('\n');
    for (const [i, line] of lines.entries()) {
      if (/^F\d+\./.test(line)) expect(lines[i + 1], line.slice(0, 4)).toMatch(/^<!-- код: /);
    }
    for (const p of Object.values(PROMPTS)) {
      expect(p).not.toContain('<!--');
      expect(p).not.toContain(FACTS_PLACEHOLDER);
    }
  });

  it('ключевые факты: цель анкеты ни на что не влияет, имя скрыто, нет истории ФСП — без штрафа', () => {
    expect(block).toMatch(/цель[^\n]*не влияют ни на подборку, ни на видимость профиля, ни на приглашения/);
    expect(block).toContain('Имени, почты, цитат и резюме он не видит');
    expect(block).toContain('Нет истории ФСП — без штрафа');
  });

  it('числа, которые возвращают инструменты, в промпты не зашиты', () => {
    expect(block).toContain('get_employer_context');
    for (const p of [CONSULTANT_PROMPT, ONBOARDING_PROMPT]) expect(p).not.toMatch(new RegExp(`\\b${DAILY_INVITATION_LIMIT} приглашений`));
    // У работодателя число встречается только в примере, где оно пришло из get_employer_context.
    const rules = EMPLOYER_PROMPT.slice(0, EMPLOYER_PROMPT.indexOf('<examples>'));
    expect(rules).not.toMatch(new RegExp(`\\b${DAILY_INVITATION_LIMIT}\\b`));
    expect(EMPLOYER_PROMPT).toContain(`(get_employer_context: left = 18, limit = ${DAILY_INVITATION_LIMIT})`);
  });
});

describe('правило «не знаю» и примеры', () => {
  it('консультант и работодатель: источник правды выше фактов, есть пример отказа', () => {
    for (const p of [CONSULTANT_PROMPT, EMPLOYER_PROMPT]) {
      expect(p.indexOf('<source_of_truth>')).toBeGreaterThan(-1);
      expect(p.indexOf('<source_of_truth>')).toBeLessThan(p.indexOf('<platform_facts>'));
      expect(p).toContain('этого в моих данных нет');
      expect(p).toMatch(/<example>\n\S+: [^\n]+\n[^\n]+: Этого в моих данных нет/);
    }
  });

  it('консультант сохранил раздел <onboarding> со свободными вопросами', () => {
    expect(CONSULTANT_PROMPT).toContain('<onboarding>');
    expect(CONSULTANT_PROMPT).toContain('Свободный вопрос посреди шага');
    expect(CONSULTANT_PROMPT).toContain('/onboarding');
  });

  it('онбординг: три примера и запрет выводить последствия ответа', () => {
    expect(ONBOARDING_PROMPT.match(/<example>/g)).toHaveLength(3);
    expect(ONBOARDING_PROMPT).toContain('не объясняй, к чему приведёт выбранный вариант');
  });
});

describe('сборка промпта', () => {
  it('комментарии вырезаются, плейсхолдер подставляется ровно один раз', () => {
    expect(stripComments('<!-- x -->\nа<!-- y -->б\n')).toBe('аб\n');
    expect(assemblePrompt('<!-- version: t-v1 -->\nдо\n{{platform_facts}}\nпосле', '<!-- c -->\n<platform_facts>\nF1. x\n</platform_facts>\n')).toBe(
      'до\n<platform_facts>\nF1. x\n</platform_facts>\nпосле',
    );
    expect(() => assemblePrompt('без плейсхолдера', facts)).toThrow();
    expect(() => assemblePrompt('{{platform_facts}} {{platform_facts}}', facts)).toThrow();
  });

  it('версия берётся из первой строки .md', () => {
    expect(promptVersion('<!-- version: consultant-v4 -->\n…')).toBe('consultant-v4');
    expect(() => promptVersion('без версии')).toThrow();
  });
});
