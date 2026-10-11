// Голос работодателя в живой защите (ADR 0008 п. 3: запись обязательна, пишутся обе стороны).
// Дорожка работодателя пишется в его браузере (MediaRecorder по его же микрофону, который уходит в P2P) сегментами
// WebM/Opus и грузится сюда: <CALL_DATA_DIR>/calls/<sessionId>/employer/NNN-<startMs>.webm. Отдельно от аудио кандидата
// (calls/<id>/NNN.wav): сбой дорожки работодателя не трогает запись кандидата. Не в БД (ADR 0003 п. 4);
// в CallSession.employerAudioPath – только папка, признак «дорожка есть».
// Принимается только от участника комнаты, подтвердившего при входе предупреждение о записи (CallParticipant.recordingConsentAt).
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { callAudioDir } from '../call/audio';
import { callRecordingMode } from '../call/consent';
import { resolveCallAccess } from '../call/access';
import { removeSegment } from '../consent/recordings';
import { prisma } from '../db';
import { AppError, errors } from '../errors';
import type { SessionPrincipal } from '../session';
import { resolveViewer } from './access';

/** Версия текста предупреждения о записи для работодателя (сохраняется в CallParticipant.recordingConsentVersion). */
export const EMPLOYER_RECORDING_NOTICE_VERSION = 'employer-live-recording-2026-10-11';
export const EMPLOYER_RECORDING_NOTICE =
  'Живая защита записывается целиком: голос кандидата и ваш голос, а также транскрипт. Запись хранится вместе с записью защиты и доступна вашей компании и кандидату. Без согласия на запись подключиться к защите нельзя.';

/** Сегмент ~60 с Opus ≈ 0,3–0,5 МБ; потолок с запасом. */
export const EMPLOYER_AUDIO_SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
/** Сегментов на защиту (≈ 90 минут по 60 с; повторные входы начинают новый сегмент). */
export const EMPLOYER_AUDIO_MAX_SEGMENTS = 120;
export const EMPLOYER_AUDIO_CONTENT_TYPE = 'audio/webm';

const SEGMENT_RE = /^(\d{3})-(\d{1,9})\.webm$/;

export function employerAudioDir(sessionId: string): { rel: string; abs: string } {
  const { rel, abs } = callAudioDir(sessionId);
  return { rel: `${rel}/employer`, abs: path.join(abs, 'employer') };
}

export interface EmployerAudioSegment {
  name: string;
  /** Смещение начала сегмента от начала защиты, мс (для сопоставления с транскриптом и аудио кандидата). */
  startMs: number;
}

function parseName(name: string): EmployerAudioSegment | null {
  const m = SEGMENT_RE.exec(name);
  return m ? { name, startMs: Number(m[2]) } : null;
}

export async function listEmployerAudioSegments(sessionId: string): Promise<EmployerAudioSegment[]> {
  try {
    return (await readdir(employerAudioDir(sessionId).abs))
      .map(parseName)
      .filter((s): s is EmployerAudioSegment => s !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveEmployerAudioSegment(sessionId: string, bytes: Uint8Array, startMs: number): Promise<EmployerAudioSegment> {
  if (bytes.byteLength === 0) throw new AppError('bad_request', 'Пустой сегмент аудио', 400);
  if (bytes.byteLength > EMPLOYER_AUDIO_SEGMENT_MAX_BYTES) throw new AppError('payload_too_large', 'Сегмент аудио слишком большой', 413);
  const existing = await listEmployerAudioSegments(sessionId);
  if (existing.length >= EMPLOYER_AUDIO_MAX_SEGMENTS) throw new AppError('call_audio_limit', 'Слишком много записей в одной защите', 409);
  const { abs } = employerAudioDir(sessionId);
  await mkdir(abs, { recursive: true });
  const next = existing.length ? Number(existing[existing.length - 1]!.name.slice(0, 3)) + 1 : 0;
  const start = Math.max(0, Math.floor(startMs));
  const name = `${String(next).padStart(3, '0')}-${start}.webm`;
  try {
    await writeFile(path.join(abs, name), bytes, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('conflict', 'Сегмент уже сохраняется - повтори через секунду', 409);
    throw err;
  }
  return { name, startMs: start };
}

async function readEmployerAudioSegment(sessionId: string, name: string): Promise<Buffer> {
  if (!SEGMENT_RE.test(name)) throw new AppError('bad_request', 'Неверное имя сегмента', 400);
  const file = path.join(employerAudioDir(sessionId).abs, name);
  try {
    await access(file);
    return await readFile(file);
  } catch {
    throw new AppError('not_found', 'Сегмент записи не найден', 404);
  }
}

// ---------------------------------------------------------------------------
// Загрузка: только участник живой защиты своей компании, подтвердивший запись
// ---------------------------------------------------------------------------
const RECORDING_OFF = () => new AppError('call_recording_off', 'Кандидат отозвал согласие на запись - защита идёт без записи голоса', 409);

export async function addEmployerAudio(principal: SessionPrincipal | null, sessionId: string, bytes: Uint8Array, startMs: number): Promise<EmployerAudioSegment> {
  // resolveViewer: чужая компания, живая защита по чужой вакансии, нет accepted – 404 (как вход в комнату).
  const { viewer, session } = await resolveViewer(principal, sessionId);
  if (viewer.role !== 'employer') throw errors.forbidden('Доступно только работодателю');
  if (session.aiDefense) throw errors.conflict('Это ИИ-защита без работодателя');
  if (session.status !== 'active') throw errors.conflict('Защита уже завершена');
  const p = await prisma.callParticipant.findFirst({ where: { callSessionId: sessionId, userId: viewer.userId, leftAt: null }, select: { recordingConsentAt: true } });
  if (!p) throw errors.conflict('Сначала подключись к защите');
  if (!p.recordingConsentAt) throw new AppError('recording_consent_required', 'Подтверди запись разговора при входе в защиту', 409);
  // Кандидат отозвал Г2 (ADR 0005): защита идёт без записи голоса – и его, и работодателя (в дорожку работодателя
  // через динамики попадает и голос кандидата).
  const candidateOn = async () => (await callRecordingMode(session.candidateId)) === 'audio';
  if (!(await candidateOn())) throw RECORDING_OFF();
  const seg = await saveEmployerAudioSegment(sessionId, bytes, startMs);
  await prisma.callSession.updateMany({ where: { id: sessionId, employerAudioPath: null }, data: { employerAudioPath: employerAudioDir(sessionId).rel } });
  // Гонка с отзывом Г2 (отзыв удаляет каталог созвона): перепроверка после записи, как у аудио кандидата.
  if (!(await candidateOn())) {
    await removeSegment(sessionId, `employer/${seg.name}`);
    throw RECORDING_OFF();
  }
  return seg;
}

// ---------------------------------------------------------------------------
// Чтение: те же правила, что у записи защиты
// ---------------------------------------------------------------------------
/**
 * Кандидат – своя защита. Работодатель – только компания-владелец живой защиты (resolveViewer: accepted + vacancy
 * сабмита, ADR 0008) и только при действующем раскрытии (Г5, resolveCallAccess.recording) – как запись кандидата.
 * ИИ-защита дорожки работодателя не имеет – 404.
 */
async function assertMayRead(principal: SessionPrincipal | null, sessionId: string): Promise<void> {
  const { viewer, session } = await resolveViewer(principal, sessionId);
  if (session.aiDefense) throw errors.notFound('Записи работодателя в ИИ-защите нет');
  if (viewer.role === 'candidate') return;
  const acc = await resolveCallAccess({ role: 'employer', userId: viewer.userId, employerProfileId: viewer.employerProfileId }, { id: session.id, candidateId: session.candidateId, status: session.status, kind: 'defense' });
  if (!acc.recording) throw errors.forbidden('Запись защиты откроется после того, как кандидат примет приглашение');
}

export async function listEmployerAudio(principal: SessionPrincipal | null, sessionId: string): Promise<{ segments: EmployerAudioSegment[] }> {
  await assertMayRead(principal, sessionId);
  return { segments: await listEmployerAudioSegments(sessionId) };
}

export async function getEmployerAudio(principal: SessionPrincipal | null, sessionId: string, segment: string): Promise<Buffer> {
  await assertMayRead(principal, sessionId);
  return readEmployerAudioSegment(sessionId, segment);
}
