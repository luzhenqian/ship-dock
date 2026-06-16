import { Inject, forwardRef } from '@nestjs/common';
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
import { ProjectLockService } from '../common/project-lock.service';
import { sign } from 'jsonwebtoken';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { SYSTEM_DEPS_WHITELIST } from '../projects/system-deps.const';
import { DB_EXTENSIONS_WHITELIST } from '../projects/db-extensions.const';

@Processor('deploy')
export class DeployProcessor extends WorkerHost {
  private cloneStage = new CloneStage();
  private pm2Stage = new Pm2Stage();
  private nginxStage = new NginxStage();
  private sslStage = new SslStage();
  private commandStage = new CommandStage();

  constructor(
    private prisma: PrismaService, @Inject(forwardRef(() => ProjectsService)) private projectsService: ProjectsService,
    private encryption: EncryptionService, private config: ConfigService,
    private gateway: DeployGateway, private domainsService: DomainsService,
    private dbProvisioner: DatabaseProvisionerService, private projectLock: ProjectLockService,
  ) { super(); }

  private async getGitHubInstallationToken(installationId: number): Promise<string> {
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

  async process(job: Job<{ deploymentId: string; projectId: string; resumeFromStage?: number }>) {
    const { deploymentId, projectId, resumeFromStage } = job.data;
    return this.projectLock.withLock(projectId, async () => {
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

      // Prepend Node.js version bin to PATH if configured
      if (project.nodeVersion) {
        try {
          const { readdirSync } = require('fs');
          const versions: string[] = readdirSync('/usr/local/n/versions/node/');
          const match = versions.find((v: string) => v.startsWith(project.nodeVersion + '.'));
          if (match) {
            const nodeBin = `/usr/local/n/versions/node/${match}/bin`;
            projectEnvVars.PATH = `${nodeBin}:${process.env.PATH || ''}`;
          }
        } catch {}
      }

      // Install system dependencies if configured
      const systemDeps = (project.systemDeps as string[]) || [];
      if (systemDeps.length > 0) {
        const packagesToInstall: string[] = [];
        for (const depId of systemDeps) {
          const entry = SYSTEM_DEPS_WHITELIST.find((d) => d.id === depId);
          if (!entry) continue;
          for (const pkg of entry.packages) {
            try {
              execFileSync('dpkg', ['-s', pkg], { stdio: 'pipe' });
            } catch {
              packagesToInstall.push(pkg);
            }
          }
        }
        if (packagesToInstall.length > 0) {
          this.gateway.emitToDeployment(deploymentId, 'log', { index: -1, stage: 'system-deps', line: `Installing system dependencies: ${packagesToInstall.join(', ')}`, t: Date.now() });
          try {
            execFileSync('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', ...packagesToInstall], { stdio: 'pipe', timeout: 120000 });
            this.gateway.emitToDeployment(deploymentId, 'log', { index: -1, stage: 'system-deps', line: 'System dependencies installed', t: Date.now() });
          } catch (err: any) {
            this.gateway.emitToDeployment(deploymentId, 'log', { index: -1, stage: 'system-deps', line: `\x1b[31mFailed to install system dependencies: ${err.message}\x1b[0m`, t: Date.now() });
          }
        }
      }

      const stages = (project.pipeline as any).stages;
      let pmDetected = false;
      let detectedPm: 'npm' | 'pnpm' | 'yarn' = 'npm';
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
            const extIds = (project.dbExtensions as string[]) || [];
            const pgExtNames = extIds
              .map((id) => DB_EXTENSIONS_WHITELIST.find((e) => e.id === id)?.extension)
              .filter(Boolean) as string[];
            await this.dbProvisioner.ensureDatabase(project.dbName, pgExtNames);
            onLog(`Database "${project.dbName}" ready${pgExtNames.length ? ` (extensions: ${pgExtNames.join(', ')})` : ''}`);
          } catch (err: any) {
            onLog(`\x1b[31mFailed to ensure database: ${err.message}\x1b[0m`);
          }
        }

        let result: { success: boolean; error?: string };
        if (stage.type === 'builtin') {
          result = await this.executeBuiltinStage(stage.name, project, repoDir, projectDir, isFirstDeploy && i === 0, deploymentId, onLog, projectEnvVars, detectedPm);
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

        // After clone succeeds, capture latest git commit info + detect package manager
        if (stage.name === 'clone' && result.success) {
          try {
            const hash = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
            const message = execSync('git log -1 --pretty=%s', { cwd: repoDir, encoding: 'utf8' }).trim();
            await this.prisma.deployment.update({ where: { id: deploymentId }, data: { commitHash: hash, commitMessage: message } });
          } catch {}

          if (!pmDetected) {
            pmDetected = true;
            detectedPm = this.detectPackageManager(projectDir);
            if (detectedPm !== 'npm') {
              onLog(`Detected package manager: ${detectedPm}`);
              for (const s of stages) {
                if (s.type === 'command' && s.command) {
                  s.command = this.rewriteCommand(s.command, detectedPm);
                }
              }
            }
          }
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
    });
  }

  private async executeBuiltinStage(
    name: string, project: any, repoDir: string, projectDir: string,
    isFirstDeploy: boolean, deploymentId: string,
    onLog: (line: string) => void, projectEnvVars: Record<string, string> = {},
    packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm',
  ) {
    const ctx = { projectDir, onLog, envVars: projectEnvVars };

    switch (name) {
      case 'static-sync': {
        const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
        const targetDir = join(projectsDir, project.directory || project.slug);
        const staticFiles = await this.prisma.staticFile.findMany({ where: { projectId: project.id } });
        if (staticFiles.length === 0) {
          onLog('No static files to deploy');
          return { success: false, error: 'No static files to deploy. Use the editor to add files.' };
        }
        try {
          if (existsSync(targetDir)) {
            execSync(`rm -rf ${targetDir}`);
          }
          mkdirSync(targetDir, { recursive: true });
          for (const file of staticFiles) {
            const filePath = join(targetDir, file.path);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, file.content, 'utf8');
            onLog(`Wrote ${file.path}`);
          }
          onLog(`Static files deployed to ${targetDir}`);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
      case 'clone': {
        let githubToken: string | undefined;
        if (project.githubInstallationId) {
          try {
            const installation = await this.prisma.gitHubInstallation.findUnique({ where: { id: project.githubInstallationId } });
            if (installation) {
              githubToken = await this.getGitHubInstallationToken(installation.installationId);
            }
          } catch (err: any) {
            onLog(`\x1b[33mWarning: Could not get GitHub token: ${err.message}. Trying without auth.\x1b[0m`);
          }
        }
        return this.cloneStage.execute({ repoUrl: project.repoUrl!, branch: project.branch, projectDir: repoDir, isFirstDeploy, githubToken }, { projectDir: repoDir, onLog });
      }
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
              script = packageManager;
            } else if (pkg.main) {
              script = pkg.main;
            }
          } catch {}
        }
        const isNpmStart = ['npm', 'pnpm', 'yarn'].includes(script);
        return this.pm2Stage.execute(
          {
            name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars,
            instances: pm2Config?.instances,
            execMode: pm2Config?.execMode,
            maxMemoryRestart: pm2Config?.maxMemoryRestart ?? undefined,
          },
          isFirstDeploy, { ...ctx, envVars: projectEnvVars }, isNpmStart,
        );
      }
      case 'nginx': {
        if (!project.domain) { onLog('No domain configured, skipping nginx'); return { success: true }; }
        if (project.sourceType === 'STATIC') {
          const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
          const rootDir = join(projectsDir, project.directory || project.slug);
          return this.nginxStage.executeStatic({
            domain: project.domain, slug: project.slug,
            rootDir, hasSsl: this.sslStage.hasCert(project.domain),
          }, ctx);
        }
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
          if (project.sourceType === 'STATIC') {
            const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
            const rootDir = join(projectsDir, project.directory || project.slug);
            await this.nginxStage.executeStatic({
              domain: project.domain, slug: project.slug, rootDir, hasSsl: true,
            }, ctx);
          } else {
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
        }
        return sslResult;
      }
      default:
        onLog(`Unknown builtin stage: ${name}`);
        return { success: false, error: `Unknown builtin stage: ${name}` };
    }
  }

  private detectPackageManager(projectDir: string): 'npm' | 'pnpm' | 'yarn' {
    if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn';
    return 'npm';
  }

  private rewriteCommand(command: string, pm: 'pnpm' | 'yarn'): string {
    return command
      .replace(/\bnpm install\b/g, pm === 'pnpm' ? 'pnpm install' : 'yarn install')
      .replace(/\bnpm ci\b/g, pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'yarn install --frozen-lockfile')
      .replace(/\bnpm run\b/g, pm === 'pnpm' ? 'pnpm run' : 'yarn run')
      .replace(/\bnpx\b/g, pm === 'pnpm' ? 'pnpm exec' : 'yarn exec');
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
