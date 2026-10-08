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

/**
 * no_quote — цитаты нет в источнике; unknown_catalog_id — ID вне каталога; duplicate — второй раз тот же ID;
 * hidden_text — цитата только из строк, помеченных сборщиком скрытыми; quote_too_short — меньше 2 слов.
 */
export type RejectReason = 'no_quote' | 'unknown_catalog_id' | 'duplicate' | 'hidden_text' | 'quote_too_short';

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
  /** Все не отклонённые утверждения: сначала выше уровень, затем новее. */
  claims: ProfileClaim[];
  /** Те же утверждения по уровням доказанности (для экрана профиля). */
  byLevel: Record<EvidenceLevel, ProfileClaim[]>;
}

/** Полная запись каталога из prisma/seed/claims-catalog.json — поля, которых нет в схеме ClaimCatalog. */
export interface CatalogMeta {
  id: string;
  /** Вес по грейдам; у common — отдельно по специализациям. null — в грейде не ожидается. */
  weights:
    | { junior: number | null; middle: number | null }
    | { backend: { junior: number | null; middle: number | null }; frontend: { junior: number | null; middle: number | null } };
  /** Квалификатор stack (каталог § 2.2): кандидат указывает технологию. null — нет. */
  stack: { kind: string | null } | null;
  /** Смежные утверждения (половинный зачёт, каталог § 6), в обе стороны. */
  adjacent: string[];
}
