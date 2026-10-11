// Точка стыка lane project → defense-room (ADR 0003, «Дополнение 10.10»): «Пригласить на защиту» создаёт
// приглашение (Invitation) и ожидающую защиту – CallSession kind=defense, status=pending
// (defense-room/pending.ts). Кандидат начинает её сам на /defense-room: согласие на запись и вопросы по коду –
// в момент старта (startDefenseRoom). Интерфейс оставлен, чтобы тесты могли подменить реализацию.
import { requestProjectDefense } from '../defense-room/pending';

export interface DefenseRequest {
  submissionId: string;
  candidateId: string;
  invitationId: string;
  companyId: string;
}

export interface DefenseHook {
  requestDefense(req: DefenseRequest): Promise<{ callSessionId: string | null }>;
}

const defaultHook: DefenseHook = {
  async requestDefense({ submissionId, candidateId }) {
    const { callSessionId } = await requestProjectDefense(candidateId, submissionId);
    return { callSessionId };
  },
};

let hook: DefenseHook = defaultHook;

export function setDefenseHook(h: DefenseHook | null): void {
  hook = h ?? defaultHook;
}

export function getDefenseHook(): DefenseHook {
  return hook;
}
