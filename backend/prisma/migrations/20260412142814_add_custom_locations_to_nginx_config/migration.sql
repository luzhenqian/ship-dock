-- AlterTable
ALTER TABLE "NginxConfig" ADD COLUMN     "customLocations" JSONB NOT NULL DEFAULT '[]';
