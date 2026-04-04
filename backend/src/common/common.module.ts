import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';
import { DatabaseProvisionerService } from './database-provisioner.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService, DatabaseProvisionerService],
  exports: [EncryptionService, PrismaService, DatabaseProvisionerService],
})
export class CommonModule {}
