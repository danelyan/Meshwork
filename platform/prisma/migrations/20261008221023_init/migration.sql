-- CreateEnum
CREATE TYPE "Specialization" AS ENUM ('backend', 'frontend');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('junior', 'middle');

-- CreateEnum
CREATE TYPE "FspState" AS ENUM ('not_linked', 'no_achievements', 'unavailable', 'linked');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('test');

-- CreateEnum
CREATE TYPE "LlmPurpose" AS ENUM ('consultant', 'extractor', 'evaluator', 'smoke');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('resume', 'document', 'url', 'github', 'codeforces', 'stackoverflow', 'fsp', 'chat');

-- CreateEnum
CREATE TYPE "CatalogSpecialization" AS ENUM ('backend', 'frontend', 'common');

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('self_reported', 'artifact', 'platform', 'third_party');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('proposed', 'confirmed', 'edited', 'rejected');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('system', 'user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('test', 'task', 'target');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('sent', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "DefenseStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialization" "Specialization",
    "consentAt" TIMESTAMP(3),
    "fspState" "FspState" NOT NULL DEFAULT 'not_linked',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCategory" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "specialization" "Specialization" NOT NULL,
    "grade" "Grade" NOT NULL,
    "source" "CategorySource" NOT NULL DEFAULT 'test',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "purpose" "LlmPurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "jsonValid" BOOLEAN,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "queueWaitMs" INTEGER NOT NULL DEFAULT 0,
    "candidateId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "extracted" JSONB,
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "origin" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "ownershipVerified" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimCatalog" (
    "id" TEXT NOT NULL,
    "specialization" "CatalogSpecialization" NOT NULL,
    "statement" TEXT NOT NULL,
    "grades" "Grade"[],
    "weight" INTEGER NOT NULL,
    "proof" TEXT[],
    "markers" TEXT[],
    "limits" TEXT NOT NULL,

    CONSTRAINT "ClaimCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "level" "EvidenceLevel" NOT NULL,
    "quote" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceKind" "SourceKind" NOT NULL,
    "sourceId" TEXT,
    "confidence" "Confidence",
    "limits" TEXT NOT NULL,
    "suggestedProof" JSONB NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "accepted" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specialization" "Specialization" NOT NULL,
    "grade" "Grade" NOT NULL,
    "salaryFrom" INTEGER NOT NULL,
    "salaryTo" INTEGER NOT NULL,
    "needs" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "catalogIds" TEXT[],
    "description" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'sent',
    "salaryOffer" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefenseSession" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "DefenseStatus" NOT NULL DEFAULT 'active',
    "verdict" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DefenseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefenseTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefenseTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_email_key" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "CandidateCategory_candidateId_idx" ON "CandidateCategory"("candidateId");

-- CreateIndex
CREATE INDEX "AgentRun_candidateId_createdAt_idx" ON "AgentRun"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_purpose_createdAt_idx" ON "AgentRun"("purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_candidateId_sha256_key" ON "Upload"("candidateId", "sha256");

-- CreateIndex
CREATE INDEX "Source_candidateId_kind_origin_idx" ON "Source"("candidateId", "kind", "origin");

-- CreateIndex
CREATE INDEX "Claim_candidateId_status_idx" ON "Claim"("candidateId", "status");

-- CreateIndex
CREATE INDEX "Claim_candidateId_catalogId_idx" ON "Claim"("candidateId", "catalogId");

-- CreateIndex
CREATE INDEX "Conversation_candidateId_updatedAt_idx" ON "Conversation"("candidateId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_candidateId_kind_idx" ON "Recommendation"("candidateId", "kind");

-- CreateIndex
CREATE INDEX "Vacancy_specialization_grade_idx" ON "Vacancy"("specialization", "grade");

-- CreateIndex
CREATE INDEX "Invitation_candidateId_status_idx" ON "Invitation"("candidateId", "status");

-- CreateIndex
CREATE INDEX "DefenseSession_candidateId_claimId_idx" ON "DefenseSession"("candidateId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "DefenseTurn_sessionId_index_key" ON "DefenseTurn"("sessionId", "index");

-- AddForeignKey
ALTER TABLE "CandidateCategory" ADD CONSTRAINT "CandidateCategory_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "ClaimCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseSession" ADD CONSTRAINT "DefenseSession_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseSession" ADD CONSTRAINT "DefenseSession_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseTurn" ADD CONSTRAINT "DefenseTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DefenseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
