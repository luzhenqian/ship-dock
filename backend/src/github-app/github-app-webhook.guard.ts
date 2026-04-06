import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { GitHubAppService } from './github-app.service';

@Injectable()
export class GitHubAppWebhookGuard implements CanActivate {
  constructor(private githubApp: GitHubAppService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) throw new ForbiddenException('Missing signature header');

    const payload = req.rawBody as Buffer;
    const secret = this.githubApp.getWebhookSecret();
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    try {
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
