import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { DeployService } from '../deploy/deploy.service';
import { GitHubProvider } from './providers/github.provider';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Injectable()
export class WebhooksService {
  private githubProvider = new GitHubProvider();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private filter: WebhooksFilterService,
    private deployService: DeployService,
    private config: ConfigService,
  ) {}

  async createConfig(projectId: string, dto: CreateWebhookDto) {
    const existing = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (existing) throw new BadRequestException('Webhook already configured for this project');

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.repoUrl) throw new BadRequestException('Project has no GitHub repo URL');

    const secret = dto.secret || randomBytes(32).toString('hex');
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const callbackUrl = `${baseUrl}/api/webhooks/receive/${projectId}`;

    const { webhookId } = await this.githubProvider.registerWebhook(
      project.repoUrl, callbackUrl, secret, dto.events, dto.githubToken,
    );

    const config = await this.prisma.webhookConfig.create({
      data: {
        projectId,
        secret: this.encryption.encrypt(secret),
        githubToken: this.encryption.encrypt(dto.githubToken),
        githubWebhookId: webhookId,
        events: dto.events,
        branchFilters: dto.branchFilters || [],
        pathFilters: dto.pathFilters || [],
      },
    });

    return { ...config, secret, githubToken: undefined };
  }

  async getConfig(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    return {
      id: config.id,
      projectId: config.projectId,
      enabled: config.enabled,
      events: config.events,
      branchFilters: config.branchFilters,
      pathFilters: config.pathFilters,
      provider: config.provider,
      webhookUrl: `${baseUrl}/api/webhooks/receive/${projectId}`,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  async updateConfig(projectId: string, dto: UpdateWebhookDto) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    const data: any = {};
    if (dto.events) data.events = dto.events;
    if (dto.branchFilters) data.branchFilters = dto.branchFilters;
    if (dto.pathFilters) data.pathFilters = dto.pathFilters;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.githubToken) data.githubToken = this.encryption.encrypt(dto.githubToken);

    if (dto.events && config.githubWebhookId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      const token = dto.githubToken || this.encryption.decrypt(config.githubToken);
      await this.githubProvider.updateWebhook(project!.repoUrl!, config.githubWebhookId, dto.events, token);
    }

    return this.prisma.webhookConfig.update({ where: { projectId }, data });
  }

  async deleteConfig(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    if (config.githubWebhookId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      const token = this.encryption.decrypt(config.githubToken);
      await this.githubProvider.deleteWebhook(project!.repoUrl!, config.githubWebhookId, token).catch(() => {});
    }

    return this.prisma.webhookConfig.delete({ where: { projectId } });
  }

  async regenerateSecret(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    const newSecret = randomBytes(32).toString('hex');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    const token = this.encryption.decrypt(config.githubToken);
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const callbackUrl = `${baseUrl}/api/webhooks/receive/${projectId}`;

    if (config.githubWebhookId) {
      await this.githubProvider.deleteWebhook(project!.repoUrl!, config.githubWebhookId, token).catch(() => {});
    }
    const { webhookId } = await this.githubProvider.registerWebhook(
      project!.repoUrl!, callbackUrl, newSecret, config.events as string[], token,
    );

    await this.prisma.webhookConfig.update({
      where: { projectId },
      data: { secret: this.encryption.encrypt(newSecret), githubWebhookId: webhookId },
    });

    return { secret: newSecret };
  }

  async processWebhookEvent(args: {
    projectId: string;
    deliveryId: string;
    event: string;
    headers: Record<string, string>;
    payload: any;
    isReplay?: boolean;
  }) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId: args.projectId } });
    if (!config || !config.enabled) return;

    const existing = await this.prisma.webhookEvent.findUnique({ where: { deliveryId: args.deliveryId } });
    if (existing) return; // Already processed

    const parsed = this.githubProvider.parsePayload(args.event, args.payload);
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        projectId: args.projectId,
        provider: 'GITHUB',
        deliveryId: args.deliveryId,
        event: args.event,
        action: args.payload.action || null,
        headers: args.headers,
        payload: args.payload,
        status: 'RECEIVED',
      },
    });

    const eventCheck = this.filter.matchEvent(
      args.event, args.payload.action || null, config.events as string[],
      args.event === 'pull_request' ? args.payload.pull_request?.merged : undefined,
    );
    if (!eventCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: eventCheck.reason, processedAt: new Date() },
      });
      return;
    }

    const branchCheck = this.filter.matchBranch(parsed.branch, config.branchFilters as string[]);
    if (!branchCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: branchCheck.reason, processedAt: new Date() },
      });
      return;
    }

    const pathCheck = this.filter.matchPaths(parsed.changedFiles, config.pathFilters as string[]);
    if (!pathCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: pathCheck.reason, processedAt: new Date() },
      });
      return;
    }

    try {
      const project = await this.prisma.project.findUnique({ where: { id: args.projectId }, select: { createdById: true } });
      const deployment = await this.deployService.trigger(args.projectId, project!.createdById);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: args.isReplay ? 'REPLAYED' : 'TRIGGERED', deploymentId: deployment.id, processedAt: new Date() },
      });
    } catch (err: any) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: err.message, processedAt: new Date() },
      });
    }
  }

  async replayEvent(eventId: string) {
    const original = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!original) throw new NotFoundException('Webhook event not found');

    const replayDeliveryId = `replay-${randomBytes(16).toString('hex')}`;
    await this.processWebhookEvent({
      projectId: original.projectId,
      deliveryId: replayDeliveryId,
      event: original.event,
      headers: original.headers as Record<string, string>,
      payload: original.payload,
      isReplay: true,
    });
  }

  async getEvents(projectId: string, status?: string, page = 1, limit = 20) {
    const where: any = { projectId };
    if (status) where.status = status;
    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { deployment: { select: { id: true, version: true, status: true } } },
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { events, total, page, limit };
  }

  async getEvent(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      include: { deployment: { select: { id: true, version: true, status: true } } },
    });
    if (!event) throw new NotFoundException('Webhook event not found');
    return event;
  }

  async processAppWebhookEvent(args: {
    repoFullName: string;
    deliveryId: string;
    event: string;
    headers: Record<string, string>;
    payload: any;
  }) {
    const repoUrl = `https://github.com/${args.repoFullName}`;
    const project = await this.prisma.project.findFirst({
      where: {
        OR: [{ repoUrl }, { repoUrl: `${repoUrl}.git` }],
        githubInstallationId: { not: null },
      },
    });
    if (!project) return;

    const existing = await this.prisma.webhookEvent.findUnique({ where: { deliveryId: args.deliveryId } });
    if (existing) return;

    const parsed = this.githubProvider.parsePayload(args.event, args.payload);
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        projectId: project.id,
        provider: 'GITHUB',
        deliveryId: args.deliveryId,
        event: args.event,
        action: args.payload.action || null,
        headers: args.headers,
        payload: args.payload,
        status: 'RECEIVED',
      },
    });

    const enabledEvents = ['push', 'pull_request', 'release', 'create', 'delete'];
    const eventCheck = this.filter.matchEvent(
      args.event, args.payload.action || null, enabledEvents,
      args.event === 'pull_request' ? args.payload.pull_request?.merged : undefined,
    );
    if (!eventCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: eventCheck.reason, processedAt: new Date() },
      });
      return;
    }

    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId: project.id } });
    const branchFilters = config ? (config.branchFilters as string[]) : [];
    const pathFilters = config ? (config.pathFilters as string[]) : [];

    if (branchFilters.length > 0) {
      const branchCheck = this.filter.matchBranch(parsed.branch, branchFilters);
      if (!branchCheck.pass) {
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'FILTERED', filterReason: branchCheck.reason, processedAt: new Date() },
        });
        return;
      }
    }

    if (pathFilters.length > 0) {
      const pathCheck = this.filter.matchPaths(parsed.changedFiles, pathFilters);
      if (!pathCheck.pass) {
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'FILTERED', filterReason: pathCheck.reason, processedAt: new Date() },
        });
        return;
      }
    }

    try {
      const deployment = await this.deployService.trigger(project.id, project.createdById);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'TRIGGERED', deploymentId: deployment.id, processedAt: new Date() },
      });
    } catch (err: any) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: err.message, processedAt: new Date() },
      });
    }
  }
}
