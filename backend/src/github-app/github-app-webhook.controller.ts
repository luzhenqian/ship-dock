import { Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { GitHubAppWebhookGuard } from './github-app-webhook.guard';
import { GitHubAppService } from './github-app.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Controller('webhooks')
export class GitHubAppWebhookController {
  private readonly logger = new Logger(GitHubAppWebhookController.name);

  constructor(
    private githubApp: GitHubAppService,
    private webhooksService: WebhooksService,
  ) {}

  @Post('github')
  @UseGuards(ThrottlerGuard, GitHubAppWebhookGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async receive(@Req() req: Request, @Res() res: Response) {
    const deliveryId = req.headers['x-github-delivery'] as string;
    const event = req.headers['x-github-event'] as string;

    if (!deliveryId || !event) {
      return res.status(400).json({ message: 'Missing GitHub headers' });
    }

    res.status(200).json({ received: true });

    try {
      if (event === 'installation') {
        const action = req.body?.action;
        if (action === 'deleted') {
          await this.githubApp.handleInstallationDeleted(req.body.installation.id);
        }
        return;
      }

      const repoFullName = req.body?.repository?.full_name;
      if (!repoFullName) {
        this.logger.debug(`No repository in ${event} event ${deliveryId}, ignoring`);
        return;
      }

      await this.webhooksService.processAppWebhookEvent({
        repoFullName,
        deliveryId,
        event,
        headers: req.headers as Record<string, string>,
        payload: req.body,
      });
    } catch (err: any) {
      this.logger.error(`Failed to process app webhook ${deliveryId}: ${err.message}`, err.stack);
    }
  }
}
