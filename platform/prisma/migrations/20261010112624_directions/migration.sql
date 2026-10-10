-- CreateEnum
CREATE TYPE "SubcategoryStatus" AS ENUM ('active', 'planned');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CatalogSpecialization" ADD VALUE 'ai';
ALTER TYPE "CatalogSpecialization" ADD VALUE 'engineering';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Specialization" ADD VALUE 'ai';
ALTER TYPE "Specialization" ADD VALUE 'engineering';

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "subcategoryId" TEXT;

-- AlterTable
ALTER TABLE "Vacancy" ADD COLUMN     "subcategoryId" TEXT;

-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "specialization" "Specialization" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SubcategoryStatus" NOT NULL DEFAULT 'planned',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subcategory_specialization_order_idx" ON "Subcategory"("specialization", "order");
