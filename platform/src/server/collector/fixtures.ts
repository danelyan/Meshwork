import demo1 from '../../../eval/demo/demo-1/links.json';
import demo2 from '../../../eval/demo/demo-2/links.json';
import demo3 from '../../../eval/demo/demo-3/links.json';
import { getEnv } from '../env';
import { buildDoc } from './doc';
import type { ExtractedDoc, ProfileKind, SourceKind } from './types';

/**
 * Фикстуры демо-кандидатов (eval/demo/*\/links.json): вымышленные профили отдаются
 * без сети – на стенде не уходим на github.com за чужим реальным аккаунтом с тем же
 * логином. Импорт статический, чтобы файлы попали в сборку Next.
 */
interface FixtureLink {
  kind: string;
  handle: string;
  url?: string;
  fixture: { sourceKind: string; origin: string; text: string };
}

const ALL: FixtureLink[] = [demo1, demo2, demo3].flatMap((d) => (d as { links: FixtureLink[] }).links);

const key = (kind: string, handle: string) => `${kind}:${handle.toLowerCase()}`;
const BY_KEY = new Map(ALL.map((l) => [key(l.kind, l.handle), l]));

export function fixtureDoc(kind: ProfileKind, handle: string): ExtractedDoc | null {
  const link = BY_KEY.get(key(kind, handle));
  if (!link) return null;
  const { origin, text } = link.fixture;
  const sentences = text.split(/(?<=[.!?])\s+/);
  return buildDoc({
    sourceKind: link.fixture.sourceKind as SourceKind,
    title: `${kind} ${link.handle} (демо)`,
    origin,
    lines: sentences.map((t, i) => ({ ref: `${origin}#fixture:l${i + 1}`, text: t })),
    meta: { fixture: true, fictional: true, url: link.url, ownershipVerified: false },
  });
}

/**
 * COLLECTOR_FIXTURES включён – сеть для профилей выключена: только фикстуры. Значение – из проверенного
 * окружения (env.ts, `z.stringbool`): «1», «true», «yes», «on» читаются одинаково здесь и при старте.
 */
export function fixturesOnly(): boolean {
  return getEnv().COLLECTOR_FIXTURES;
}
