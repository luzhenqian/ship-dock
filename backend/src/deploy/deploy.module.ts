import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { DeployService } from './deploy.service';
import { DeployController } from './deploy.controller';
import { DeployProcessor } from './deploy.processor';
import { DeployGateway } from './deploy.gateway';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'deploy' }), JwtModule.register({}), ProjectsModule],
  controllers: [DeployController],
  providers: [DeployService, DeployProcessor, DeployGateway],
  exports: [DeployService, DeployGateway],
})
export class DeployModule {}
