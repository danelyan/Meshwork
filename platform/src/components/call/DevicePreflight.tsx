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
  /** Всё в порядке (или человек сам решил продолжить): начинаем созвон голосом. */
  onReady: () => void;
  /** Без микрофона: созвон текстом. */
  onTextOnly: () => void;
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

export function DevicePreflight({ withCamera, onReady, onTextOnly, onCancel, primaryClass, ghostClass }: DevicePreflightProps) {
  const [mic, setMic] = useState<MicCheck>(() => (mediaSupported() ? 'asking' : 'unsupported'));
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [tone, setTone] = useState<'idle' | 'played' | 'failed'>('idle');
  const [cam, setCam] = useState<'off' | 'starting' | 'on' | 'denied'>('off');
  const [wantCam, setWantCam] = useState(false);

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
  }, [wantCam, stopCam]);

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
    if (textOnly) onTextOnly();
    else onReady();
  };

  const granted = mic === 'granted';
  const problem = mic === 'denied' || mic === 'nodevice' || mic === 'busy' || mic === 'unsupported';

  return (
    <div className={styles.box} data-testid="call-devices" data-mic={mic}>
      <b>Проверка устройств</b>

      <div className={cx(styles.state, granted && styles.ok, problem && styles.bad)} role="status" data-testid="call-devices-mic">
        <i className={styles.dot} aria-hidden="true" />
        {mic === 'asking' && 'Микрофон: ждём разрешения - подтверди запрос в окне браузера.'}
        {granted && 'Микрофон: разрешён. Скажи что-нибудь - полоска ниже должна двигаться.'}
        {mic === 'denied' && 'Микрофон: доступ запрещён.'}
        {mic === 'nodevice' && 'Микрофон: устройство не найдено.'}
        {mic === 'busy' && 'Микрофон: занят другим приложением или недоступен.'}
        {mic === 'unsupported' && 'Микрофон: браузер не даёт к нему доступ (нужен https или localhost и современный браузер).'}
      </div>

      {granted && (
        <>
          <div className={styles.meter} role="meter" aria-label="Уровень микрофона" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))} data-testid="call-devices-level">
            <i style={{ '--level': level.toFixed(2) } as React.CSSProperties} />
          </div>
          {devices.length > 1 && (
            <label className={styles.check}>
              Микрофон
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

      {mic === 'denied' && (
        <ol className={styles.help} data-testid="call-devices-help">
          <li>Нажми на значок замка (или настроек) слева в адресной строке.</li>
          <li>Поставь для микрофона «Разрешить» и вернись сюда.</li>
          <li>Нажми «Повторить» (если браузер просит, обнови страницу).</li>
        </ol>
      )}
      {mic === 'nodevice' && <p className={styles.note}>Подключи микрофон или гарнитуру и нажми «Повторить».</p>}
      {mic === 'busy' && <p className={styles.note}>Закрой другие программы, которые используют микрофон (звонки, запись экрана), и нажми «Повторить».</p>}

      <div className={styles.row}>
        <button type="button" className={ghostClass} onClick={() => void playTone()} data-testid="call-devices-tone">
          Проверить звук
        </button>
        <span className={styles.note} role="status">
          {tone === 'played' && 'Короткий сигнал: если слышно - звук Киры тоже будет слышно.'}
          {tone === 'failed' && 'Не получилось воспроизвести звук - проверь громкость и вывод звука в системе.'}
        </span>
      </div>

      {withCamera && (
        <div className={styles.row}>
          <label className={styles.check}>
            <input type="checkbox" checked={wantCam} onChange={(e) => setWantCam(e.target.checked)} data-testid="call-devices-camera" />
            Проверить камеру (по умолчанию выключена, включается в комнате отдельно)
          </label>
          {cam === 'starting' && <span className={styles.note}>Ждём разрешения камеры…</span>}
          {cam === 'denied' && <span className={styles.note}>Камера недоступна или запрещена - можно продолжить без неё.</span>}
          {wantCam && cam === 'on' && <video ref={video} className={styles.preview} autoPlay muted playsInline aria-label="Превью камеры" />}
        </div>
      )}

      <div className={styles.row}>
        {granted ? (
          <button type="button" className={primaryClass} onClick={() => finish(false)} data-testid="call-devices-go">
            Всё работает - начать
          </button>
        ) : (
          mic !== 'unsupported' && (
            <button type="button" className={primaryClass} onClick={() => void request(deviceId || undefined)} disabled={mic === 'asking'} data-testid="call-devices-retry">
              Повторить
            </button>
          )
        )}
        <button type="button" className={ghostClass} onClick={() => finish(true)} data-testid="call-devices-text">
          Продолжить текстом
        </button>
        {onCancel && (
          <button type="button" className={ghostClass} onClick={onCancel}>
            Не сейчас
          </button>
        )}
      </div>
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
