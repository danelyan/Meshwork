'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, Field, Kicker, Notice } from '@/components/ui';

import styles from './ConsultantGridPreview.module.css';
import { DEFAULT_GRID_SETTINGS, GRID_PREVIEW_SOURCE, GRID_V3_STORAGE_KEY, gridSettingsSchema, type GridSettings } from './grid-preview-settings';

export function ConsultantGridPreview({ source = GRID_PREVIEW_SOURCE, initialSettings = DEFAULT_GRID_SETTINGS, version = 'preview', portrait = false }: {
  source?: string; initialSettings?: GridSettings; version?: 'preview' | 'v1' | 'v2' | 'v3'; portrait?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [open, setOpen] = useState(version !== 'v3');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [storageLoaded, setStorageLoaded] = useState(false);

  useEffect(() => {
    if (!portrait) return;
    const move = (event: PointerEvent) => {
      const bounds = frame.current?.getBoundingClientRect();
      if (!bounds) return;
      frame.current?.contentWindow?.postMessage({ type: 'fsp-grid-pointer',
        x: event.clientX - bounds.left, y: event.clientY - bounds.top }, window.location.origin);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [portrait]);

  useEffect(() => {
    if (version !== 'v3') return;
    try {
      const saved = window.localStorage.getItem(GRID_V3_STORAGE_KEY);
      if (saved) {
        const parsed = gridSettingsSchema.safeParse(JSON.parse(saved));
        if (parsed.success) setSettings(parsed.data);
      }
    } catch { /* Browser storage may be disabled; controls still work. */ }
    setStorageLoaded(true);
  }, [version]);

  useEffect(() => {
    if (version !== 'v3' || !storageLoaded) return;
    try {
      window.localStorage.setItem(GRID_V3_STORAGE_KEY, JSON.stringify(settings));
    } catch { /* Keep the selected view usable when storage is unavailable. */ }
  }, [settings, storageLoaded, version]);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    const timeout = window.setTimeout(() => setFailed(true), 20_000);
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== 'fsp-grid-ready') return;
      window.clearTimeout(timeout);
      setFailed(false);
      setReady(true);
    }
    window.addEventListener('message', receive);
    frame.current?.contentWindow?.postMessage({ type: 'fsp-grid-connect' }, window.location.origin);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [source]);

  useEffect(() => {
    if (!ready) return;
    const parsed = gridSettingsSchema.safeParse(settings);
    if (parsed.success) frame.current?.contentWindow?.postMessage(
      { type: 'fsp-grid-settings', settings: parsed.data }, window.location.origin,
    );
  }, [ready, settings]);

  const Container = portrait ? 'div' : 'main';
  return (
    <Container id={portrait ? undefined : 'main'} className={`${styles.preview} ${portrait ? styles.portrait : ''}`}>
      <iframe ref={frame} src={source} title={portrait ? 'Сеточная голова консультанта' : 'Карьерный консультант – тестовый макет'} className={styles.frame}
        onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'fsp-grid-connect' }, window.location.origin)} />
      <section className={`${styles.tools} ${version === 'v3' ? styles.toolsRight : ''}`} aria-label="Настройки тестового экрана">
        <div className={styles.toolbar}>
          <span className={styles.demo}>{portrait ? 'Консультант' : version === 'v3' ? 'Зеркальный v3' : version === 'v2' ? 'Тест v2' : version === 'v1' ? 'Сохранённый v1' : 'Тестовый экран'}</span>
          <Button size="sm" aria-expanded={open} aria-controls="grid-settings" onClick={() => setOpen(!open)}>
            {open ? 'Свернуть настройки' : 'Настройки сетки'}
          </Button>
        </div>
        {open && <div id="grid-settings" className={styles.panel}>
          <Kicker>Сетка и рельеф</Kicker>
          {!portrait && <div className={styles.versions}>
            <Button href="/design/consultant-grid-v1" size="sm" aria-current={version === 'v1' ? 'page' : undefined}>Сохранённый v1</Button>
            <Button href="/design/consultant-grid-v2" size="sm" aria-current={version === 'v2' ? 'page' : undefined}>Тест v2</Button>
            <Button href="/design/consultant-grid-v3" size="sm" aria-current={version === 'v3' ? 'page' : undefined}>Зеркальный v3</Button>
          </div>}
          <Field label={`Шаг сетки · ${settings.step} px`} hint="Меньше шаг – плотнее сетка.">
            <input type="range" min="16" max="80" step="1" value={settings.step}
              onChange={(e) => setSettings({ ...settings, step: Number(e.target.value) })} />
          </Field>
          <Field label={`Выпуклость · ${settings.relief.toFixed(2)}`}>
            <input type="range" min="0.3" max="1.6" step="0.05" value={settings.relief}
              onChange={(e) => setSettings({ ...settings, relief: Number(e.target.value) })} />
          </Field>
          <Field label={`Угол · ${settings.angle.toFixed(2)}`}>
            <input type="range" min="0" max="0.9" step="0.02" value={settings.angle}
              onChange={(e) => setSettings({ ...settings, angle: Number(e.target.value) })} />
          </Field>
          <Button size="sm" onClick={() => setSettings({ ...DEFAULT_GRID_SETTINGS })}>Как в оригинале</Button>
          {version !== 'preview' && <Button size="sm" onClick={() => setSettings({ ...initialSettings })}>Твой сохранённый вид</Button>}
          {version === 'v3' && <p className={styles.note}>Настройки сохраняются в этом браузере.</p>}
          {!portrait && <p className={styles.note}>Демо-чат из макета. Данные профиля и ответы вымышлены.</p>}
          {!ready && !failed && <p className={styles.note} role="status">Загружается анимация…</p>}
          {failed && <Notice tone="error">Анимация не загрузилась. Обновите страницу или откройте сохранённый v1.</Notice>}
        </div>}
      </section>
    </Container>
  );
}
