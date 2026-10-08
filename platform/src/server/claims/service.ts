import type { Claim } from '@prisma/client';

import type { ProfileView, VerifiedClaim } from './types';

/** Черновики карточек (status proposed). Отклонённые раньше catalogId не предлагаются повторно. */
export async function proposeClaims(candidateId: string, verified: VerifiedClaim[]): Promise<Claim[]> {
  void candidateId;
  void verified;
  throw new Error('not implemented: claims');
}

/** confirm / edit / reject — только владелец candidateId; чужое → AppError 404. */
export async function confirmClaim(candidateId: string, claimId: string): Promise<Claim> {
  void candidateId;
  void claimId;
  throw new Error('not implemented: claims');
}

/** Меняется только формулировка, не уровень. */
export async function editClaim(candidateId: string, claimId: string, statement: string): Promise<Claim> {
  void candidateId;
  void claimId;
  void statement;
  throw new Error('not implemented: claims');
}

export async function rejectClaim(candidateId: string, claimId: string): Promise<Claim> {
  void candidateId;
  void claimId;
  throw new Error('not implemented: claims');
}

export async function getProfile(candidateId: string): Promise<ProfileView> {
  void candidateId;
  throw new Error('not implemented: claims');
}
