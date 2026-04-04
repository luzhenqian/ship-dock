import { CanActivate, ExecutionContext, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const projectId = req.params.projectId;
    const signature = req.headers['x-hub-signature-256'];

    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');
    if (!config.enabled) throw new ForbiddenException('Webhook is disabled for this project');

    const secret = this.encryption.decrypt(config.secret);
    const payload = req.rawBody as Buffer;
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    try {
      if (!timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected))) {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
