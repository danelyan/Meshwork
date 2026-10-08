import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Демо-кандидаты ↔ демо-резюме (eval/demo/demo-N). Имена в сиде совпадают с именами
 * в резюме; PDF сгенерированы `node eval/scripts/make-pdfs.mjs` (шрифт DejaVu Sans) и лежат
 * в src/server/demo/pdf — их подхватывает standalone-сборка (outputFileTracingIncludes).
 */
export interface DemoResume {
  /** Номер eval/demo/demo-N. */
  n: 1 | 2 | 3;
  /** Имя файла для загрузки: eval/pdf/<fileName> при ручной загрузке. */
  fileName: string;
  /** Ссылка на вымышленный профиль GitHub из eval/demo/demo-N/links.json. */
  link: string;
}

export const DEMO_RESUMES: Record<string, DemoResume> = {
  'demo-backend-strong': { n: 1, fileName: 'demo-1.pdf', link: 'https://github.com/demo-ryabinin' },
  'demo-frontend-mid': { n: 2, fileName: 'demo-2.pdf', link: 'https://github.com/demo-vlasova' },
  'demo-injection': { n: 3, fileName: 'demo-3.pdf', link: 'https://github.com/demo-lisitsyn' },
};

export function demoResumeFor(candidateId: string): DemoResume | null {
  return DEMO_RESUMES[candidateId] ?? null;
}

export async function readDemoResumePdf(resume: DemoResume): Promise<Buffer> {
  return readFile(path.join(process.cwd(), 'src/server/demo/pdf', resume.fileName));
}
