-- CreateTable
CREATE TABLE "Pm2Config" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "script" TEXT,
    "instances" INTEGER NOT NULL DEFAULT 1,
    "execMode" TEXT NOT NULL DEFAULT 'fork',
    "maxMemoryRestart" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pm2Config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pm2Config_projectId_key" ON "Pm2Config"("projectId");

-- AddForeignKey
ALTER TABLE "Pm2Config" ADD CONSTRAINT "Pm2Config_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
