import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { PortAllocationService } from './port-allocation.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Pm2Stage } from '../deploy/stages/pm2.stage';

const execFileAsync = promisify(execFile);

const DEFAULT_PIPELINE = {
  stages: [
    { name: 'clone', type: 'builtin', config: {} },
    { name: 'install', type: 'command', command: 'npm install' },
    { name: 'migrate', type: 'command', command: 'npx prisma migrate deploy', optional: true },
    { name: 'build', type: 'command', command: 'npm run build' },
    { name: 'pm2', type: 'builtin', config: {} },
    { name: 'nginx', type: 'builtin', config: {} },
    { name: 'ssl', type: 'builtin', config: {} },
  ],
};

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private portAllocation: PortAllocationService,
    private config: ConfigService,
  ) {}

  private validateDirectory(dir: string): string {
    // Sanitize: no path traversal, no absolute paths, no special chars
    const sanitized = dir.replace(/\\/g, '/').trim();
    if (sanitized.includes('..') || sanitized.startsWith('/') || /[;&|`$]/.test(sanitized)) {
      throw new BadRequestException('Invalid directory name');
    }
    return sanitized;
  }

  getProjectsDir(): string {
    return this.config.get('PROJECTS_DIR', '/var/www');
  }

  async create(userId: string, dto: CreateProjectDto) {
    const envVars = dto.envVars ? this.encryption.encrypt(JSON.stringify(dto.envVars)) : '';
    const directory = dto.directory ? this.validateDirectory(dto.directory) : dto.slug;

    // Create project first with a temporary port of 0
    const project = await this.prisma.project.create({
      data: {
        name: dto.name, slug: dto.slug,
        sourceType: dto.sourceType as any, repoUrl: dto.repoUrl,
        branch: dto.branch || 'main', domain: dto.domain,
        port: 0, envVars, pipeline: dto.pipeline || DEFAULT_PIPELINE,
        pm2Name: dto.slug, directory, createdById: userId,
      },
    });

    // Now allocate port (project exists, FK is valid)
    const port = dto.port
      ? await this.portAllocation.allocateSpecific(project.id, dto.port)
      : await this.portAllocation.allocate(project.id);

    // Update project with the real port
    return this.prisma.project.update({
      where: { id: project.id },
      data: { port },
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      include: { deployments: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id }, include: { deployments: { orderBy: { version: 'desc' }, take: 5 } },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const data: any = { ...dto };
    if (data.envVars) {
      data.envVars = this.encryption.encrypt(JSON.stringify(data.envVars));
    }
    delete data.port;
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.portAllocation.release(id);
    return this.prisma.project.delete({ where: { id } });
  }

  async getDecryptedEnvVars(id: string): Promise<Record<string, string>> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.envVars) return {};
    return JSON.parse(this.encryption.decrypt(project.envVars));
  }

  async stop(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.status === 'STOPPED') throw new BadRequestException('Project is already stopped');

    try {
      await execFileAsync('pm2', ['stop', project.pm2Name]);
    } catch (err: any) {
      throw new BadRequestException(`Failed to stop process: ${err.message}`);
    }

    return this.prisma.project.update({
      where: { id },
      data: { status: 'STOPPED' },
    });
  }

  async restart(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');

    // Regenerate ecosystem.config.js with latest ENV before restarting
    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsDir, project.directory || project.slug);
    const projectDir = project.workDir ? join(repoDir, project.workDir) : repoDir;

    let script = project.startCommand || 'dist/main.js';
    let isNpmStart = false;
    if (!project.startCommand) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
        if (pkg.scripts?.start) { script = 'npm'; isNpmStart = true; }
        else if (pkg.main) { script = pkg.main; }
      } catch {}
    }

    const pm2Stage = new Pm2Stage();
    const ecosystemContent = pm2Stage.buildEcosystemConfig(
      { name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars },
      isNpmStart,
    );
    writeFileSync(join(projectDir, 'ecosystem.config.js'), ecosystemContent);

    try {
      await execFileAsync('pm2', ['restart', project.pm2Name]);
    } catch (err: any) {
      throw new BadRequestException(`Failed to restart process: ${err.message}`);
    }

    return this.prisma.project.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }
}
