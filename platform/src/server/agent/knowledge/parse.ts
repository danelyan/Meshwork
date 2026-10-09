// Разбор документов базы знаний (md → секции). Чистые функции: их зовут генератор
// scripts/build-prompts.ts (собирает corpus.ts) и тесты. В рантайме .md не читаются —
// в standalone-сборке Next.js их нет, рантайм берёт сгенерированный corpus.ts.
import { factsBlock, stripComments } from '../prompts/assemble';

export interface KnowledgeSection {
  docId: string;
  sectionId: string;
  /** Заголовок секции; для фактов — раздел списка фактов. */
  title: string;
  text: string;
}

export interface KnowledgeDoc {
  docId: string;
  title: string;
  sections: KnowledgeSection[];
}

const SECTION_RE = /^##\s+(.+?)\s*\{#([a-z0-9-]+)\}\s*$/;

/**
 * Документ: `# Заголовок`, затем секции `## Заголовок {#id}` с текстом до следующей секции.
 * Комментарии `<!-- … -->` (источники в коде) в базу не идут. id секций уникальны в документе.
 */
export function parseDoc(docId: string, md: string): KnowledgeDoc {
  const lines = stripComments(md).split('\n');
  const title = lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, '').trim();
  if (!title) throw new Error(`knowledge: в документе ${docId} нет заголовка «# …»`);
  const sections: KnowledgeSection[] = [];
  let cur: KnowledgeSection | null = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      const m = SECTION_RE.exec(line);
      if (!m) throw new Error(`knowledge: ${docId}: у секции нет id {#…}: ${line}`);
      if (sections.some((s) => s.sectionId === m[2])) throw new Error(`knowledge: ${docId}: повтор id ${m[2]}`);
      cur = { docId, sectionId: m[2]!, title: m[1]!, text: '' };
      sections.push(cur);
    } else if (cur && line.trim()) {
      cur.text = cur.text ? `${cur.text}\n${line.trim()}` : line.trim();
    }
  }
  if (!sections.length) throw new Error(`knowledge: в документе ${docId} нет секций`);
  return { docId, title, sections };
}

/**
 * platform-facts.md как документ базы: каждый пункт F<n> — секция с id F<n>, заголовок —
 * раздел списка («Подбор и приглашения»…). Номер факта в тексте не дублируется.
 */
export function parseFacts(factsMd: string): KnowledgeDoc {
  const lines = factsBlock(factsMd).split('\n');
  const sections: KnowledgeSection[] = [];
  let group = 'Факты о платформе';
  for (const raw of lines.slice(2)) {
    const line = raw.trim();
    if (!line || line.startsWith('<')) continue;
    const m = /^(F\d+)\.\s+(.+)$/.exec(line);
    if (m) sections.push({ docId: 'platform-facts', sectionId: m[1]!, title: group, text: m[2]! });
    else group = line;
  }
  if (!sections.length) throw new Error('knowledge: в platform-facts.md нет пунктов F<n>');
  return { docId: 'platform-facts', title: 'Как устроена платформа: факты', sections };
}
