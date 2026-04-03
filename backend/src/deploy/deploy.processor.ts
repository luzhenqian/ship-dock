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
    const repoDir = join(projectsDir, project.directory || project.slug);
    const isFirstDeploy = !existsSync(repoDir);
    // workDir is the subdirectory where commands run (e.g. "apps/web" in a monorepo)
    const projectDir = project.workDir ? join(repoDir, project.workDir) : repoDir;

    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'RUNNING', startedAt: new Date() } });
    this.gateway.emitToDeployment(deploymentId, 'status', { status: 'RUNNING' });

    const stages = (project.pipeline as any).stages;
    let allSuccess = true;

    for (let i = 0; i < stages.length; i++) {
      if (resumeFromStage !== undefined && i < resumeFromStage) continue;
      const stage = stages[i];
      this.gateway.emitToDeployment(deploymentId, 'stage-start', { index: i, name: stage.name });
      await this.updateStageStatus(deploymentId, i, 'RUNNING');

      // Collect logs in memory, persist once when stage finishes
      const stageLogs: string[] = [];
      const onLog = (line: string) => {
        const stageName = stage.name;
        this.gateway.emitToDeployment(deploymentId, 'log', { index: i, stage: stageName, line });
        stageLogs.push(line);
      };

      let result: { success: boolean; error?: string };
      if (stage.type === 'builtin') {
        result = await this.executeBuiltinStage(stage.name, project, repoDir, projectDir, isFirstDeploy && i === 0, deploymentId, onLog);
      } else {
        result = await this.commandStage.execute(stage, { projectDir, onLog });
      }

      // Optional stages: log warning but continue on failure
      if (!result.success && stage.optional) {
        onLog(`\x1b[33m[warning] Stage "${stage.name}" failed but is marked as optional, skipping\x1b[0m`);
        await this.updateStageStatus(deploymentId, i, 'SKIPPED', result.error, stageLogs);
        this.gateway.emitToDeployment(deploymentId, 'stage-end', { index: i, success: true });
        continue;
      }

      // Persist logs + status in one atomic write
      await this.updateStageStatus(deploymentId, i, result.success ? 'SUCCESS' : 'FAILED', result.error, stageLogs);
      this.gateway.emitToDeployment(deploymentId, 'stage-end', { index: i, success: result.success });
      if (!result.success) { allSuccess = false; break; }
    }

    const finalStatus = allSuccess ? 'SUCCESS' : 'FAILED';
    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: finalStatus, finishedAt: new Date() } });
    if (allSuccess) await this.prisma.project.update({ where: { id: projectId }, data: { status: 'ACTIVE' } });
    this.gateway.emitToDeployment(deploymentId, 'status', { status: finalStatus });
    this.gateway.emitToDashboard('project-status', { projectId, status: allSuccess ? 'ACTIVE' : 'ERROR' });
  }

  private async executeBuiltinStage(
    name: string, project: any, repoDir: string, projectDir: string,
    isFirstDeploy: boolean, deploymentId: string,
    onLog: (line: string) => void,
  ) {
    const ctx = { projectDir, onLog };

    switch (name) {
      case 'clone':
        return this.cloneStage.execute({ repoUrl: project.repoUrl!, branch: project.branch, projectDir: repoDir, isFirstDeploy }, { projectDir: repoDir, onLog });
      case 'pm2': {
        let envVars: Record<string, string> = {};
        if (project.envVars) { try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {} }
        // Determine start script: user-specified > package.json start > dist/main.js
        let script = project.startCommand || 'dist/main.js';
        if (!project.startCommand) {
          try {
            const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
            if (pkg.scripts?.start) {
              // Use npm start via pm2
              script = 'npm';
            } else if (pkg.main) {
              script = pkg.main;
            }
          } catch {}
        }
        const isNpmStart = script === 'npm';
        return this.pm2Stage.execute(
          { name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars },
          isFirstDeploy, ctx, isNpmStart,
        );
      }
      case 'nginx':
        if (!project.domain) { onLog('No domain configured, skipping nginx'); return { success: true }; }
        return this.nginxStage.execute({ domain: project.domain, port: project.port, slug: project.slug, hasSsl: this.sslStage.hasCert(project.domain) }, ctx);
      case 'ssl':
        if (!project.domain) { onLog('No domain configured, skipping SSL'); return { success: true }; }
        const sslResult = await this.sslStage.execute(project.domain, ctx);
        if (sslResult.success) {
          await this.nginxStage.execute({ domain: project.domain, port: project.port, slug: project.slug, hasSsl: true }, ctx);
        }
        return sslResult;
      default:
        onLog(`Unknown builtin stage: ${name}`);
        return { success: false, error: `Unknown builtin stage: ${name}` };
    }
  }

  private async updateStageStatus(deploymentId: string, index: number, status: string, error?: string, logs?: string[]) {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    const stages = deployment!.stages as any[];
    // Preserve existing logs, only update status and error
    const existingLogs = stages[index].logs || [];
    stages[index] = { ...stages[index], status };
    if (error !== undefined) stages[index].error = error;
    stages[index].logs = existingLogs;
    if (logs && logs.length > 0) {
      stages[index].logs.push(...logs);
      console.log(`[updateStageStatus] stage=${index} status=${status} logsCount=${stages[index].logs.length}`);
    }
    await this.prisma.deployment.update({ where: { id: deploymentId }, data: { stages } });
  }
}
