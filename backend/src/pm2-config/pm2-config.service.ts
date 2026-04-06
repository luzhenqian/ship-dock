import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { UpdatePm2ConfigDto } from './dto/update-pm2-config.dto';
import { Pm2Stage } from '../deploy/stages/pm2.stage';

const execFileAsync = promisify(execFile);

@Injectable()
export class Pm2ConfigService {
  private pm2Stage = new Pm2Stage();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
  ) {}

  private extractValues(config: { script: string | null; instances: number; execMode: string; maxMemoryRestart: string | null }) {
    return {
      script: config.script,
      instances: config.instances,
      execMode: config.execMode,
      maxMemoryRestart: config.maxMemoryRestart,
    };
  }

  private getProjectDir(project: { slug: string; directory: string | null; workDir: string | null }): string {
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsDir, project.directory || project.slug);
    return project.workDir ? join(repoDir, project.workDir) : repoDir;
  }

  private detectScript(projectDir: string, startCommand: string | null): { script: string; isNpmStart: boolean } {
    let script = startCommand || 'dist/main.js';
    let isNpmStart = false;
    if (!startCommand) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
        if (pkg.scripts?.start) { script = 'npm'; isNpmStart = true; }
        else if (pkg.main) { script = pkg.main; }
      } catch {}
    }
    return { script, isNpmStart };
  }

  async getConfig(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId } });

    const defaults = { script: null as string | null, instances: 1, execMode: 'fork', maxMemoryRestart: null as string | null };
    const values = pm2Config ? this.extractValues(pm2Config) : defaults;

    const projectDir = this.getProjectDir(project);
    const { script: detectedScript } = this.detectScript(projectDir, project.startCommand);

    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try {
        const parsed = JSON.parse(this.encryption.decrypt(project.envVars));
        envVars = Object.fromEntries(Object.entries(parsed).map(([k]) => [k, '••••••']));
      } catch {}
    }

    const effectiveScript = values.script || detectedScript;
    const isNpmStart = effectiveScript === 'npm';
    const preview = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars: { ...envVars, PORT: String(project.port), NODE_ENV: 'production' },
        instances: values.instances,
        execMode: values.execMode,
        maxMemoryRestart: values.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );

    return {
      config: values,
      info: {
        name: project.pm2Name,
        cwd: projectDir,
        port: project.port,
        detectedScript,
        envVars,
      },
      preview,
    };
  }

  async updateConfig(projectId: string, dto: UpdatePm2ConfigDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.directory) throw new BadRequestException('Project must be deployed before editing PM2 settings');

    const pm2Config = await this.prisma.pm2Config.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });

    // Build and write ecosystem.config.js
    const projectDir = this.getProjectDir(project);
    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const effectiveScript = pm2Config.script || this.detectScript(projectDir, project.startCommand).script;
    const isNpmStart = effectiveScript === 'npm';

    const ecosystemContent = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars,
        instances: pm2Config.instances,
        execMode: pm2Config.execMode,
        maxMemoryRestart: pm2Config.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );
    writeFileSync(join(projectDir, 'ecosystem.config.js'), ecosystemContent);

    // Restart PM2 process
    try {
      await execFileAsync('pm2', ['restart', project.pm2Name]);
    } catch (err: any) {
      throw new BadRequestException(`PM2 restart failed: ${err.message}`);
    }

    // Build preview with masked env vars for response
    const maskedEnvVars = Object.fromEntries(Object.entries(envVars).map(([k]) => [k, '••••••']));
    const preview = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars: { ...maskedEnvVars, PORT: String(project.port), NODE_ENV: 'production' },
        instances: pm2Config.instances,
        execMode: pm2Config.execMode,
        maxMemoryRestart: pm2Config.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );

    return {
      config: this.extractValues(pm2Config),
      info: {
        name: project.pm2Name,
        cwd: projectDir,
        port: project.port,
        detectedScript: this.detectScript(projectDir, project.startCommand).script,
        envVars: maskedEnvVars,
      },
      preview,
    };
  }
}
