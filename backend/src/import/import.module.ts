import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportProcessor } from './import.processor';
import { ImportGateway } from './import.gateway';
import { ManifestParser } from './parsers/manifest-parser';
import { ProjectsModule } from '../projects/projects.module';
import { DeployModule } from '../deploy/deploy.module';
import { DataMigrationModule } from '../data-migration/data-migration.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'import' }),
    JwtModule.register({}),
    ProjectsModule,
    DeployModule,
    DataMigrationModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, ImportProcessor, ImportGateway, ManifestParser],
  exports: [ImportService],
})
export class ImportModule {}
