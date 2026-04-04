import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { DataMigrationController } from './data-migration.controller';
import { DataMigrationService } from './data-migration.service';
import { DataMigrationProcessor } from './data-migration.processor';
import { DataMigrationGateway } from './data-migration.gateway';

@Module({
  imports: [BullModule.registerQueue({ name: 'data-migration' }), JwtModule.register({})],
  controllers: [DataMigrationController],
  providers: [DataMigrationService, DataMigrationProcessor, DataMigrationGateway],
  exports: [DataMigrationService],
})
export class DataMigrationModule {}
