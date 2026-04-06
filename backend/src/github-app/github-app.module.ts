import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GitHubAppService } from './github-app.service';
import { GitHubAppController } from './github-app.controller';
import { GitHubAppWebhookController } from './github-app-webhook.controller';
import { GitHubAppWebhookGuard } from './github-app-webhook.guard';

@Module({
  imports: [WebhooksModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
  controllers: [GitHubAppController, GitHubAppWebhookController],
  providers: [
    GitHubAppService,
    GitHubAppWebhookGuard,
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get('REDIS_URL', 'redis://localhost:6379');
        return new Redis(url);
      },
    },
  ],
  exports: [GitHubAppService],
})
export class GitHubAppModule {}
