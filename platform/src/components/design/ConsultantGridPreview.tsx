'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, Field, Kicker, Notice } from '@/components/ui';

import styles from './ConsultantGridPreview.module.css';
import { DEFAULT_GRID_SETTINGS, GRID_PREVIEW_SOURCE, gridSettingsSchema } from './grid-preview-settings';

export function ConsultantGridPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [settings, setSettings] = useState(DEFAULT_GRID_SETTINGS);
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!ready) return;
    const parsed = gridSettingsSchema.safeParse(settings);
    if (parsed.success) frame.current?.contentWindow?.postMessage(
      { type: 'fsp-grid-settings', settings: parsed.data }, window.location.origin,
    );
  }, [ready, settings]);

  return (
    <main id="main" className={styles.preview}>
      <iframe ref={frame} src={GRID_PREVIEW_SOURCE} title="Карьерный консультант — тестовый макет" className={styles.frame}
        onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'fsp-grid-connect' }, window.location.origin)} />
      <section className={styles.tools} aria-label="Настройки тестового экрана">
        <div className={styles.toolbar}>
          <span className={styles.demo}>Тестовый экран</span>
          <Button size="sm" aria-expanded={open} aria-controls="grid-settings" onClick={() => setOpen(!open)}>
            {open ? 'Свернуть настройки' : 'Настройки сетки'}
          </Button>
        </div>
        {open && <div id="grid-settings" className={styles.panel}>
          <Kicker>Сетка и рельеф</Kicker>
          <Field label={`Шаг сетки · ${settings.step} px`} hint="Меньше шаг — плотнее сетка.">
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
          <p className={styles.note}>Демо-чат из макета. Данные профиля и ответы вымышлены.</p>
          {!ready && !failed && <p className={styles.note} role="status">Загружается анимация…</p>}
          {failed && <Notice tone="error">Анимация не загрузилась. Обновите страницу.</Notice>}
        </div>}
      </section>
    </main>
  );
}
