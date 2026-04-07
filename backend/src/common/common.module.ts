import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';
import { DatabaseProvisionerService } from './database-provisioner.service';
import { RedisProvisionerService } from './redis-provisioner.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService],
  exports: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService],
})
export class CommonModule {}
