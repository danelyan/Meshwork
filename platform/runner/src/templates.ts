import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { RUNNER_IMAGES } from './contract';

/** Манифест шаблона проекта `project-templates/<id>/template.json` (формат – README шаблонов). */
export const templateManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  specialization: z.string().min(1),
  grade: z.enum(['junior', 'middle', 'senior']),
  title: z.string().min(1),
  stack: z.array(z.string()),
  image: z.enum(RUNNER_IMAGES),
  testEnvironment: z.enum(['node', 'jsdom']).default('node'),
  contractRef: z.string().default('contract.md'),
  starterRef: z.string().optional(),
  visibleTestsRef: z.string(),
  hiddenTestsRef: z.string(),
  timeLimitSec: z.number().int().min(5).max(300),
  /** Пути в репозитории кандидата, которыми владеет платформа: при проверке удаляются из его копии. */
  platformOwned: z.array(z.string()),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

/** Каталог, куда runner кладёт тесты платформы внутри репозитория кандидата. */
export const PLATFORM_TESTS_DIR = '.platform-tests';
/** Маркер в первой строке файлов платформы (идея WorkAI). */
export const PLATFORM_OWNED_MARKER = 'PLATFORM-OWNED';

const SAFE_REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;

const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Каталог шаблона по id: плоско `<id>/` или вложенно `<подкатегория>/<грейд>/<id>/` (раскладка lane project,
 * docs/project-templates.md). id уникален во всём дереве.
 */
export async function resolveTemplateDir(templatesDir: string, id: string): Promise<string | null> {
  if (!SAFE_ID.test(id)) return null;
  const flat = path.join(templatesDir, id);
  if (await isFile(path.join(flat, 'template.json'))) return flat;
  const subs = await readdir(templatesDir, { withFileTypes: true }).catch(() => []);
  for (const sub of subs) {
    if (!sub.isDirectory()) continue;
    const grades = await readdir(path.join(templatesDir, sub.name), { withFileTypes: true }).catch(() => []);
    for (const grade of grades) {
      if (!grade.isDirectory()) continue;
      const dir = path.join(templatesDir, sub.name, grade.name, id);
      if (await isFile(path.join(dir, 'template.json'))) return dir;
    }
  }
  return null;
}

export async function loadTemplate(templatesDir: string, id: string): Promise<TemplateManifest | null> {
  const dir = await resolveTemplateDir(templatesDir, id);
  if (!dir) return null;
  const file = path.join(dir, 'template.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const manifest = templateManifestSchema.parse(JSON.parse(raw));
  if (manifest.id !== id) throw new Error(`template.json: id ${manifest.id} не совпадает с каталогом ${id}`);
  for (const ref of [manifest.visibleTestsRef, manifest.hiddenTestsRef, manifest.contractRef]) {
    if (!SAFE_REL.test(ref)) throw new Error(`template.json: недопустимый путь ${ref}`);
  }
  return manifest;
}

export async function bundleDir(templatesDir: string, manifest: TemplateManifest, suite: 'hidden' | 'visible'): Promise<string | null> {
  const root = await resolveTemplateDir(templatesDir, manifest.id);
  if (!root) return null;
  const dir = path.join(root, suite === 'hidden' ? manifest.hiddenTestsRef : manifest.visibleTestsRef);
  try {
    return (await stat(dir)).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Glob платформенных путей (`tests/visible/**`, `contract.md`) → префикс для удаления.
 * Поддерживается только «точный путь» и «каталог/**» – этого хватает манифестам.
 */
export function ownedPrefix(pattern: string): string | null {
  const p = pattern.replace(/\/\*\*$/, '');
  if (!SAFE_REL.test(p) || p.includes('*')) return null;
  return p.replace(/\/$/, '');
}
