import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class DeployService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService)) private projectsService: ProjectsService,
    @InjectQueue('deploy') private deployQueue: Queue,
    private config: ConfigService,
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

  async checkRemoteCommit(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { repoUrl: true, branch: true, githubInstallationId: true },
    });
    if (!project?.repoUrl?.includes('github.com')) return null;

    const match = project.repoUrl.replace(/\.git$/, '').match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return null;
    const repo = match[1];

    let token: string | undefined;
    if (project.githubInstallationId) {
      try {
        const installation = await this.prisma.gitHubInstallation.findUnique({ where: { id: project.githubInstallationId } });
        if (installation) token = await this.getInstallationToken(installation.installationId);
      } catch {}
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers.Authorization = `token ${token}`;
      const res = await fetch(`https://api.github.com/repos/${repo}/commits/${project.branch || 'main'}`, { headers });
      if (!res.ok) return null;
      const data = await res.json();
      const remoteHash = data.sha?.slice(0, 7);
      const remoteMessage = data.commit?.message?.split('\n')[0] || '';

      const lastDeploy = await this.prisma.deployment.findFirst({
        where: { projectId, status: 'SUCCESS' },
        orderBy: { version: 'desc' },
        select: { commitHash: true },
      });

      const deployedHash = lastDeploy?.commitHash?.slice(0, 7);
      const behind = !!deployedHash && !!remoteHash && deployedHash !== remoteHash;

      return { remoteHash, remoteMessage, deployedHash, behind };
    } catch {
      return null;
    }
  }

  private async getInstallationToken(installationId: number): Promise<string> {
    const appId = this.config.get('GITHUB_APP_ID');
    const privateKey = Buffer.from(this.config.get('GITHUB_APP_PRIVATE_KEY', ''), 'base64').toString('utf-8');
    if (!appId || !privateKey) throw new Error('GitHub App not configured');
    const now = Math.floor(Date.now() / 1000);
    const jwt = sign({ iat: now - 60, exp: now + 600, iss: appId }, privateKey, { algorithm: 'RS256' });
    const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub token request failed: ${res.status}`);
    const data = await res.json();
    return data.token;
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
