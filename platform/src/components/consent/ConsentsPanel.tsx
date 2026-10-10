'use client';

import { useCallback, useEffect, useState } from 'react';

import { grantConsentApi, listConsentsApi, revokeConsentApi } from '@/lib/consent-api';
import { formatDate } from '@/lib/labels';
import type { ConsentItemView } from '@/server/consent/service';
import { CONSENT_IS_DRAFT, type ConsentKindName } from '@/server/consent/texts';

import { Button, Notice, Panel, Tag } from '../ui';

const STATE_LABEL: Record<ConsentItemView['state'], string> = {
  active: 'Действует',
  outdated: 'Текст обновился - подтвердите',
  revoked: 'Отозвано',
  none: 'Не давали',
};

/**
 * «Мои согласия» (ADR 0005): вид, версия, дата и состояние каждого согласия; «Отозвать» у отзываемых, «Дать» у
 * недействующих. Г1 отзывается только удалением аккаунта (кнопка «Отозвать согласие и удалить данные» на этой же странице).
 * `onChange` — родитель обновляет связанные переключатели (показ профиля).
 */
export function ConsentsPanel({ onChange, title = 'Мои согласия' }: { onChange?: (kind: ConsentKindName, active: boolean) => void; title?: string }) {
  const [items, setItems] = useState<ConsentItemView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await listConsentsApi(); setItems(Array.isArray(r?.items) ? r.items : []); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить согласия.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const keyOf = (it: ConsentItemView) => `${it.kind}:${it.invitationId ?? ''}`;

  async function act(it: ConsentItemView, action: 'grant' | 'revoke') {
    setBusy(keyOf(it)); setError(null); setNote(null);
    try {
      if (action === 'grant') {
        await grantConsentApi(it.kind, it.currentVersion, it.invitationId ? { invitationId: it.invitationId } : undefined);
      } else {
        const r = await revokeConsentApi(it.kind, it.invitationId);
        if (it.kind === 'call_recording') setNote(`Согласие на запись отозвано. Удалено аудиозаписей: ${r.deletedRecordings ?? 0}. Новые созвоны пройдут текстом.`);
        if (it.kind === 'identity_disclosure') setNote('Раскрытие отозвано: компания снова видит псевдоним. Данные, которые она уже получила, отозвать невозможно.');
      }
      onChange?.(it.kind, action === 'grant');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(null); }
  }

  return (
    <Panel id="consents" aria-labelledby="consents-title" data-testid="consents-panel">
      <h2 id="consents-title">{title}</h2>
      {CONSENT_IS_DRAFT && <p><small>Тексты - черновик, не юридический текст.</small></p>}
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice>{note}</Notice>}
      {!items ? <p>Загружаем согласия…</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {items.map((it) => {
            const active = it.state === 'active';
            return (
              <li key={keyOf(it)} data-kind={it.kind} data-state={it.state}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b>{it.title}{it.company ? `: ${it.company}` : ''}</b>
                  <Tag>{STATE_LABEL[it.state]}</Tag>
                </div>
                <small style={{ display: 'block' }}>
                  {it.version ? `Версия ${it.version}` : `Текущая версия ${it.currentVersion}`}
                  {it.acceptedAt ? ` · дано ${formatDate(it.acceptedAt)}` : ''}
                  {it.revokedAt && !active ? ` · отозвано ${formatDate(it.revokedAt)}` : ''}
                  {it.requiredFor ? ` · нужно для ${it.requiredFor}` : ' · необязательно'}
                </small>
                <details>
                  <summary>Текст согласия</summary>
                  {it.paragraphs.map((p) => <p key={p}>{p}</p>)}
                  {it.docUrl && <p><a href={it.docUrl} target="_blank" rel="noopener">Полный текст</a></p>}
                </details>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {it.revoke === 'erase'
                    ? <small>Отзыв этого согласия - удаление аккаунта: кнопка «Отозвать согласие и удалить данные» ниже.{!active ? ' ' : ''}</small>
                    : active
                      ? <Button size="sm" loading={busy === keyOf(it)} disabled={busy !== null} onClick={() => void act(it, 'revoke')}>Отозвать</Button>
                      : it.revoke === 'button' && <Button size="sm" loading={busy === keyOf(it)} disabled={busy !== null} onClick={() => void act(it, 'grant')}>Дать согласие</Button>}
                  {it.revoke === 'erase' && !active && <Button size="sm" loading={busy === keyOf(it)} disabled={busy !== null} onClick={() => void act(it, 'grant')}>Подтвердить актуальную версию</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
