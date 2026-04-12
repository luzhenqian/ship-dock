import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ServicesModule } from '../services/services.module';
import { StorageImportController } from './storage-import.controller';
import { StorageImportService } from './storage-import.service';
import { StorageImportProcessor } from './storage-import.processor';
import { StorageImportGateway } from './storage-import.gateway';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'storage-import' }),
    JwtModule.register({}),
    ServicesModule,
  ],
  controllers: [StorageImportController],
  providers: [StorageImportService, StorageImportProcessor, StorageImportGateway],
})
export class StorageImportModule {}
