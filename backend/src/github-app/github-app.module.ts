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
        return new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        });
      },
    },
  ],
  exports: [GitHubAppService],
})
export class GitHubAppModule {}
