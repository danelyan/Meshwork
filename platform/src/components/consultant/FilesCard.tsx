'use client';

import { type DragEvent, type FormEvent, type KeyboardEvent, useId, useRef, useState } from 'react';

import { deleteMaterial, MAX_UPLOAD_BYTES, uploadFile, uploadFileHref, validateUploadFile } from '@/lib/api';
import { extractUrls } from '@/lib/links';
import type { AsideDoc } from '@/server/consultant/aside';

import { ATTACH_ACCEPT, MAX_ATTACHMENTS, formatSize } from '../chat/attachments';
import { useAsideRefresh } from './aside-refresh';
import styles from './FilesCard.module.css';
import { type MaterialsOutcome, offerMaterials } from './materials';

/** Файл в работе: грузится, загружен (и передан ли консультанту) или ошибка. */
interface Pending {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  id?: string;
  error?: string;
  outcome?: MaterialsOutcome;
}

const LIMITS = `PDF, DOCX, MD, TXT, CSV · до ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ · до ${MAX_ATTACHMENTS} за раз`;

const OUTCOME_NOTE: Record<MaterialsOutcome, string> = {
  sent: 'сохранён, консультант разбирает',
  busy: 'сохранён; консультант ещё отвечает',
  none: 'сохранён; разберу, когда откроется чат',
};
const LINK_FAIL: Record<Exclude<MaterialsOutcome, 'sent'>, string> = {
  busy: 'Консультант ещё отвечает - добавь ссылку, когда он закончит.',
  none: 'Ссылки разбирает консультант: закончи знакомство или вставь ссылку в чат.',
};

let seq = 0;

/**
 * «Файлы и ссылки» в правой колонке /consultant: дроп-зона (перетащить, клик или Enter/пробел —
 * выбор файлов), поле ссылки и список загруженного со «скачать» и «удалить». Файлы уходят в
 * POST /api/uploads (оригинал хранится), затем вместе со ссылками — в ленту консультанта тем же
 * конвейером, что вложения композера (materials.ts): черновики утверждений появляются в ленте.
 */
export function FilesCard({ docs }: { docs: AsideDoc[] }) {
  const refresh = useAsideRefresh();
  const inputRef = useRef<HTMLInputElement>(null);
  const limitsId = useId();
  const linkId = useId();
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const [link, setLink] = useState('');
  const [linkMsg, setLinkMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState<string | null>(null);

  const patch = (key: string, p: Partial<Pending>) => setPending((all) => all.map((f) => (f.key === key ? { ...f, ...p } : f)));

  function offer(items: { key: string; id: string; name: string }[]) {
    if (!items.length) return;
    const outcome = offerMaterials({ uploadIds: items.map((i) => i.id), urls: [], names: items.map((i) => i.name) });
    const keys = new Set(items.map((i) => i.key));
    setPending((all) => all.map((f) => (keys.has(f.key) ? { ...f, outcome } : f)));
  }

  function addFiles(list: File[]) {
    if (!list.length) return;
    const added: Pending[] = [];
    const jobs: Promise<{ key: string; id: string; name: string } | null>[] = [];
    let room = MAX_ATTACHMENTS;
    for (const file of list) {
      const key = `f${++seq}`;
      const problem = room <= 0 ? `«${file.name}»: за раз - не больше ${MAX_ATTACHMENTS} файлов.` : validateUploadFile(file);
      if (problem) {
        added.push({ key, name: file.name, size: file.size, status: 'error', error: problem });
        continue;
      }
      room--;
      added.push({ key, name: file.name, size: file.size, status: 'uploading' });
      jobs.push(
        uploadFile(file).then(
          (r) => {
            patch(key, { status: 'done', id: r.id, name: r.filename });
            return { key, id: r.id, name: r.filename };
          },
          (e: unknown) => {
            patch(key, { status: 'error', error: e instanceof Error ? e.message : 'Не удалось загрузить.' });
            return null;
          },
        ),
      );
    }
    setPending((all) => [...all.filter((f) => f.status === 'uploading' || (f.status === 'done' && f.outcome !== 'sent')), ...added]);
    if (!jobs.length) return;
    void Promise.all(jobs).then((done) => {
      offer(done.filter((d): d is { key: string; id: string; name: string } => d !== null));
      refresh();
    });
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setOver(true);
  }
  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    // preventDefault: композер (drop на всё окно) видит defaultPrevented и файл к сообщению не цепляет.
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    inputRef.current?.click();
  }

  function submitLink(e: FormEvent) {
    e.preventDefault();
    const urls = extractUrls(link);
    if (!urls.length) {
      setLinkMsg({ error: true, text: 'Не похоже на ссылку. Пример: github.com/имя или ссылка на резюме на hh.ru.' });
      return;
    }
    const outcome = offerMaterials({ uploadIds: [], urls, names: [] });
    if (outcome === 'sent') {
      setLink('');
      setLinkMsg({ error: false, text: 'Отправил консультанту - он прочитает и предложит утверждения в ленте.' });
      refresh();
    } else {
      setLinkMsg({ error: true, text: LINK_FAIL[outcome] });
    }
  }

  async function remove(d: AsideDoc) {
    setConfirming(null);
    setListError(null);
    setRemoving((s) => new Set(s).add(d.id));
    try {
      await deleteMaterial(d.kind, d.id);
      setPending((all) => all.filter((f) => f.id !== d.id));
      refresh();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Не удалось удалить.');
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(d.id);
        return next;
      });
    }
  }

  const known = new Set(docs.map((d) => d.id));
  // Загруженное и переданное консультанту уходит из «в работе», как только появилось в списке.
  const shown = pending.filter((f) => !(f.status === 'done' && f.outcome === 'sent' && f.id && known.has(f.id)));
  const list = docs.filter((d) => !removing.has(d.id));

  return (
    <div className={styles.root} data-testid="files-card">
      <div
        className={styles.drop}
        data-over={over || undefined}
        role="button"
        tabIndex={0}
        aria-describedby={limitsId}
        aria-label="Добавить файлы: перетащи сюда или выбери"
        onClick={() => inputRef.current?.click()}
        onKeyDown={onKey}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="files-drop"
      >
        <span className={styles.dropTitle}>{over ? 'Отпусти - загружу' : 'Перетащи файлы сюда или нажми'}</span>
        <span id={limitsId} className={styles.dropHint}>
          Резюме, диплом, сертификат · {LIMITS}
        </span>
        <input
          ref={inputRef}
          className={styles.hidden}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="files-input"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </div>

      {shown.length > 0 && (
        <ul className={styles.pending} aria-label="Загрузка файлов" aria-live="polite">
          {shown.map((f) => (
            <li key={f.key} className={styles.pendingRow} data-status={f.status}>
              <span className={styles.name} title={f.name}>
                {f.name}
              </span>
              <span className={styles.status} role={f.status === 'error' ? 'alert' : undefined}>
                {f.status === 'uploading' ? `загружаю · ${formatSize(f.size)}` : f.status === 'error' ? f.error : OUTCOME_NOTE[f.outcome ?? 'sent']}
              </span>
              {f.status === 'done' && f.id && f.outcome && f.outcome !== 'sent' && (
                <button type="button" className={styles.link} onClick={() => offer([{ key: f.key, id: f.id!, name: f.name }])}>
                  Разобрать
                </button>
              )}
              {f.status === 'error' && (
                <button type="button" className={styles.link} aria-label={`Скрыть ошибку ${f.name}`} onClick={() => setPending((all) => all.filter((x) => x.key !== f.key))}>
                  Скрыть
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className={styles.linkForm} onSubmit={submitLink} noValidate>
        <label htmlFor={linkId} className={styles.vh}>
          Ссылка
        </label>
        <input
          id={linkId}
          className={styles.linkInput}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="Вставь ссылку: GitHub, резюме на hh…"
          value={link}
          maxLength={2048}
          onChange={(e) => {
            setLink(e.target.value);
            setLinkMsg(null);
          }}
        />
        <button type="submit" className={styles.add} disabled={!link.trim()}>
          Добавить
        </button>
      </form>
      {linkMsg && (
        <p className={linkMsg.error ? styles.error : styles.note} role={linkMsg.error ? 'alert' : 'status'}>
          {linkMsg.text}
        </p>
      )}

      {list.length === 0 && shown.length === 0 ? (
        <p className={styles.muted}>Пока ничего нет. Из резюме, дипломов и ссылок консультант достанет утверждения для профиля - ты подтвердишь их в ленте.</p>
      ) : (
        <ul className={styles.docs} aria-label="Файлы и ссылки">
          {list.map((d) => (
            <li key={d.id} className={styles.doc} data-testid={`files-doc-${d.id}`}>
              <span className={styles.kind} aria-hidden="true">
                {d.kind === 'file' ? 'файл' : 'ссылка'}
              </span>
              <span className={styles.name} title={d.name}>
                {d.name}
              </span>
              <span className={styles.status}>{d.status}</span>
              {confirming === d.id ? (
                <span className={styles.confirm} role="group" aria-label={`Удалить ${d.name}?`}>
                  <span className={styles.confirmText}>Удалить? Неподтверждённые утверждения из {d.kind === 'file' ? 'файла' : 'ссылки'} удалятся, подтверждённые останутся.</span>
                  <button type="button" className={styles.danger} onClick={() => void remove(d)}>
                    Удалить
                  </button>
                  <button type="button" className={styles.link} onClick={() => setConfirming(null)}>
                    Отмена
                  </button>
                </span>
              ) : (
                <span className={styles.actions}>
                  {d.kind === 'file' && d.hasFile && (
                    <a className={styles.link} href={uploadFileHref(d.id)} download aria-label={`Скачать ${d.name}`}>
                      скачать
                    </a>
                  )}
                  <button type="button" className={styles.link} aria-label={`Удалить ${d.name}`} onClick={() => setConfirming(d.id)}>
                    удалить
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {listError && (
        <p className={styles.error} role="alert">
          {listError}
        </p>
      )}
    </div>
  );
}
