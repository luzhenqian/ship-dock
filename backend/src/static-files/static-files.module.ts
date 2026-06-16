import { Module } from '@nestjs/common';
import { StaticFilesController } from './static-files.controller';
import { StaticFilesService } from './static-files.service';

@Module({
  controllers: [StaticFilesController],
  providers: [StaticFilesService],
  exports: [StaticFilesService],
})
export class StaticFilesModule {}
