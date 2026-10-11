// lane hired: статусы приглашения, при которых кандидат раскрыт компании. hired — продолжение accepted
// (найм отмечается только из принятого), поэтому раскрытие имени и контактов по нему сохраняется.
import type { InvitationStatus } from '@prisma/client';

export const isDisclosableStatus = (s: InvitationStatus | string): boolean => s === 'accepted' || s === 'hired';
