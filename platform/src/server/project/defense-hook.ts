// Точка стыка lane project → lane call / defense-room (ADR 0003, «Дополнение 10.10»):
// «Пригласить на защиту» создаёт приглашение (модель Invitation) и CallSession kind=defense в статусе
// «ожидает кандидата». Модели CallSession в ветке lane/project нет (она у лейна call), поэтому здесь
// только интерфейс и заглушка — не дублируем модель.
//
// TODO(интегратор): после слияния lane/call заменить defaultHook реализацией:
//   prisma.callSession.create({ data: { candidateId, kind: 'defense', projectSubmissionId: submissionId,
//     status: <«ожидает кандидата» — по контракту CallStatus лейна call>, policyVersion: <версия call> } })
// и вернуть { callSessionId }. Повторный вызов для того же сабмита должен вернуть существующую сессию.

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
  async requestDefense() {
    return { callSessionId: null };
  },
};

let hook: DefenseHook = defaultHook;

export function setDefenseHook(h: DefenseHook | null): void {
  hook = h ?? defaultHook;
}

export function getDefenseHook(): DefenseHook {
  return hook;
}
