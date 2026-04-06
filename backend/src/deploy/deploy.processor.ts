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
import { DomainsService } from '../domains/domains.service';
import { DatabaseProvisionerService } from '../common/database-provisioner.service';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

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
    private gateway: DeployGateway, private domainsService: DomainsService,
    private dbProvisioner: DatabaseProvisionerService,
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

    // Decrypt project env vars for command stages
    let projectEnvVars: Record<string, string> = {};
    if (project.envVars) {
      try { projectEnvVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const stages = (project.pipeline as any).stages;
    let allSuccess = true;

    for (let i = 0; i < stages.length; i++) {
      if (resumeFromStage !== undefined && i < resumeFromStage) continue;
      const stage = stages[i];
      this.gateway.emitToDeployment(deploymentId, 'stage-start', { index: i, name: stage.name });
      await this.updateStageStatus(deploymentId, i, 'RUNNING');

      // Collect logs in memory, persist once when stage finishes
      const stageLogs: Array<{ t: number; m: string }> = [];
      const onLog = (line: string) => {
        const stageName = stage.name;
        const entry = { t: Date.now(), m: line };
        this.gateway.emitToDeployment(deploymentId, 'log', { index: i, stage: stageName, line, t: entry.t });
        stageLogs.push(entry);
      };

      // Write .env file after clone stage
      if (stages[i - 1]?.name === 'clone' || (i === 0 && stage.name !== 'clone')) {
        try {
          let envVars: Record<string, string> = {};
          if (project.envVars) {
            try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
          }
          if (Object.keys(envVars).length > 0) {
            const envPath = join(projectDir, '.env');
            mkdirSync(dirname(envPath), { recursive: true });
            const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
            writeFileSync(envPath, envContent);
            onLog(`Wrote .env file (${Object.keys(envVars).length} variables)`);
          }
        } catch (err: any) {
          onLog(`\x1b[33m[warning] Failed to write .env: ${err.message}\x1b[0m`);
        }
      }

      // Auto-ensure database exists before migrate stage
      if (stage.name === 'migrate' && project.useLocalDb && project.dbName) {
        try {
          onLog(`Ensuring database "${project.dbName}" exists...`);
          await this.dbProvisioner.ensureDatabase(project.dbName);
          onLog(`Database "${project.dbName}" ready`);
        } catch (err: any) {
          onLog(`\x1b[31mFailed to ensure database: ${err.message}\x1b[0m`);
        }
      }

      let result: { success: boolean; error?: string };
      if (stage.type === 'builtin') {
        result = await this.executeBuiltinStage(stage.name, project, repoDir, projectDir, isFirstDeploy && i === 0, deploymentId, onLog);
      } else {
        result = await this.commandStage.execute(stage, { projectDir, onLog, envVars: projectEnvVars });
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
        const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId: project.id } });
        // Determine start script: pm2Config.script > user-specified > package.json start > dist/main.js
        let script = pm2Config?.script || project.startCommand || 'dist/main.js';
        if (!pm2Config?.script && !project.startCommand) {
          try {
            const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
            if (pkg.scripts?.start) {
              script = 'npm';
            } else if (pkg.main) {
              script = pkg.main;
            }
          } catch {}
        }
        const isNpmStart = script === 'npm';
        return this.pm2Stage.execute(
          {
            name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars,
            instances: pm2Config?.instances,
            execMode: pm2Config?.execMode,
            maxMemoryRestart: pm2Config?.maxMemoryRestart ?? undefined,
          },
          isFirstDeploy, ctx, isNpmStart,
        );
      }
      case 'nginx': {
        if (!project.domain) { onLog('No domain configured, skipping nginx'); return { success: true }; }
        const nginxConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId: project.id } });
        return this.nginxStage.execute({
          domain: project.domain, port: project.port, slug: project.slug,
          hasSsl: this.sslStage.hasCert(project.domain),
          ...(nginxConfig && {
            clientMaxBodySize: nginxConfig.clientMaxBodySize,
            proxyReadTimeout: nginxConfig.proxyReadTimeout,
            proxySendTimeout: nginxConfig.proxySendTimeout,
            proxyConnectTimeout: nginxConfig.proxyConnectTimeout,
            gzipEnabled: nginxConfig.gzipEnabled,
            gzipMinLength: nginxConfig.gzipMinLength,
            gzipTypes: nginxConfig.gzipTypes,
            proxyBuffering: nginxConfig.proxyBuffering,
            proxyBufferSize: nginxConfig.proxyBufferSize,
            proxyBuffers: nginxConfig.proxyBuffers,
          }),
        }, ctx);
      }
      case 'ssl': {
        if (!project.domain) { onLog('No domain configured, skipping SSL'); return { success: true }; }
        const serverIp = this.config.get('SERVER_IP');
        const sslResult = await this.sslStage.execute(project.domain, ctx, this.domainsService, serverIp);
        if (sslResult.success) {
          const nginxConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId: project.id } });
          await this.nginxStage.execute({
            domain: project.domain, port: project.port, slug: project.slug, hasSsl: true,
            ...(nginxConfig && {
              clientMaxBodySize: nginxConfig.clientMaxBodySize,
              proxyReadTimeout: nginxConfig.proxyReadTimeout,
              proxySendTimeout: nginxConfig.proxySendTimeout,
              proxyConnectTimeout: nginxConfig.proxyConnectTimeout,
              gzipEnabled: nginxConfig.gzipEnabled,
              gzipMinLength: nginxConfig.gzipMinLength,
              gzipTypes: nginxConfig.gzipTypes,
              proxyBuffering: nginxConfig.proxyBuffering,
              proxyBufferSize: nginxConfig.proxyBufferSize,
              proxyBuffers: nginxConfig.proxyBuffers,
            }),
          }, ctx);
        }
        return sslResult;
      }
      default:
        onLog(`Unknown builtin stage: ${name}`);
        return { success: false, error: `Unknown builtin stage: ${name}` };
    }
  }

  private async updateStageStatus(deploymentId: string, index: number, status: string, error?: string, logs?: Array<{ t: number; m: string }>) {
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
