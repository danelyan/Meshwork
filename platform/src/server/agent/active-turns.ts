/**
 * Реестр активных ходов в памяти процесса: conversationId → AbortController хода.
 * Нужен для кнопки «Стоп» (`POST …/messages/stop`): разрыв соединения ход не прерывает
 * (AI SDK «chatbot-resume-streams»: disconnect ≠ stop), а явный стоп — отменяет работу модели.
 *
 * Ограничение: реестр живёт в одном процессе. Стенд — один процесс приложения (docker compose,
 * один контейнер app), поэтому этого достаточно. При нескольких репликах стоп, пришедший в
 * другой процесс, ход не найдёт (204) — нужен общий канал (Redis pub/sub или флаг в БД).
 */
export interface ActiveTurn {
  controller: AbortController;
  /** Резолвится, когда ход закончен (реплика сохранена или ход брошен). */
  finished: Promise<void>;
}

const turns = new Map<string, ActiveTurn>();

/** Зарегистрировать ход; вернуть функцию снятия (вызывать в finally хода). */
export function registerTurn(conversationId: string, controller: AbortController): () => void {
  let done!: () => void;
  const finished = new Promise<void>((res) => {
    done = res;
  });
  const entry: ActiveTurn = { controller, finished };
  turns.set(conversationId, entry);
  return () => {
    if (turns.get(conversationId) === entry) turns.delete(conversationId);
    done();
  };
}

export function activeTurn(conversationId: string): ActiveTurn | undefined {
  return turns.get(conversationId);
}

/**
 * Остановить ход: отменить работу и дождаться, пока он сохранит частичный ответ и отдаст
 * `message` + `done` (не дольше waitMs). false — активного хода нет.
 */
export async function stopTurn(conversationId: string, waitMs = 5_000): Promise<boolean> {
  const entry = turns.get(conversationId);
  if (!entry) return false;
  entry.controller.abort(new Error('stopped'));
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([entry.finished, new Promise<void>((res) => (t = setTimeout(res, waitMs)))]);
  clearTimeout(t);
  return true;
}
