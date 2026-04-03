import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { DeployModule } from '../deploy/deploy.module';

@Module({ imports: [DeployModule], controllers: [UploadController] })
export class UploadModule {}
