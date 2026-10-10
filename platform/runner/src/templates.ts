import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { RUNNER_IMAGES } from './contract';

/** Манифест шаблона проекта `project-templates/<id>/template.json` (формат — README шаблонов). */
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

export async function loadTemplate(templatesDir: string, id: string): Promise<TemplateManifest | null> {
  const file = path.join(templatesDir, id, 'template.json');
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
  const dir = path.join(templatesDir, manifest.id, suite === 'hidden' ? manifest.hiddenTestsRef : manifest.visibleTestsRef);
  try {
    return (await stat(dir)).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Glob платформенных путей (`tests/visible/**`, `contract.md`) → префикс для удаления.
 * Поддерживается только «точный путь» и «каталог/**» — этого хватает манифестам.
 */
export function ownedPrefix(pattern: string): string | null {
  const p = pattern.replace(/\/\*\*$/, '');
  if (!SAFE_REL.test(p) || p.includes('*')) return null;
  return p.replace(/\/$/, '');
}
