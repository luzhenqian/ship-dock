-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('POSTGRESQL', 'REDIS', 'MINIO');

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('GITHUB');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'FILTERED', 'TRIGGERED', 'FAILED', 'REPLAYED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "startCommand" TEXT;

-- CreateTable
CREATE TABLE "ServiceConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "githubToken" TEXT NOT NULL,
    "githubWebhookId" INTEGER,
    "events" JSONB NOT NULL,
    "branchFilters" JSONB NOT NULL DEFAULT '[]',
    "pathFilters" JSONB NOT NULL DEFAULT '[]',
    "provider" "WebhookProvider" NOT NULL DEFAULT 'GITHUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "headers" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "filterReason" TEXT,
    "deploymentId" TEXT,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceConnection_projectId_idx" ON "ServiceConnection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConfig_projectId_key" ON "WebhookConfig"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_deliveryId_key" ON "WebhookEvent"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_deploymentId_key" ON "WebhookEvent"("deploymentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_projectId_createdAt_idx" ON "WebhookEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServiceConnection" ADD CONSTRAINT "ServiceConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookConfig" ADD CONSTRAINT "WebhookConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
