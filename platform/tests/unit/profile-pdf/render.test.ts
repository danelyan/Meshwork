import { existsSync } from 'node:fs';

import { buildProfileDocument } from '@/server/profile-pdf/model';
import { FONT_BOLD, FONT_REGULAR, renderProfilePdf } from '@/server/profile-pdf/render';

const doc = buildProfileDocument({
  profile: {
    candidate: { id: 'c-1', name: 'Анна Петрова', specialization: 'backend', fspState: 'not_linked' },
    category: { specialization: 'backend', grade: 'middle', confirmedAt: '2026-10-05T10:00:00.000Z' },
    claims: Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, catalogId: `be.${i}`, statement: `Утверждение номер ${i} с достаточно длинной формулировкой, чтобы строки переносились`, level: 'self_reported' as const,
      quote: '', sourceRef: 'cv.pdf', sourceKind: 'resume' as const, limits: '', suggestedProof: [], status: 'confirmed' as const, createdAt: '2026-10-01T00:00:00.000Z', confirmedAt: null,
    })),
    byLevel: { self_reported: [], artifact: [], third_party: [], platform: [] },
  },
  contact: '@anna',
  basics: { city: 'Казань', claimedGrade: null, stack: ['Go'], workFormats: ['remote'], salaryMin: null, salaryExpected: null, experienceYears: 1, roles: [], softSkills: [] },
  subcategoryId: null,
  policyVersion: 'adr-0002-v7',
  stages: { call: null, projects: { submitted: 0, checked: 0 }, defenses: { completed: 0, passed: 0 } },
  generatedAt: new Date('2026-10-11T15:00:00.000Z'),
});

describe('renderProfilePdf (pdfkit, DejaVu Sans)', () => {
  it('шрифты лежат в public/assets/fonts и резолвятся от cwd', () => {
    expect(existsSync(FONT_REGULAR)).toBe(true);
    expect(existsSync(FONT_BOLD)).toBe(true);
  });

  it('отдаёт валидный PDF со встроенным TrueType-шрифтом; длинный список переносится на вторую страницу', async () => {
    const data = await renderProfilePdf(doc);
    expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(data.subarray(-6).toString('latin1').trim()).toBe('%%EOF');
    expect(data.length).toBeGreaterThan(1024);
    const text = data.toString('latin1');
    expect(text).toContain('/FontFile2');
    expect(text).toContain('/Type /Page');
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
