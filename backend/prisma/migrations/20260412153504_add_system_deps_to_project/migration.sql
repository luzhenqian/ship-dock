-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "systemDeps" JSONB NOT NULL DEFAULT '[]';
