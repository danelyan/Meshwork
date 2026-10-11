import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { detectInjection } from '@/server/collector/injection';

const ATTACKS = path.join(process.cwd(), 'eval/attacks');

describe('collector/injection', () => {
  it.each(['atk-resume-1', 'atk-resume-2', 'atk-readme-1', 'atk-readme-2', 'atk-readme-3'])('%s: подозрение', (id) => {
    const file = readFileSync(path.join(ATTACKS, `${id}.md`), 'utf8');
    expect(detectInjection(file)).toBe(true);
  });

  it.each(['atk-resume-3', 'atk-resume-4'])('%s: скрытый hiddenText из meta', (id) => {
    const meta = JSON.parse(readFileSync(path.join(ATTACKS, `${id}.meta.json`), 'utf8')) as { hiddenText: string };
    expect(detectInjection(meta.hiddenText)).toBe(true);
  });

  it('все обычные резюме eval (30) – без подозрения', () => {
    const dir = path.join(process.cwd(), 'eval/resumes');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(30);
    for (const f of files) expect([f, detectInjection(readFileSync(path.join(dir, f), 'utf8'))]).toEqual([f, false]);
  });
});
