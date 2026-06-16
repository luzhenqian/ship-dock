import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { DeployModule } from '../deploy/deploy.module';
import { StaticFilesModule } from '../static-files/static-files.module';

@Module({
  imports: [DeployModule, StaticFilesModule],
  controllers: [UploadController],
})
export class UploadModule {}
