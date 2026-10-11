-- CreateEnum
CREATE TYPE "LiveDefenseStatus" AS ENUM ('slots_proposed', 'scheduled', 'done', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "LiveDefenseActor" AS ENUM ('candidate', 'employer');

-- CreateTable
CREATE TABLE "LiveDefense" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "LiveDefenseStatus" NOT NULL DEFAULT 'slots_proposed',
    "durationMin" INTEGER NOT NULL,
    "comment" TEXT,
    "proposedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "noneFitAt" TIMESTAMP(3),
    "noneFitComment" TEXT,
    "chosenSlotId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "callSessionId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "LiveDefenseActor",
    "cancelReason" TEXT,

    CONSTRAINT "LiveDefense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDefenseSlot" (
    "id" TEXT NOT NULL,
    "liveDefenseId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "bookedKey" TEXT,
    "bookedAt" TIMESTAMP(3),

    CONSTRAINT "LiveDefenseSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDefenseEvent" (
    "id" TEXT NOT NULL,
    "liveDefenseId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "audience" "LiveDefenseActor" NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveDefenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveDefense_activeKey_key" ON "LiveDefense"("activeKey");

-- CreateIndex
CREATE INDEX "LiveDefense_invitationId_createdAt_idx" ON "LiveDefense"("invitationId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveDefense_companyId_status_idx" ON "LiveDefense"("companyId", "status");

-- CreateIndex
CREATE INDEX "LiveDefense_candidateId_status_idx" ON "LiveDefense"("candidateId", "status");

-- CreateIndex
CREATE INDEX "LiveDefense_callSessionId_idx" ON "LiveDefense"("callSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveDefenseSlot_bookedKey_key" ON "LiveDefenseSlot"("bookedKey");

-- CreateIndex
CREATE INDEX "LiveDefenseSlot_liveDefenseId_idx" ON "LiveDefenseSlot"("liveDefenseId");

-- CreateIndex
CREATE INDEX "LiveDefenseEvent_candidateId_audience_createdAt_idx" ON "LiveDefenseEvent"("candidateId", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "LiveDefenseEvent_companyId_audience_createdAt_idx" ON "LiveDefenseEvent"("companyId", "audience", "createdAt");

-- AddForeignKey
ALTER TABLE "LiveDefense" ADD CONSTRAINT "LiveDefense_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDefenseSlot" ADD CONSTRAINT "LiveDefenseSlot_liveDefenseId_fkey" FOREIGN KEY ("liveDefenseId") REFERENCES "LiveDefense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDefenseEvent" ADD CONSTRAINT "LiveDefenseEvent_liveDefenseId_fkey" FOREIGN KEY ("liveDefenseId") REFERENCES "LiveDefense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

