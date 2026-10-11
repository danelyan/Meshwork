import { prisma } from '@/server/db';

/**
 * Один ход на разговор одновременно (ТЗ: второй ход → `busy`), устойчиво к
 * нескольким процессам приложения.
 *
 * Выбор: `pg_try_advisory_xact_lock` внутри интерактивной транзакции Prisma,
 * которая держится до конца хода. Почему не session-lock: Prisma берёт
 * соединение из пула на каждый запрос, и session-состояние (в т.ч. advisory
 * lock) не привязано к следующему запросу (docs Prisma: connection pooling,
 * «advisory locks are lost after each transaction boundary»). Почему не
 * строка-флаг с TTL: в схеме нет колонки, а главное – после падения процесса
 * флаг висит до TTL, а транзакционный lock снимается вместе с соединением.
 * Цена: одно соединение пула на активный ход (их не больше, чем параллельных
 * диалогов; семафор LLM – 8).
 */
const LOCK_NAMESPACE = 0x4653_5001; // «FSP» + 1: ключ 1 advisory lock

export interface ConversationLock {
  release(): Promise<void>;
}

export const LOCK_MAX_HOLD_MS = 10 * 60 * 1000;

/** null – разговор уже занят другим ходом. */
export async function acquireConversationLock(
  conversationId: string,
  opts: { maxHoldMs?: number } = {},
): Promise<ConversationLock | null> {
  let resolveAcquired!: (ok: boolean) => void;
  let rejectAcquired!: (err: unknown) => void;
  const acquired = new Promise<boolean>((res, rej) => {
    resolveAcquired = res;
    rejectAcquired = rej;
  });
  let release!: () => void;
  const released = new Promise<void>((res) => {
    release = res;
  });

  const tx = prisma
    .$transaction(
      async (t) => {
        const rows = await t.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${conversationId})) AS locked`;
        const locked = rows[0]?.locked === true;
        resolveAcquired(locked);
        if (!locked) return;
        await released;
      },
      { maxWait: 5_000, timeout: opts.maxHoldMs ?? LOCK_MAX_HOLD_MS },
    )
    .catch((err: unknown) => {
      rejectAcquired(err);
      // После acquire таймаут транзакции лишь снимает lock раньше хода – ход продолжается.
      console.error('[agent] conversation lock transaction ended with error', err);
    });

  const ok = await acquired;
  if (!ok) {
    await tx;
    return null;
  }
  return {
    async release() {
      release();
      await tx;
    },
  };
}
