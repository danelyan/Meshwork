import { AppError } from '../errors';
import { getEnv } from '../env';
import { buildDoc, type RawLine } from './doc';
import { markdownToRaw } from './html';
import { getJson, getText } from './http-json';
import type { ExtractedDoc } from './types';

/**
 * GitHub REST: профиль, топ-6 своих репозиториев (не форков) по звёздам и свежести,
 * языки, README первых трёх. GITHUB_TOKEN необязателен (60 → 5000 запросов/ч).
 * Это «артефакт», не доказательство авторства (research/10 § 3).
 */
export const GITHUB_API = 'https://api.github.com';
export const GITHUB_TOP_REPOS = 6;
export const GITHUB_READMES = 3;
const README_MAX_LINES = 200;

export const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

interface GhUser {
  login: string;
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
  html_url: string;
}
interface GhRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  topics?: string[];
}

function headers(raw = false): Record<string, string> {
  const h: Record<string, string> = {
    accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  let token: string | undefined;
  try {
    token = getEnv().GITHUB_TOKEN;
  } catch {
    token = process.env.GITHUB_TOKEN;
  }
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export function pickTopRepos(repos: GhRepo[], n = GITHUB_TOP_REPOS): GhRepo[] {
  return repos
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, n);
}

function languagesLine(langs: Record<string, number>): string {
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  if (!total) return '';
  return Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l, v]) => `${l} ${Math.round((v / total) * 100)}%`)
    .join(', ');
}

export async function fetchGithub(handle: string): Promise<ExtractedDoc> {
  if (!GITHUB_HANDLE.test(handle)) throw new AppError('bad_request', 'Некорректный логин GitHub', 400);
  const src = 'GitHub';
  const { json: user } = await getJson<GhUser>(`${GITHUB_API}/users/${handle}`, {
    headers: headers(),
    source: src,
    notFound: 'Пользователь GitHub не найден',
  });
  const { json: repos } = await getJson<GhRepo[]>(`${GITHUB_API}/users/${handle}/repos?per_page=100&sort=pushed&type=owner`, {
    headers: headers(),
    source: src,
    maxBytes: 2 * 1024 * 1024,
  });
  const top = pickTopRepos(Array.isArray(repos) ? repos : []);

  const lines: RawLine[] = [];
  const suspect: string[] = [];
  const hidden: string[] = [];
  const p = `github:${user.login}#profile`;
  lines.push({ ref: `${p}:l1`, text: `GitHub: ${user.login}${user.name ? ` (${user.name})` : ''}` });
  if (user.bio) lines.push({ ref: `${p}:l2`, text: `О себе: ${user.bio}` });
  lines.push({
    ref: `${p}:l3`,
    text: `Публичных репозиториев: ${user.public_repos}; подписчиков: ${user.followers}; на GitHub с ${user.created_at.slice(0, 4)} г.`,
  });

  const forks = (Array.isArray(repos) ? repos : []).filter((r) => r.fork).length;
  if (forks) lines.push({ ref: `${p}:l4`, text: `Форков среди репозиториев: ${forks} (не учитываются как свои)` });

  for (const [i, repo] of top.entries()) {
    const m = `github:${repo.full_name}#meta`;
    let langs: Record<string, number> = {};
    try {
      langs = (await getJson<Record<string, number>>(`${GITHUB_API}/repos/${repo.full_name}/languages`, { headers: headers(), source: src })).json;
    } catch {
      /* языки — необязательная деталь */
    }
    lines.push({
      ref: `${m}:l1`,
      text: `Репозиторий ${repo.full_name}${repo.description ? `: ${repo.description}` : ''}`,
    });
    const facts = [
      repo.language ? `основной язык ${repo.language}` : '',
      `звёзд ${repo.stargazers_count}`,
      `последний push ${repo.pushed_at.slice(0, 10)}`,
      repo.archived ? 'в архиве' : '',
    ].filter(Boolean);
    lines.push({ ref: `${m}:l2`, text: facts.join('; ') });
    const lang = languagesLine(langs);
    if (lang) lines.push({ ref: `${m}:l3`, text: `Языки: ${lang}` });
    if (repo.topics?.length) lines.push({ ref: `${m}:l4`, text: `Темы: ${repo.topics.join(', ')}` });

    if (i < GITHUB_READMES) {
      try {
        const { text } = await getText(`${GITHUB_API}/repos/${repo.full_name}/readme`, {
          headers: headers(true),
          source: src,
          maxBytes: 200 * 1024,
        });
        const raw = markdownToRaw(text, `github:${repo.full_name}#README`);
        lines.push(...raw.lines.slice(0, README_MAX_LINES));
        suspect.push(...raw.suspect);
        hidden.push(...raw.hidden);
      } catch {
        /* README нет — не ошибка */
      }
    }
  }

  return buildDoc({
    sourceKind: 'github',
    title: `GitHub ${user.login}`,
    origin: `github:${user.login}`,
    lines,
    extraSuspectText: suspect,
    extraHidden: hidden.length ? { count: hidden.length, sample: hidden } : undefined,
    meta: {
      url: user.html_url,
      repos: top.map((r) => r.full_name),
      ownershipVerified: false,
    },
  });
}
