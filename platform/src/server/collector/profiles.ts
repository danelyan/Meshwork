import { prisma } from '../db';
import { AppError } from '../errors';
import { readCache, saveSource, writeMemory } from './cache';
import { fetchCodeforces } from './codeforces';
import { fixtureDoc, fixturesOnly } from './fixtures';
import { FSP_DEMO_HANDLES, fspDemoDoc, type FspState } from './fsp-demo';
import { linkedFspSubject } from '../fsp-id/link';
import { fetchGithub } from './github';
import { fetchStackOverflow } from './stackoverflow';
import type { ExtractedDoc, ProfileKind } from './types';

export interface FetchProfileOptions {
  /** Владелец профиля: снимок сохраняется в его Source, для ФСП берётся его fspState. */
  candidateId?: string;
  /** Игнорировать кэш 24 ч. */
  fresh?: boolean;
}

/** `https://github.com/user`, `github.com/user/`, `@user` → `user`. */
export function normalizeHandle(kind: ProfileKind, raw: string): string {
  let h = raw.trim();
  const patterns: Record<ProfileKind, RegExp | null> = {
    github: /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i,
    codeforces: /^(?:https?:\/\/)?(?:www\.)?codeforces\.(?:com|ru)\/profile\/([^/?#\s]+)/i,
    stackoverflow: /^(?:https?:\/\/)?(?:www\.)?stackoverflow\.com\/users\/(\d+)/i,
    fsp: null,
  };
  const m = patterns[kind]?.exec(h);
  if (m) h = m[1]!;
  return h.replace(/^@/, '');
}

const originOf = (kind: ProfileKind, handle: string) => `${kind}:${handle}`;

async function fspState(handle: string, candidateId?: string): Promise<FspState> {
  if (candidateId) {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { fspState: true } });
    if (!c) throw new AppError('not_found', 'Кандидат не найден', 404);
    return c.fspState;
  }
  return FSP_DEMO_HANDLES[handle.toLowerCase()] ?? 'not_linked';
}

/**
 * github / codeforces / stackoverflow / fsp (демо).
 * Порядок: фикстура демо-кандидата → кэш 24 ч (память + Source) → сеть
 * (при COLLECTOR_FIXTURES=1 сети нет: `fetch_failed`).
 */
export async function fetchProfile(kind: ProfileKind, handle: string, opts: FetchProfileOptions = {}): Promise<ExtractedDoc> {
  const h = normalizeHandle(kind, handle);
  if (!h || h.length > 64) throw new AppError('bad_request', 'Пустой или слишком длинный идентификатор профиля', 400);

  let doc: ExtractedDoc | null = fixtureDoc(kind, h);
  if (!doc && kind === 'fsp') {
    const state = await fspState(h, opts.candidateId);
    // Привязан через ФСП ID (OIDC) – достижения этого участника из демо-реестра, иначе прежний демо-набор.
    const subject = opts.candidateId && state !== 'not_linked' ? await linkedFspSubject(opts.candidateId) : null;
    doc = fspDemoDoc(opts.candidateId ?? h, state, subject ? { sub: subject.sub, name: subject.name ?? undefined, achievements: subject.achievements } : undefined);
  }
  if (!doc && !opts.fresh) doc = await readCache(kind, originOf(kind, h));
  if (!doc) {
    if (fixturesOnly()) throw new AppError('fetch_failed', 'Сеть для профилей выключена (COLLECTOR_FIXTURES=1)', 503);
    switch (kind) {
      case 'github':
        doc = await fetchGithub(h);
        break;
      case 'codeforces':
        doc = await fetchCodeforces(h);
        break;
      case 'stackoverflow':
        doc = await fetchStackOverflow(h);
        break;
      default:
        throw new AppError('bad_request', 'Неизвестный тип профиля', 400);
    }
    // Ключ кэша – по запрошенному хэндлу (origin источника может отличаться регистром)
    writeMemory(kind, originOf(kind, h), doc);
  }
  if (opts.candidateId) await saveSource(opts.candidateId, kind, doc.origin, doc);
  return doc;
}
