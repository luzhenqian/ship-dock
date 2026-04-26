import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';
import { DatabaseProvisionerService } from './database-provisioner.service';
import { RedisProvisionerService } from './redis-provisioner.service';
import { MinioProvisionerService } from './minio-provisioner.service';
import { ProjectLockService } from './project-lock.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService, MinioProvisionerService, ProjectLockService],
  exports: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService, MinioProvisionerService, ProjectLockService],
})
export class CommonModule {}
