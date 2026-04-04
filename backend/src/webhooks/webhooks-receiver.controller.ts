import { Controller, Logger, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksReceiverController {
  private readonly logger = new Logger(WebhooksReceiverController.name);

  constructor(private webhooksService: WebhooksService) {}

  @Post('receive/:projectId')
  @UseGuards(ThrottlerGuard, WebhookSignatureGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async receive(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const deliveryId = req.headers['x-github-delivery'] as string;
    const event = req.headers['x-github-event'] as string;

    if (!deliveryId || !event) {
      return res.status(400).json({ message: 'Missing GitHub headers' });
    }

    res.status(200).json({ received: true });

    this.webhooksService.processWebhookEvent({
      projectId,
      deliveryId,
      event,
      headers: req.headers as Record<string, string>,
      payload: req.body,
    }).catch((err) => this.logger.error(`Failed to process webhook event ${deliveryId}: ${err.message}`, err.stack));
  }
}
