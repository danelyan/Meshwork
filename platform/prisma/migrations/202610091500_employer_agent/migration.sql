-- lane emp-agent: разговоры помощника работодателя отдельно от кандидатских (Conversation/Message).
-- AlterEnum
ALTER TYPE "LlmPurpose" ADD VALUE 'employer_assistant';

-- CreateTable
CREATE TABLE "EmployerConversation" (
    "id" TEXT NOT NULL,
    "employerProfileId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployerConversation_employerProfileId_updatedAt_idx" ON "EmployerConversation"("employerProfileId", "updatedAt");

-- CreateIndex
CREATE INDEX "EmployerMessage_conversationId_createdAt_idx" ON "EmployerMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployerConversation" ADD CONSTRAINT "EmployerConversation_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "EmployerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerMessage" ADD CONSTRAINT "EmployerMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EmployerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

