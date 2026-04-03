import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class DeployService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    @InjectQueue('deploy') private deployQueue: Queue,
  ) {}

  async trigger(projectId: string, userId: string, resumeFromStage?: number) {
    const project = await this.projectsService.findOne(projectId);
    const version = (await this.prisma.deployment.count({ where: { projectId } })) + 1;
    const stages = (project.pipeline as any).stages.map((s: any) => ({ ...s, status: 'PENDING', logs: [] }));
    const deployment = await this.prisma.deployment.create({
      data: { projectId, triggeredById: userId, version, status: 'QUEUED', stages },
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

  async getHistory(projectId: string) {
    return this.prisma.deployment.findMany({
      where: { projectId }, orderBy: { version: 'desc' },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
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
