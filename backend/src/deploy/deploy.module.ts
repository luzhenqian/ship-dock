import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { DeployService } from './deploy.service';
import { DeployController } from './deploy.controller';
import { DeployProcessor } from './deploy.processor';
import { DeployGateway } from './deploy.gateway';
import { ProjectsModule } from '../projects/projects.module';
import { DomainsModule } from '../domains/domains.module';
import { GitHubAppModule } from '../github-app/github-app.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'deploy' }), JwtModule.register({}), forwardRef(() => ProjectsModule), DomainsModule, GitHubAppModule],
  controllers: [DeployController],
  providers: [DeployService, DeployProcessor, DeployGateway],
  exports: [DeployService, DeployGateway],
})
export class DeployModule {}
