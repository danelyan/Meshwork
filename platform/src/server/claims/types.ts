// Контракт утверждений (лейн claims). E-01-plan.md § «Контракты», ТЗ § 4.2.
import type { SourceKind } from '../collector/types';
import type { FspState, Grade, Specialization } from '../types';

export type EvidenceLevel = 'self_reported' | 'artifact' | 'platform' | 'third_party';
export type ClaimStatus = 'proposed' | 'confirmed' | 'edited' | 'rejected';
export type Confidence = 'low' | 'medium' | 'high';

export interface CatalogEntry {
  id: string;
  specialization: 'backend' | 'frontend' | 'common';
  statement: string;
  grades: Grade[];
  weight: 1 | 2 | 3;
  proof: string[];
  markers: string[];
  limits: string;
}

export interface ProposedClaim {
  catalogId: string;
  statement: string;
  quote: string;
  sourceRef: string;
  confidence: Confidence;
}

export interface VerifiedClaim extends ProposedClaim {
  level: EvidenceLevel;
  limits: string;
  suggestedProof: string[];
  /** Добавлено foundation: тип документа, из которого цитата (нужен Claim.sourceKind). */
  sourceKind: SourceKind;
}

export type RejectReason = 'no_quote' | 'unknown_catalog_id' | 'duplicate';

export interface VerifyResult {
  accepted: VerifiedClaim[];
  rejected: { claim: ProposedClaim; reason: RejectReason }[];
}

/** Утверждение в профиле — то, что отдают api/profile и инструмент get_profile. */
export interface ProfileClaim {
  id: string;
  catalogId: string;
  statement: string;
  level: EvidenceLevel;
  quote: string;
  sourceRef: string;
  sourceKind: SourceKind;
  limits: string;
  suggestedProof: string[];
  status: ClaimStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ProfileView {
  candidate: { id: string; name: string; specialization: Specialization | null; fspState: FspState };
  /** Категория — только из теста (R-M-01); null, пока теста не было. */
  category: { specialization: Specialization; grade: Grade; confirmedAt: string } | null;
  claims: ProfileClaim[];
}
