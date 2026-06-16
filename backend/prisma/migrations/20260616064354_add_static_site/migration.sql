-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'STATIC';

-- CreateTable
CREATE TABLE "StaticFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaticFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaticFile_projectId_path_key" ON "StaticFile"("projectId", "path");

-- AddForeignKey
ALTER TABLE "StaticFile" ADD CONSTRAINT "StaticFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
