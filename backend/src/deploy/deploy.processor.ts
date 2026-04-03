import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { CloneStage } from './stages/clone.stage';
import { Pm2Stage } from './stages/pm2.stage';
import { NginxStage } from './stages/nginx.stage';
import { SslStage } from './stages/ssl.stage';
import { CommandStage } from './stages/command.stage';
import { DeployGateway } from './deploy.gateway';
import { existsSync } from 'fs';
import { join } from 'path';

@Processor('deploy')
export class DeployProcessor extends WorkerHost {
  private cloneStage = new CloneStage();
  private pm2Stage = new Pm2Stage();
  private nginxStage = new NginxStage();
  private sslStage = new SslStage();
  private commandStage = new CommandStage();

  constructor(
    private prisma: PrismaService, private projectsService: ProjectsService,
    private encryption: EncryptionService, private config: ConfigService,
    private gateway: DeployGateway,
  ) { super(); }

  async process(job: Job<{ deploymentId: string; projectId: string; resumeFromStage?: number }>) {
    const { deploymentId, projectId, resumeFromStage } = job.data;
    const project = await this.projectsService.findOne(projectId);
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const projectDir = join(projectsDir, project.slug);
    const isFirstDeploy = !existsSync(projectDir);

    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'RUNNING', startedAt: new Date() } });
    this.gateway.emitToDeployment(deploymentId, 'status', { status: 'RUNNING' });

    const stages = (project.pipeline as any).stages;
    let allSuccess = true;

    for (let i = 0; i < stages.length; i++) {
      if (resumeFromStage !== undefined && i < resumeFromStage) continue;
      const stage = stages[i];
      this.gateway.emitToDeployment(deploymentId, 'stage-start', { index: i, name: stage.name });
      await this.updateStageStatus(deploymentId, i, 'RUNNING');

      let result: { success: boolean; error?: string };
      if (stage.type === 'builtin') {
        result = await this.executeBuiltinStage(stage.name, project, projectDir, isFirstDeploy && i === 0, deploymentId);
      } else {
        result = await this.commandStage.execute(stage, {
          projectDir, onLog: (line) => this.gateway.emitToDeployment(deploymentId, 'log', { index: i, line }),
        });
      }

      await this.updateStageStatus(deploymentId, i, result.success ? 'SUCCESS' : 'FAILED', result.error);
      this.gateway.emitToDeployment(deploymentId, 'stage-end', { index: i, success: result.success });
      if (!result.success) { allSuccess = false; break; }
    }

    const finalStatus = allSuccess ? 'SUCCESS' : 'FAILED';
    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: finalStatus, finishedAt: new Date() } });
    if (allSuccess) await this.prisma.project.update({ where: { id: projectId }, data: { status: 'ACTIVE' } });
    this.gateway.emitToDeployment(deploymentId, 'status', { status: finalStatus });
    this.gateway.emitToDashboard('project-status', { projectId, status: allSuccess ? 'ACTIVE' : 'ERROR' });
  }

  private async executeBuiltinStage(name: string, project: any, projectDir: string, isFirstDeploy: boolean, deploymentId: string) {
    const logFn = (line: string) => this.gateway.emitToDeployment(deploymentId, 'log', { stage: name, line });
    const ctx = { projectDir, onLog: logFn };

    switch (name) {
      case 'clone':
        return this.cloneStage.execute({ repoUrl: project.repoUrl!, branch: project.branch, projectDir, isFirstDeploy }, ctx);
      case 'pm2': {
        let envVars: Record<string, string> = {};
        if (project.envVars) { try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {} }
        return this.pm2Stage.execute({ name: project.pm2Name, script: 'dist/main.js', cwd: projectDir, port: project.port, envVars }, isFirstDeploy, ctx);
      }
      case 'nginx':
        if (!project.domain) { logFn('No domain configured, skipping nginx'); return { success: true }; }
        return this.nginxStage.execute({ domain: project.domain, port: project.port, slug: project.slug, hasSsl: this.sslStage.hasCert(project.domain) }, ctx);
      case 'ssl':
        if (!project.domain) { logFn('No domain configured, skipping SSL'); return { success: true }; }
        const sslResult = await this.sslStage.execute(project.domain, ctx);
        if (sslResult.success) {
          await this.nginxStage.execute({ domain: project.domain, port: project.port, slug: project.slug, hasSsl: true }, ctx);
        }
        return sslResult;
      default:
        logFn(`Unknown builtin stage: ${name}`);
        return { success: false, error: `Unknown builtin stage: ${name}` };
    }
  }

  private async updateStageStatus(deploymentId: string, index: number, status: string, error?: string) {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    const stages = deployment!.stages as any[];
    stages[index] = { ...stages[index], status, error };
    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { stages } });
  }
}
