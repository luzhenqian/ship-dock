-- CreateEnum
CREATE TYPE "AnalyticsProvider" AS ENUM ('GOOGLE_GA4', 'MICROSOFT_CLARITY');

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "commitMessage" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubInstallationId" TEXT;

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AnalyticsProvider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsIntegration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "AnalyticsProvider" NOT NULL,
    "ga4PropertyId" TEXT,
    "ga4StreamId" TEXT,
    "measurementId" TEXT,
    "clarityProjectId" TEXT,
    "clarityTrackingCode" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsConnection_userId_provider_accountEmail_key" ON "AnalyticsConnection"("userId", "provider", "accountEmail");

-- CreateIndex
CREATE INDEX "AnalyticsIntegration_connectionId_idx" ON "AnalyticsIntegration"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsIntegration_projectId_provider_key" ON "AnalyticsIntegration"("projectId", "provider");

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_githubInstallationId_fkey" FOREIGN KEY ("githubInstallationId") REFERENCES "GitHubInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsConnection" ADD CONSTRAINT "AnalyticsConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsIntegration" ADD CONSTRAINT "AnalyticsIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsIntegration" ADD CONSTRAINT "AnalyticsIntegration_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AnalyticsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
