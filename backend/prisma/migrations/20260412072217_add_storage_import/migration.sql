-- CreateEnum
CREATE TYPE "StorageImportSource" AS ENUM ('REMOTE', 'FILE', 'URL');

-- CreateEnum
CREATE TYPE "StorageImportConflict" AS ENUM ('OVERWRITE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "StorageImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StorageImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "StorageImportSource" NOT NULL,
    "targetBucket" TEXT NOT NULL,
    "targetPrefix" TEXT NOT NULL DEFAULT '',
    "conflictStrategy" "StorageImportConflict" NOT NULL,
    "status" "StorageImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "completedFiles" INTEGER NOT NULL DEFAULT 0,
    "skippedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageImport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StorageImport" ADD CONSTRAINT "StorageImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
