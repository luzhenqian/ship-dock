import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PortAllocationService } from './port-allocation.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [forwardRef(() => WebhooksModule)],
  controllers: [ProjectsController],
  providers: [ProjectsService, PortAllocationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
