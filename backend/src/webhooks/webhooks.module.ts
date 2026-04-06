import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DeployModule } from '../deploy/deploy.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksReceiverController } from './webhooks-receiver.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Module({
  imports: [DeployModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }])],
  controllers: [WebhooksController, WebhooksReceiverController],
  providers: [WebhooksService, WebhooksFilterService, WebhookSignatureGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
