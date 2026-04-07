-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "minioBucket" TEXT,
ADD COLUMN     "redisDbIndex" INTEGER,
ADD COLUMN     "useLocalMinio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useLocalRedis" BOOLEAN NOT NULL DEFAULT false;
