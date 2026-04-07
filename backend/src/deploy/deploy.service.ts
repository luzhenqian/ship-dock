import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class DeployService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService)) private projectsService: ProjectsService,
    @InjectQueue('deploy') private deployQueue: Queue,
  ) {}

  async trigger(projectId: string, userId: string, resumeFromStage?: number, commit?: { hash?: string | null; message?: string | null }) {
    const project = await this.projectsService.findOne(projectId);
    const version = (await this.prisma.deployment.count({ where: { projectId } })) + 1;
    const stages = (project.pipeline as any).stages.map((s: any) => ({ ...s, status: 'PENDING', logs: [] }));
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId, triggeredById: userId, version, status: 'QUEUED', stages,
        commitHash: commit?.hash || null,
        commitMessage: commit?.message || null,
      },
    });
    await this.deployQueue.add('deploy', { deploymentId: deployment.id, projectId, resumeFromStage });
    return deployment;
  }

  async cancel(deploymentId: string) {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'RUNNING' && deployment.status !== 'QUEUED')
      throw new BadRequestException('Can only cancel queued or running deployments');
    return this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  }

  async retry(deploymentId: string, userId: string) {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'FAILED') throw new BadRequestException('Can only retry failed deployments');
    const stages = deployment.stages as any[];
    const failedIndex = stages.findIndex((s) => s.status === 'FAILED');
    return this.trigger(deployment.projectId, userId, failedIndex);
  }

  async rollback(projectId: string, userId: string) {
    const lastSuccess = await this.prisma.deployment.findFirst({ where: { projectId, status: 'SUCCESS' }, orderBy: { version: 'desc' } });
    if (!lastSuccess) throw new BadRequestException('No successful deployment to rollback to');
    return this.trigger(projectId, userId);
  }

  async getHistory(projectId: string, cursor?: string, limit = 20) {
    const where: any = { projectId };
    if (cursor) {
      const cursorDeployment = await this.prisma.deployment.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (cursorDeployment) {
        where.createdAt = { lt: cursorDeployment.createdAt };
      }
    }
    const items = await this.prisma.deployment.findMany({
      where,
      orderBy: { version: 'desc' },
      take: limit + 1,
      include: {
        triggeredBy: { select: { id: true, name: true } },
        webhookEvent: { select: { id: true, provider: true } },
      },
      omit: { stages: true },
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return {
      items: items.map((d) => ({
        ...d,
        duration: d.startedAt && d.finishedAt
          ? Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000)
          : null,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getOne(deploymentId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { triggeredBy: { select: { id: true, name: true } }, project: { select: { id: true, name: true, slug: true } } },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');
    return deployment;
  }
}
