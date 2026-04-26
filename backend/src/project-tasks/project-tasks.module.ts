import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectTasksProcessor } from './project-tasks.processor';
import { ProjectTasksGateway } from './project-tasks.gateway';

@Module({
  imports: [BullModule.registerQueue({ name: 'tasks' }), JwtModule.register({})],
  controllers: [ProjectTasksController],
  providers: [ProjectTasksService, ProjectTasksProcessor, ProjectTasksGateway],
  exports: [ProjectTasksService, ProjectTasksGateway],
})
export class ProjectTasksModule implements OnModuleInit {
  constructor(private service: ProjectTasksService) {}

  async onModuleInit() {
    // Sweep RUNNING runs left over from a crashed worker.
    try { await this.service.recoverStuckRuns(); } catch {}
  }
}
