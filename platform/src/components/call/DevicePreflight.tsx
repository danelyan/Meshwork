'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cx } from '../ui';

import styles from './DevicePreflight.module.css';
import { setMicDeviceId } from './devicePrefs';

/**
 * Шаг «Проверка устройств» перед стартом созвона (после согласия на запись, до begin()): разрешение на
 * микрофон, живой индикатор уровня, выбор устройства, проверка звука Киры (жест пользователя заодно
 * разблокирует автовоспроизведение), камера - только по желанию. Проверочные потоки закрываются при
 * переходе в созвон и при размонтировании: микрофон в фоне не остаётся.
 */
export type MicCheck = 'unsupported' | 'asking' | 'granted' | 'denied' | 'nodevice' | 'busy';

export interface DevicePreflightProps {
  /** Показывать опциональную проверку камеры (комната с камерой). */
  withCamera?: boolean;
  /**
   * Галочка камеры не только проверяет её, но и включает в созвоне (созвон с Кирой): выбор уходит в onReady.
   * Без флага — как в комнате интервью: только проверка, камера включается в комнате отдельно.
   */
  cameraJoinsCall?: boolean;
  /**
   * Созвон строго с видео (созвон с Кирой, владелец 12.10): тумблера нет, камера запрашивается сразу, без
   * разрешения начать нельзя - инструкция и «Повторить», как у микрофона. Подразумевает withCamera + cameraJoinsCall.
   */
  cameraRequired?: boolean;
  /** Всё в порядке (или человек сам решил продолжить): начинаем созвон голосом. camera — включить камеру в созвоне. */
  onReady: (opts?: { camera: boolean }) => void;
  /** Без микрофона: созвон текстом. Нужен только при textFallback (по умолчанию). */
  onTextOnly?: () => void;
  /**
   * Показывать «Продолжить текстом». Созвон с Кирой строго голосом и с видео (владелец 12.10) - там false:
   * без микрофона остаются «Повторить» и «Не сейчас». Комната интервью оставляет текстовый путь.
   */
  textFallback?: boolean;
  onCancel?: () => void;
  /** Классы кнопок родителя (стиль панели). */
  primaryClass?: string;
  ghostClass?: string;
}

type AudioCtx = typeof AudioContext;
const audioCtor = (): AudioCtx | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtx; webkitAudioContext?: AudioCtx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
};

/** Состояние по имени ошибки getUserMedia (MDN: NotAllowedError / NotFoundError / NotReadableError ...). */
export function micErrorState(e: unknown): MicCheck {
  const name = e instanceof Error || (typeof e === 'object' && e !== null) ? String((e as { name?: string }).name ?? '') : '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'nodevice';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'denied';
}

export function mediaSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof window !== 'undefined' && window.isSecureContext === false) return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function DevicePreflight({ withCamera, cameraJoinsCall, cameraRequired, onReady, onTextOnly, onCancel, primaryClass, ghostClass, textFallback = true }: DevicePreflightProps) {
  const [mic, setMic] = useState<MicCheck>(() => (mediaSupported() ? 'asking' : 'unsupported'));
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [tone, setTone] = useState<'idle' | 'played' | 'failed'>('idle');
  const [cam, setCam] = useState<'off' | 'starting' | 'on' | 'denied'>('off');
  // В созвоне с Кирой камера по умолчанию включена (владелец 11.10: разрешение должно запрашиваться сразу); в комнате — по желанию.
  const [wantCam, setWantCam] = useState(Boolean(withCamera && (cameraJoinsCall || cameraRequired)));
  /** Повтор запроса камеры после отказа (cameraRequired): перезапускает эффект камеры. */
  const [camTry, setCamTry] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const gen = useRef(0);
  const dead = useRef(false);

  const stopMic = useCallback(() => {
    gen.current += 1;
    if (meter.current) {
      cancelAnimationFrame(meter.current.raf);
      void meter.current.ctx.close().catch(() => undefined);
      meter.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const stopCam = useCallback(() => {
    camStream.current?.getTracks().forEach((t) => t.stop());
    camStream.current = null;
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      // До разрешения label пустые (MDN, защита от fingerprinting) - вызываем только после getUserMedia.
      const all = await navigator.mediaDevices.enumerateDevices();
      if (dead.current) return;
      const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId);
      setDevices(inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Микрофон ${i + 1}` })));
    } catch {
      /* список недоступен - работаем с устройством по умолчанию */
    }
  }, []);

  const request = useCallback(
    async (id?: string) => {
      if (!mediaSupported()) return setMic('unsupported');
      stopMic();
      const my = gen.current;
      setMic('asking');
      setLevel(0);
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(id ? { deviceId: { exact: id } } : {}) },
        });
        if (dead.current || my !== gen.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const track = s.getAudioTracks()[0];
        const cur = (track?.getSettings?.().deviceId as string | undefined) ?? id ?? '';
        setDeviceId(cur);
        setMicDeviceId(cur || null);
        setMic('granted');
        const Ctor = audioCtor();
        if (Ctor) {
          const ctx = new Ctor();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const m = { ctx, raf: 0 };
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
            m.raf = requestAnimationFrame(tick);
          };
          m.raf = requestAnimationFrame(tick);
          meter.current = m;
        }
        await loadDevices();
      } catch (e) {
        if (dead.current || my !== gen.current) return;
        setMic(micErrorState(e));
      }
    },
    [stopMic, loadDevices],
  );

  // Открытие: если браузер уже помнит отказ - не дёргаем запрос, сразу показываем инструкцию.
  // permissions.query('microphone') поддерживают не все браузеры (Firefox/Safari могут бросить TypeError) - тогда просто спрашиваем.
  useEffect(() => {
    dead.current = false;
    let alive = true;
    (async () => {
      if (!mediaSupported()) return;
      try {
        const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        if (alive && st?.state === 'denied') return setMic('denied');
      } catch {
        /* не поддерживается */
      }
      if (alive) void request();
    })();
    return () => {
      alive = false;
      dead.current = true;
      stopMic();
      stopCam();
    };
  }, [request, stopMic, stopCam]);

  // Камера - по желанию; поток нужен только для превью и закрывается вместе с шагом.
  useEffect(() => {
    if (!wantCam) {
      stopCam();
      setCam('off');
      return;
    }
    let alive = true;
    setCam('starting');
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (!alive || dead.current) return s.getTracks().forEach((t) => t.stop());
        camStream.current = s;
        if (video.current) video.current.srcObject = s;
        setCam('on');
      })
      .catch(() => alive && setCam('denied'));
    return () => {
      alive = false;
      stopCam();
    };
  }, [wantCam, camTry, stopCam]);

  useEffect(() => {
    if (cam === 'on' && video.current && camStream.current) video.current.srcObject = camStream.current;
  }, [cam]);

  const playTone = async () => {
    const Ctor = audioCtor();
    if (!Ctor) return setTone('failed');
    try {
      const ctx = new Ctor();
      // Автовоспроизведение требует жеста: клик по кнопке создаёт/возобновляет контекст (MDN, Autoplay policy).
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 523;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
      osc.onended = () => void ctx.close().catch(() => undefined);
      setTone('played');
    } catch {
      setTone('failed');
    }
  };

  const finish = (textOnly: boolean) => {
    stopMic();
    stopCam();
    void playSilentUnlock();
    if (textOnly) onTextOnly?.();
    // Камера по умолчанию выключена: включаем, только если галочку поставили и браузер не отказал.
    else onReady({ camera: Boolean(withCamera && (cameraJoinsCall || cameraRequired) && wantCam && cam !== 'denied') });
  };

  const granted = mic === 'granted';
  const problem = mic === 'denied' || mic === 'nodevice' || mic === 'busy' || mic === 'unsupported';
  const micTone = granted ? 'ok' : problem ? 'bad' : 'wait';
  const micChip = { asking: 'Ждём разрешения', granted: 'Разрешён', denied: 'Нет доступа', nodevice: 'Не найден', busy: 'Занят', unsupported: 'Недоступен' }[mic];
  const camChip = !wantCam ? 'Выключена' : cam === 'denied' ? 'Нет доступа' : cam === 'on' ? 'Включена' : 'Ждём разрешения';
  const camTone = !wantCam ? 'off' : cam === 'denied' ? 'bad' : cam === 'on' ? 'ok' : 'wait';
  const camRequired = Boolean(withCamera && cameraRequired);
  /** Можно начинать: микрофон разрешён и, если камера обязательна, она включена. */
  const canStart = granted && (!camRequired || cam === 'on');

  return (
    <div className={styles.box} data-testid="call-devices" data-mic={mic}>
      <header className={styles.head}>
        <b>Проверка устройств</b>
        <p className={styles.sub}>
          {camRequired
            ? 'Созвон идёт голосом и с видео: нужны микрофон и камера. Проверочные потоки закроются, когда начнётся созвон.'
            : withCamera
              ? 'Убедимся, что Кира тебя слышит и видит. Проверочные потоки закроются, когда начнётся созвон.'
              : 'Убедимся, что Кира тебя слышит. Проверочный поток закроется, когда начнётся созвон.'}
        </p>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="devices-mic-title">
          <div className={styles.cardHead}>
            <span className={styles.title} id="devices-mic-title">
              Микрофон
            </span>
            <span className={styles.chip} data-tone={micTone} data-testid="call-devices-mic" role="status">
              <i className={styles.dot} aria-hidden="true" />
              {micChip}
            </span>
          </div>

          {granted && (
            <>
              <p className={styles.note}>Скажи что-нибудь - полоска должна двигаться.</p>
              <div className={styles.meter} role="meter" aria-label="Уровень микрофона" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))} data-testid="call-devices-level">
                <i style={{ '--level': level.toFixed(2) } as React.CSSProperties} />
              </div>
              {devices.length > 1 && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Устройство</span>
                  <select
                    className={styles.select}
                    value={deviceId}
                    onChange={(e) => {
                      setDeviceId(e.target.value);
                      void request(e.target.value);
                    }}
                    data-testid="call-devices-select"
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {mic === 'asking' && <p className={styles.note}>Подтверди запрос в окне браузера.</p>}
          {mic === 'denied' && (
            <ol className={styles.help} data-testid="call-devices-help">
              <li>Нажми на значок замка (или настроек) слева в адресной строке.</li>
              <li>Поставь для микрофона «Разрешить» и вернись сюда.</li>
              <li>Нажми «Повторить» (если браузер просит, обнови страницу).</li>
            </ol>
          )}
          {mic === 'nodevice' && <p className={styles.note}>Подключи микрофон или гарнитуру и нажми «Повторить».</p>}
          {mic === 'busy' && <p className={styles.note}>Закрой другие программы, которые используют микрофон (звонки, запись экрана), и нажми «Повторить».</p>}
          {mic === 'unsupported' && <p className={styles.note}>Браузер не даёт доступ к микрофону: нужен https (или localhost) и современный браузер.{!textFallback && ' Созвон идёт только голосом.'}</p>}

          <div className={styles.toneRow}>
            <button type="button" className={cx(styles.linkBtn, ghostClass)} onClick={() => void playTone()} data-testid="call-devices-tone">
              Проверить звук
            </button>
            <span className={cx(styles.note, tone === 'failed' && styles.noteBad)} role="status">
              {tone === 'played' && 'Короткий сигнал: если слышно - звук Киры тоже будет слышно.'}
              {tone === 'failed' && 'Звук не воспроизвёлся - проверь громкость и вывод звука в системе.'}
            </span>
          </div>
        </section>

        {withCamera && (
          <section className={styles.card} aria-labelledby="devices-cam-title">
            <div className={styles.cardHead}>
              <span className={styles.title} id="devices-cam-title">
                Камера
              </span>
              <span className={styles.chip} data-tone={camTone}>
                <i className={styles.dot} aria-hidden="true" />
                {camChip}
              </span>
            </div>
            <div className={styles.previewBox} data-state={wantCam && cam === 'on' ? 'on' : 'off'}>
              {wantCam && cam === 'on' ? (
                <video ref={video} className={styles.preview} autoPlay muted playsInline aria-label="Превью камеры" />
              ) : (
                <span className={styles.previewEmpty}>{wantCam && cam === 'starting' ? 'Ждём разрешения камеры…' : 'Без видео'}</span>
              )}
            </div>
            {camRequired ? (
              <p className={styles.note}>Видео записывается вместе с аудио; никакая модель его не анализирует.</p>
            ) : (
              <label className={styles.switch}>
                <input type="checkbox" className={styles.switchInput} checked={wantCam} onChange={(e) => setWantCam(e.target.checked)} data-testid="call-devices-camera" />
                <span className={styles.switchText}>
                  {cameraJoinsCall ? 'Камера в созвоне' : 'Проверить камеру'}
                  <small>{cameraJoinsCall ? 'Видео записывается вместе с аудио. Сними, чтобы говорить без видео.' : 'По умолчанию выключена, в комнате включается отдельно.'}</small>
                </span>
              </label>
            )}
            {cam === 'denied' && camRequired && (
              <>
                <ol className={styles.help} data-testid="call-devices-camera-denied">
                  <li>Без камеры созвон не начать: нажми на значок замка (или настроек) слева в адресной строке.</li>
                  <li>Поставь для камеры «Разрешить» и вернись сюда.</li>
                  <li>Нажми «Повторить камеру» (если браузер просит, обнови страницу).</li>
                </ol>
                <div className={styles.toneRow}>
                  <button type="button" className={cx(styles.linkBtn, ghostClass)} onClick={() => setCamTry((n) => n + 1)} data-testid="call-devices-camera-retry">
                    Повторить камеру
                  </button>
                </div>
              </>
            )}
            {cam === 'denied' && !camRequired && (
              <p className={cx(styles.note, styles.noteBad)} data-testid="call-devices-camera-denied">
                {cameraJoinsCall ? 'Камера недоступна или запрещена - созвон пойдёт без видео.' : 'Камера недоступна или запрещена - можно продолжить без неё.'}
              </p>
            )}
          </section>
        )}
      </div>

      <footer className={styles.actions}>
        {canStart ? (
          <button type="button" className={cx(styles.go, primaryClass)} onClick={() => finish(false)} data-testid="call-devices-go">
            Всё работает - начать
          </button>
        ) : granted ? (
          <span className={styles.note} role="status" data-testid="call-devices-wait-camera">
            {cam === 'denied' ? 'Разреши камеру, чтобы начать.' : 'Ждём камеру…'}
          </span>
        ) : (
          mic !== 'unsupported' && (
            <button type="button" className={cx(styles.go, primaryClass)} onClick={() => void request(deviceId || undefined)} disabled={mic === 'asking'} data-testid="call-devices-retry">
              Повторить
            </button>
          )
        )}
        <span className={styles.secondary}>
          {textFallback && (
            <button type="button" className={ghostClass} onClick={() => finish(true)} data-testid="call-devices-text">
              Продолжить текстом
            </button>
          )}
          {onCancel && (
            <button type="button" className={ghostClass} onClick={onCancel}>
              Не сейчас
            </button>
          )}
        </span>
      </footer>
    </div>
  );
}

/** Клик «начать» - жест пользователя: короткий беззвучный контекст снимает блокировку автовоспроизведения на странице. */
async function playSilentUnlock() {
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.close();
  } catch {
    /* не критично */
  }
}
