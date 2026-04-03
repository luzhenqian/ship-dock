import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService],
  exports: [EncryptionService, PrismaService],
})
export class CommonModule {}
