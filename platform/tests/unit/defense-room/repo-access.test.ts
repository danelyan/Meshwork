import { describe, expect, it } from 'vitest';

import { redactEvent, redactSnapshot, type Viewer } from '@/server/defense-room/access';
import { encodeCallEvent } from '@/server/defense-room/bus';
import { parseGithubRepo, pickFiles, REPO_LIMITS } from '@/server/defense-room/repo';
import type { CallSnapshot, TranscriptEntry } from '@/server/defense-room/types';

describe('чтение репозитория', () => {
  it('принимает только github.com по https', () => {
    expect(parseGithubRepo('https://github.com/octo/hello-world.git')).toEqual({ owner: 'octo', repo: 'hello-world' });
    expect(parseGithubRepo('https://github.com/octo/app/tree/main/src')).toEqual({ owner: 'octo', repo: 'app' });
    expect(() => parseGithubRepo('http://github.com/a/b')).toThrow();
    expect(() => parseGithubRepo('https://gitlab.com/a/b')).toThrow();
    expect(() => parseGithubRepo('https://github.com/a')).toThrow();
  });

  it('файлы: код раньше тестов и конфигов, без node_modules и lock, в пределах лимитов', () => {
    const entries = [
      { path: 'node_modules/x/index.js', size: 1000 },
      { path: 'package-lock.json', size: 1000 },
      { path: 'src/service.ts', size: 3000 },
      { path: 'tests/service.test.ts', size: 3000 },
      { path: 'vite.config.ts', size: 900 },
      { path: 'src/big.ts', size: REPO_LIMITS.fileMaxBytes + 1 },
      { path: 'README.md', size: 2000 },
      ...Array.from({ length: 30 }, (_, i) => ({ path: `src/m${i}.py`, size: 1500 })),
    ];
    const picked = pickFiles(entries).map((e) => e.path);
    expect(picked.length).toBe(REPO_LIMITS.maxFiles);
    expect(picked).toContain('src/service.ts');
    expect(picked).not.toContain('node_modules/x/index.js');
    expect(picked).not.toContain('src/big.ts');
    expect(picked).not.toContain('README.md');
    expect(picked).not.toContain('tests/service.test.ts');
  });
});

describe('приватность между компаниями', () => {
  const employerA: Viewer = { role: 'employer', userId: 'u1', employerProfileId: 'p1', companyId: 'A', companyName: 'A', peer: 'employer:u1' };
  const candidate: Viewer = { role: 'candidate', candidateId: 'c', peer: 'candidate' };
  const other: TranscriptEntry = { index: 2, role: 'employer', text: 'Вопрос компании B про зарплату', userId: 'u9', defense: { speaker: 'B', companyId: 'B' }, at: '', tMs: 0 };

  it('реплики и участники другой компании скрыты от работодателя, кандидат видит всё', () => {
    const turn = redactEvent({ type: 'utterance', entry: other }, employerA);
    expect(turn).toMatchObject({ entry: { text: '[реплика другой компании скрыта]' } });
    expect(JSON.stringify(turn)).not.toMatch(/"B"|u9/);
    expect(redactEvent({ type: 'participant', userId: 'u9', role: 'employer', action: 'joined', companyId: 'B', companyName: 'B' }, employerA)).toBeNull();
    expect(redactEvent({ type: 'utterance', entry: other }, candidate)).toMatchObject({ entry: { text: other.text } });
    const snap: CallSnapshot = {
      sessionId: 's', kind: 'defense', status: 'active', mode: 'project', transcript: [other], aiMuted: false, progress: { asked: 1, total: 3 }, verdict: null,
      participants: [{ userId: 'u9', companyId: 'B', companyName: 'B', aiMuted: false }],
    };
    expect(redactSnapshot(snap, employerA).participants).toEqual([]);
  });

  it('SSE-кадр: event + data одной строкой', () => {
    const frame = encodeCallEvent({ type: 'mute', aiMuted: true, userId: 'u1' });
    expect(frame).toBe('event: mute\ndata: {"type":"mute","aiMuted":true,"userId":"u1"}\n\n');
  });
});
