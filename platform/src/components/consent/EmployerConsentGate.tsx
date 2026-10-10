'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { grantConsentApi } from '@/lib/consent-api';
import { CONSENT_IS_DRAFT, CONSENT_TEXTS, EMPLOYER_ONBOARDING_KINDS } from '@/server/consent/texts';

import { Button, Notice, Panel } from '../ui';

/**
 * Поиск и приглашения закрыты, пока работодатель не принял оферту и обязательство по данным кандидатов
 * (ADR 0005). Две отдельные неотмеченные галочки; после принятия страница перезагружается с подборкой.
 */
export function EmployerConsentGate() {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = EMPLOYER_ONBOARDING_KINDS.every((k) => checked[k]);
  async function accept() {
    setBusy(true); setError(null);
    try {
      for (const k of EMPLOYER_ONBOARDING_KINDS) await grantConsentApi(k, CONSENT_TEXTS[k].version);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(false); }
  }
  return (
    <Panel aria-labelledby="employer-consent-title" data-testid="employer-consent-gate">
      <h2 id="employer-consent-title">Примите условия, чтобы искать кандидатов</h2>
      <p>Поиск кандидатов и приглашения открываются после принятия условий для работодателей и обязательства по данным кандидатов.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {EMPLOYER_ONBOARDING_KINDS.map((k) => {
        const t = CONSENT_TEXTS[k];
        return (
          <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <input type="checkbox" checked={Boolean(checked[k])} onChange={(e) => setChecked((v) => ({ ...v, [k]: e.target.checked }))} />
            <span>
              {t.label}
              {t.docUrl && <> - <a href={t.docUrl} target="_blank" rel="noopener">текст</a></>}
              <small style={{ display: 'block' }}>{t.paragraphs.join(' ')}</small>
            </span>
          </label>
        );
      })}
      {CONSENT_IS_DRAFT && <p><small>Тексты - черновик, не юридический текст.</small></p>}
      <Button variant="primary" loading={busy} disabled={!all} onClick={() => void accept()}>Принять и продолжить</Button>
    </Panel>
  );
}
