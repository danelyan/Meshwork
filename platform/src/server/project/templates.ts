// Шаблоны проектов на диске (ADR 0003, ступень 2): platform/project-templates/<subcategory>/<grade>/<id>/.
// Манифест — формат лейна runner (runner/src/templates.ts: templateManifestSchema) плюс поля лейна
// project: subcategoryId, timeBudgetMin, summary, catalogIds, referenceRef. Лишние поля runner
// пропускает (z.object не strict), поэтому один template.json читают оба.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/** Маркер файлов платформы в первой строке (идея WorkAI; тот же, что у runner). */
export const PLATFORM_OWNED_MARKER = 'PLATFORM-OWNED';

const SAFE_REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;
const rel = z.string().regex(SAFE_REL, 'путь внутри каталога шаблона');

export const templateManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  subcategoryId: z.string().regex(/^[a-z]+\.[a-z0-9-]+$/),
  specialization: z.string().min(1),
  grade: z.enum(['junior', 'middle']),
  title: z.string().min(1),
  summary: z.string().default(''),
  stack: z.array(z.string()),
  /** ID каталога утверждений, которые шаблон проверяет по построению (подсказка работодателю). */
  catalogIds: z.array(z.string()).default([]),
  image: z.enum(['node20', 'python312']),
  testEnvironment: z.enum(['node', 'jsdom']).default('node'),
  contractRef: rel.default('contract.md'),
  starterRef: rel.default('starter'),
  visibleTestsRef: rel,
  hiddenTestsRef: rel,
  /** Эталонное решение (поверх starter), кандидату не выдаётся. */
  referenceRef: rel.optional(),
  timeLimitSec: z.number().int().min(5).max(300),
  timeBudgetMin: z.number().int().min(30).max(24 * 60),
  platformOwned: z.array(z.string()),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export interface LoadedTemplate {
  manifest: TemplateManifest;
  /** Абсолютный путь каталога шаблона. */
  dir: string;
  /** Путь от корня шаблонов: "backend.web-api/junior/be-webapi-junior-booking". */
  dirRef: string;
}

export interface TemplateFile {
  path: string;
  content: string;
}

/** Корень шаблонов: PROJECT_TEMPLATES_DIR или <cwd>/project-templates (cwd = platform/ локально и /app в образе). */
export function templatesRoot(cwd = process.cwd()): string {
  return path.resolve(process.env.PROJECT_TEMPLATES_DIR ?? path.join(cwd, 'project-templates'));
}

/** Все template.json на глубине <subcategory>/<grade>/<id>/. Каталог не совпал с id или подкатегорией — ошибка. */
export function listTemplateManifests(root = templatesRoot()): LoadedTemplate[] {
  if (!existsSync(root)) return [];
  const out: LoadedTemplate[] = [];
  for (const sub of readdirSync(root).sort()) {
    const subDir = path.join(root, sub);
    if (!statSync(subDir).isDirectory()) continue;
    for (const grade of readdirSync(subDir).sort()) {
      const gradeDir = path.join(subDir, grade);
      if (!statSync(gradeDir).isDirectory()) continue;
      for (const id of readdirSync(gradeDir).sort()) {
        const file = path.join(gradeDir, id, 'template.json');
        if (!existsSync(file)) continue;
        const manifest = templateManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
        if (manifest.id !== id || manifest.subcategoryId !== sub || manifest.grade !== grade) {
          throw new Error(`template.json ${file}: id/subcategoryId/grade не совпадают с путём`);
        }
        out.push({ manifest, dir: path.join(gradeDir, id), dirRef: `${sub}/${grade}/${id}` });
      }
    }
  }
  return out;
}

let cache: { root: string; list: LoadedTemplate[] } | null = null;

/** Список с кэшем на процесс (шаблоны меняются только с деплоем). */
export function getTemplates(): LoadedTemplate[] {
  const root = templatesRoot();
  if (!cache || cache.root !== root) cache = { root, list: listTemplateManifests(root) };
  return cache.list;
}

export function getTemplate(id: string): LoadedTemplate | null {
  return getTemplates().find((t) => t.manifest.id === id) ?? null;
}

export function readContract(t: LoadedTemplate): string {
  return readFileSync(path.join(t.dir, t.manifest.contractRef), 'utf8').replace(/^<!--[^\n]*PLATFORM-OWNED[^\n]*-->\n/, '');
}

/** Файлы каталога рекурсивно (относительные posix-пути, по алфавиту). */
export function readTree(dir: string, prefix = ''): TemplateFile[] {
  if (!existsSync(dir)) return [];
  const out: TemplateFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...readTree(abs, relPath));
    else out.push({ path: relPath, content: readFileSync(abs, 'utf8') });
  }
  return out;
}

/** Видимые тесты — так, как они лежат в репозитории кандидата (tests/visible/...). */
export function readVisibleTests(t: LoadedTemplate): TemplateFile[] {
  return readTree(path.join(t.dir, t.manifest.visibleTestsRef)).map((f) => ({ path: `tests/visible/${f.path}`, content: f.content }));
}

/** Заготовка репозитория кандидата: starter + contract.md. Скрытые тесты и эталон не входят. */
export function readStarter(t: LoadedTemplate): TemplateFile[] {
  const files = readTree(path.join(t.dir, t.manifest.starterRef));
  if (!files.some((f) => f.path === 'contract.md')) {
    files.push({ path: 'contract.md', content: readFileSync(path.join(t.dir, t.manifest.contractRef), 'utf8') });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Файлы платформы в заготовке (маркер в первых двух строках) → sha256 содержимого. */
export function ownedFileHashes(files: TemplateFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    const head = f.content.split('\n', 2).join('\n');
    if (head.includes(PLATFORM_OWNED_MARKER)) out.set(f.path, sha256(normalizeEol(f.content)));
  }
  return out;
}

/** CRLF → LF: правка окончаний строк git-клиентом на Windows — не нарушение. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export interface OwnedViolation {
  path: string;
  reason: 'modified' | 'missing';
}

/**
 * Сверка файлов платформы с репозиторием кандидата: изменён или удалён — нарушение.
 * Это флаг работодателю, не балл: runner всё равно подменяет тесты своими копиями.
 */
export function checkPlatformOwned(expected: Map<string, string>, repoFiles: Map<string, string | Uint8Array>): OwnedViolation[] {
  const out: OwnedViolation[] = [];
  for (const [p, hash] of [...expected].sort((a, b) => a[0].localeCompare(b[0]))) {
    const got = repoFiles.get(p);
    if (got === undefined) out.push({ path: p, reason: 'missing' });
    else if (sha256(normalizeEol(typeof got === 'string' ? got : Buffer.from(got).toString('utf8'))) !== hash) out.push({ path: p, reason: 'modified' });
  }
  return out;
}

/** Число тестов в каталоге (it/test в JS/TS, def test_ в Python) — для stub-runner и подсказок. */
export function countTests(t: LoadedTemplate, which: 'hidden' | 'visible'): number {
  const files = readTree(path.join(t.dir, which === 'hidden' ? t.manifest.hiddenTestsRef : t.manifest.visibleTestsRef));
  let n = 0;
  for (const f of files) {
    if (/\.py$/.test(f.path)) n += (f.content.match(/^\s*def test_/gm) ?? []).length;
    else if (/\.(test|spec)\.[jt]sx?$/.test(f.path)) n += (f.content.match(/^\s*(it|test)(\.each\([^)]*\))?\(/gm) ?? []).length;
  }
  return n;
}

/** Имена видимых тестов (кандидату можно показывать только их). */
export function visibleTestNames(t: LoadedTemplate): string[] {
  const names: string[] = [];
  for (const f of readVisibleTests(t)) {
    const re = /^\s*(?:it|test)\(\s*(['"`])(.+?)\1|^\s*def (test_\w+)/gm;
    for (const m of f.content.matchAll(re)) names.push(m[2] ?? m[3]!);
  }
  return names;
}
