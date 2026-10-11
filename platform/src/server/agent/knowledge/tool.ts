import { z } from 'zod';

import type { AgentTool } from '../types';
import { searchKnowledge } from './search';

const Input = z.object({
  query: z.string().trim().min(2).max(300).describe('Вопрос или ключевые слова по-русски: «пересдача теста», «что видит работодатель»'),
});
const Section = z.object({ docId: z.string(), sectionId: z.string(), title: z.string(), text: z.string() });
const Output = z.object({ sections: z.array(Section), note: z.string() });

export type SearchKnowledgeOutput = z.infer<typeof Output>;

/**
 * Поиск по базе знаний платформы (agent/knowledge/docs + platform-facts.md): правила, тест на
 * грейд, уровни доказанности, что видит работодатель, советы по профилю, частые вопросы.
 * Документы наши (в репо), поэтому результат не помечается untrusted. Общий для консультанта
 * и помощника работодателя: контекст роли не нужен.
 */
export const searchKnowledgeTool: AgentTool<z.infer<typeof Input>, SearchKnowledgeOutput, unknown> = {
  name: 'search_knowledge',
  description:
    'Поиск по базе знаний платформы «MESHWORK»: правила платформы, как устроен тест на грейд и пересдача, уровни доказанности и как доказать навык, что видит работодатель и как считается подборка, как оформить профиль, частые вопросы. ' +
    'Вызывай ПЕРВЫМ на любой вопрос о правилах и устройстве платформы, тесте, уровнях, оформлении профиля – до ответа. Возвращает до 3 секций {docId, sectionId, title, text}; отвечай по их смыслу, своими словами. Ничего не нашлось – скажи, что этого в твоих данных нет. Состояние конкретного человека (профиль, тест, приглашения) здесь не хранится – для него свои инструменты.',
  input: Input,
  output: Output,
  async handler(_ctx, { query }) {
    const hits = searchKnowledge(query);
    return {
      sections: hits.map(({ docId, sectionId, title, text }) => ({ docId, sectionId, title, text })),
      note: hits.length
        ? 'Секции базы знаний платформы. Отвечай по их смыслу; чего в них нет – того ты не знаешь.'
        : 'В базе знаний ничего не нашлось. Попробуй другие слова один раз; не нашлось снова – скажи, что этого в твоих данных нет.',
    };
  },
};
