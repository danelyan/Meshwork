import { GITHUB_API, githubHeaders } from '../collector/github';
import { getJson, getText } from '../collector/http-json';
import { AppError } from '../errors';
import { demoRepoSnapshot, isDemoRepo } from './fixtures/demo-repo';
import type { RepoCommit, RepoFile, RepoSnapshot } from './types';

/**
 * Снимок репозитория кандидата для вопросов по коду (QLC): дерево по `commitSha`, несколько
 * файлов кода и последние коммиты. Только GitHub (REST API + raw.githubusercontent.com – хосты
 * заданы кодом, не пользователем, поэтому SSRF-фильтр не нужен; таймауты и лимиты размера – да,
 * через collector/http-json). Код кандидата – данные: в модель он идёт внутри тегов, не как инструкция.
 */

export const REPO_LIMITS = {
  treeEntries: 3000,
  maxFiles: 14,
  fileMaxBytes: 40 * 1024,
  totalMaxBytes: 160 * 1024,
  commits: 15,
  commitDetails: 3,
  patchMaxChars: 2500,
  patchFiles: 4,
} as const;

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|php|cs|rs|swift|vue|svelte|sql|c|cc|cpp|h|hpp|scala)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage|__pycache__|\.venv|venv|target|bin|obj|\.git|generated|migrations|public|static|assets)\//i;
const SKIP_FILE = /(\.min\.js|\.d\.ts|\.lock|lock\.json|\.map|\.snap)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i;
const MAIN_DIR = /(^|\/)(src|app|lib|server|internal|pkg|cmd|api|core|services?|handlers?|domain)\//i;

export interface RepoRef {
  owner: string;
  repo: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** `https://github.com/owner/repo[.git][/tree/...]` → owner/repo. Другие хосты не поддерживаются. */
export function parseGithubRepo(url: string): RepoRef {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError('bad_repo_url', 'Ссылка на репозиторий некорректна', 400);
  }
  if (u.protocol !== 'https:' || (u.hostname !== 'github.com' && u.hostname !== 'www.github.com')) {
    throw new AppError('bad_repo_url', 'Защита проекта читает только публичные репозитории GitHub', 400);
  }
  const [owner, rawRepo] = u.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
    throw new AppError('bad_repo_url', 'В ссылке нет владельца и имени репозитория', 400);
  }
  return { owner, repo };
}

/** Порядок чтения файлов: основной код раньше тестов, средний размер раньше крошечного и огромного. */
export function rankPaths(entries: { path: string; size: number }[]): { path: string; size: number }[] {
  const score = (e: { path: string; size: number }) => {
    let s = 0;
    if (MAIN_DIR.test(e.path)) s += 3;
    if (TEST_FILE.test(e.path)) s -= 4;
    if (e.size >= 800 && e.size <= 15_000) s += 2;
    else if (e.size < 200) s -= 2;
    if (/(^|\/)(index|main|app|server|handler|service|routes?)\.[a-z]+$/i.test(e.path)) s += 1;
    if (/config|setup|\.config\./i.test(e.path)) s -= 2;
    return s;
  };
  return entries
    .filter((e) => CODE_EXT.test(e.path) && !SKIP_DIR.test(e.path) && !SKIP_FILE.test(e.path) && e.size > 0 && e.size <= REPO_LIMITS.fileMaxBytes)
    .sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path));
}

/** Выбрать файлы в пределах лимитов по числу и суммарному объёму. */
export function pickFiles(entries: { path: string; size: number }[]): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  let total = 0;
  for (const e of rankPaths(entries)) {
    if (out.length >= REPO_LIMITS.maxFiles) break;
    if (total + e.size > REPO_LIMITS.totalMaxBytes) continue;
    out.push(e);
    total += e.size;
  }
  return out;
}

interface GhTree {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; size?: number }[];
}
interface GhCommitItem {
  sha: string;
  commit: { message: string; author: { date: string } | null };
  parents: unknown[];
}
interface GhCommitDetail extends GhCommitItem {
  files?: { filename: string; patch?: string }[];
}

const SRC = 'GitHub';
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export async function loadRepoSnapshot(repoUrl: string, commitSha?: string | null): Promise<RepoSnapshot> {
  if (isDemoRepo(repoUrl)) return demoRepoSnapshot(repoUrl);
  const { owner, repo } = parseGithubRepo(repoUrl);
  const base = `${GITHUB_API}/repos/${owner}/${repo}`;
  const ref = commitSha && SHA_RE.test(commitSha) ? commitSha : 'HEAD';

  const { json: head } = await getJson<GhCommitItem>(`${base}/commits/${ref}`, {
    headers: githubHeaders(),
    source: SRC,
    notFound: 'Репозиторий или коммит не найден (защита читает только публичные репозитории)',
    maxBytes: 2 * 1024 * 1024,
  });
  const sha = head.sha;

  const { json: tree } = await getJson<GhTree>(`${base}/git/trees/${sha}?recursive=1`, {
    headers: githubHeaders(),
    source: SRC,
    maxBytes: 4 * 1024 * 1024,
  });
  const blobs = (tree.tree ?? []).filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }));
  const paths = blobs.map((b) => b.path);

  const chosen = pickFiles(blobs);
  const files: RepoFile[] = [];
  for (const f of chosen) {
    try {
      const { text } = await getText(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {
        source: SRC,
        maxBytes: REPO_LIMITS.fileMaxBytes,
      });
      if (text.includes('\u0000')) continue; // бинарный файл
      files.push({ path: f.path, content: text, size: text.length });
    } catch {
      /* файл не прочитался – берём остальные */
    }
  }

  let commits: RepoCommit[] = [];
  try {
    const { json: list } = await getJson<GhCommitItem[]>(`${base}/commits?sha=${sha}&per_page=${REPO_LIMITS.commits}`, {
      headers: githubHeaders(),
      source: SRC,
      maxBytes: 2 * 1024 * 1024,
    });
    commits = (Array.isArray(list) ? list : []).map((c) => ({
      sha: c.sha,
      message: c.commit.message.slice(0, 500),
      date: c.commit.author?.date ?? '',
    }));
    const detailed = (Array.isArray(list) ? list : []).filter((c) => c.parents.length <= 1).slice(0, REPO_LIMITS.commitDetails);
    for (const c of detailed) {
      try {
        const { json: d } = await getJson<GhCommitDetail>(`${base}/commits/${c.sha}`, {
          headers: githubHeaders(),
          source: SRC,
          maxBytes: 2 * 1024 * 1024,
        });
        const target = commits.find((x) => x.sha === c.sha);
        if (target) {
          target.files = (d.files ?? [])
            .filter((f) => f.patch && CODE_EXT.test(f.filename))
            .slice(0, REPO_LIMITS.patchFiles)
            .map((f) => ({ path: f.filename, patch: (f.patch ?? '').slice(0, REPO_LIMITS.patchMaxChars) }));
        }
      } catch {
        /* diff коммита необязателен */
      }
    }
  } catch {
    /* без коммитов вопросы строятся по коду */
  }

  return {
    repoUrl,
    commitSha: sha,
    tree: paths.slice(0, REPO_LIMITS.treeEntries),
    files,
    commits,
    truncated: { treeEntries: Math.max(0, paths.length - REPO_LIMITS.treeEntries) + (tree.truncated ? 1 : 0), files: Math.max(0, rankPaths(blobs).length - files.length) },
  };
}
