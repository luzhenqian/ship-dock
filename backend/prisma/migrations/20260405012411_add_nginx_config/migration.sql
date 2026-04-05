-- CreateEnum
CREATE TYPE "MigrationSource" AS ENUM ('REMOTE', 'FILE');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('PENDING', 'CONNECTING', 'ANALYZING', 'MIGRATING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MigrationConflictStrategy" AS ENUM ('ERROR', 'OVERWRITE', 'SKIP', 'APPEND');

-- CreateEnum
CREATE TYPE "MigrationTableStatus" AS ENUM ('PENDING', 'MIGRATING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "dbName" TEXT,
ADD COLUMN     "useLocalDb" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DataMigration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "MigrationSource" NOT NULL,
    "status" "MigrationStatus" NOT NULL DEFAULT 'PENDING',
    "connectionConfig" TEXT,
    "fileName" TEXT,
    "fileKey" TEXT,
    "fileSize" BIGINT,
    "conflictStrategy" "MigrationConflictStrategy" NOT NULL DEFAULT 'ERROR',
    "totalTables" INTEGER NOT NULL DEFAULT 0,
    "completedTables" INTEGER NOT NULL DEFAULT 0,
    "totalRows" BIGINT NOT NULL DEFAULT 0,
    "completedRows" BIGINT NOT NULL DEFAULT 0,
    "logs" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredById" TEXT NOT NULL,

    CONSTRAINT "DataMigration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataMigrationTable" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL DEFAULT 'public',
    "status" "MigrationTableStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" BIGINT NOT NULL DEFAULT 0,
    "migratedRows" BIGINT NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataMigrationTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NginxConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientMaxBodySize" INTEGER NOT NULL DEFAULT 10,
    "proxyReadTimeout" INTEGER NOT NULL DEFAULT 60,
    "proxySendTimeout" INTEGER NOT NULL DEFAULT 60,
    "proxyConnectTimeout" INTEGER NOT NULL DEFAULT 60,
    "gzipEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gzipMinLength" INTEGER NOT NULL DEFAULT 1024,
    "gzipTypes" TEXT NOT NULL DEFAULT 'text/plain text/css application/json application/javascript text/xml',
    "proxyBuffering" BOOLEAN NOT NULL DEFAULT true,
    "proxyBufferSize" TEXT NOT NULL DEFAULT '4k',
    "proxyBuffers" TEXT NOT NULL DEFAULT '8 4k',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NginxConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataMigration_projectId_idx" ON "DataMigration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "NginxConfig_projectId_key" ON "NginxConfig"("projectId");

-- AddForeignKey
ALTER TABLE "DataMigration" ADD CONSTRAINT "DataMigration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataMigration" ADD CONSTRAINT "DataMigration_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataMigrationTable" ADD CONSTRAINT "DataMigrationTable_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "DataMigration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NginxConfig" ADD CONSTRAINT "NginxConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
