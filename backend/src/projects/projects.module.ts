import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PortAllocationService } from './port-allocation.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, PortAllocationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
