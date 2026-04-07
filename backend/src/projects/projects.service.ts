import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { DatabaseProvisionerService } from '../common/database-provisioner.service';
import { RedisProvisionerService } from '../common/redis-provisioner.service';
import { MinioProvisionerService } from '../common/minio-provisioner.service';
import { PortAllocationService } from './port-allocation.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { WebhooksService } from '../webhooks/webhooks.service';
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
    private dbProvisioner: DatabaseProvisionerService,
    private redisProvisioner: RedisProvisionerService,
    private minioProvisioner: MinioProvisionerService,
    @Inject(forwardRef(() => WebhooksService))
    private webhooksService: WebhooksService,
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

  async checkPortAvailability(port: number): Promise<{ available: boolean; message?: string }> {
    const minPort = this.config.get('PORT_RANGE_MIN', 3001);
    const maxPort = this.config.get('PORT_RANGE_MAX', 3999);
    if (port < minPort || port > maxPort) {
      return { available: false, message: `Port must be between ${minPort} and ${maxPort}` };
    }
    const existing = await this.prisma.portAllocation.findUnique({ where: { port } });
    if (existing && existing.projectId) {
      return { available: false, message: `Port ${port} is already in use` };
    }
    return { available: true };
  }

  async create(userId: string, dto: CreateProjectDto) {
    const envVarsObj: Record<string, string> = dto.envVars || {};
    let dbName: string | undefined;

    // Auto-provision database if requested
    if (dto.useLocalDb) {
      dbName = await this.dbProvisioner.generateDbName(dto.slug);
      const db = await this.dbProvisioner.provision(dbName);
      envVarsObj.DATABASE_URL = db.databaseUrl;
    }

    // Auto-provision Redis if requested
    let redisDbIndex: number | undefined;
    if (dto.useLocalRedis) {
      redisDbIndex = await this.redisProvisioner.allocateDbIndex();
      const redis = await this.redisProvisioner.provision(redisDbIndex);
      envVarsObj.REDIS_URL = redis.redisUrl;
    }

    // Auto-provision MinIO if requested
    let minioBucket: string | undefined;
    if (dto.useLocalMinio) {
      minioBucket = this.minioProvisioner.generateBucketName(dto.slug);
      const minio = await this.minioProvisioner.provision(minioBucket);
      envVarsObj.MINIO_ENDPOINT = minio.endpoint;
      envVarsObj.MINIO_PORT = String(minio.port);
      envVarsObj.MINIO_ACCESS_KEY = minio.accessKey;
      envVarsObj.MINIO_SECRET_KEY = minio.secretKey;
      envVarsObj.MINIO_BUCKET = minio.bucketName;
      envVarsObj.MINIO_USE_SSL = String(minio.useSSL);
    }

    const envVars = Object.keys(envVarsObj).length > 0 ? this.encryption.encrypt(JSON.stringify(envVarsObj)) : '';
    const directory = dto.directory ? this.validateDirectory(dto.directory) : dto.slug;

    // Create project first with a temporary port of 0
    const project = await this.prisma.project.create({
      data: {
        name: dto.name, slug: dto.slug,
        sourceType: dto.sourceType as any, repoUrl: dto.repoUrl,
        branch: dto.branch || 'main', domain: dto.domain,
        port: 0, envVars, pipeline: dto.pipeline || DEFAULT_PIPELINE,
        pm2Name: dto.slug, directory, createdById: userId,
        useLocalDb: dto.useLocalDb || false, dbName,
        useLocalRedis: dto.useLocalRedis || false, redisDbIndex,
        useLocalMinio: dto.useLocalMinio || false, minioBucket,
      },
    });

    // Auto-create service connection for platform DB
    if (dto.useLocalDb && dbName) {
      const dbUrl = new URL(envVarsObj.DATABASE_URL);
      await this.prisma.serviceConnection.create({
        data: {
          projectId: project.id,
          type: 'POSTGRESQL',
          name: 'Platform Database',
          config: this.encryption.encrypt(JSON.stringify({
            host: dbUrl.hostname,
            port: parseInt(dbUrl.port || '5432'),
            database: dbName,
            user: dbUrl.username,
            password: dbUrl.password,
          })),
          autoDetected: true,
        },
      });
    }

    // Auto-create service connection for platform Redis
    if (dto.useLocalRedis && redisDbIndex !== undefined) {
      const redisUrl = new URL(envVarsObj.REDIS_URL);
      await this.prisma.serviceConnection.create({
        data: {
          projectId: project.id,
          type: 'REDIS',
          name: 'Platform Redis',
          config: this.encryption.encrypt(JSON.stringify({
            host: redisUrl.hostname,
            port: parseInt(redisUrl.port || '6379'),
            password: redisUrl.password || undefined,
            db: redisDbIndex,
          })),
          autoDetected: true,
        },
      });
    }

    // Auto-create service connection for platform MinIO
    if (dto.useLocalMinio && minioBucket) {
      await this.prisma.serviceConnection.create({
        data: {
          projectId: project.id,
          type: 'MINIO',
          name: 'Platform Storage',
          config: this.encryption.encrypt(JSON.stringify({
            endPoint: envVarsObj.MINIO_ENDPOINT,
            port: parseInt(envVarsObj.MINIO_PORT),
            accessKey: envVarsObj.MINIO_ACCESS_KEY,
            secretKey: envVarsObj.MINIO_SECRET_KEY,
            useSSL: envVarsObj.MINIO_USE_SSL === 'true',
            bucket: minioBucket,
          })),
          autoDetected: true,
        },
      });
    }

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

    // Handle repo connect/disconnect
    if ('repoUrl' in dto) {
      if (dto.repoUrl) {
        // Connect: switch to GITHUB
        data.sourceType = 'GITHUB';
        data.repoUrl = dto.repoUrl;
        data.branch = dto.branch || 'main';
      } else {
        // Disconnect: switch to UPLOAD
        data.sourceType = 'UPLOAD';
        data.repoUrl = null;
        data.branch = 'main';
        data.githubInstallationId = null;

        // Clean up webhook if exists
        try {
          await this.webhooksService.deleteConfig(id);
        } catch {
          // No webhook configured — that's fine
        }
      }
    }

    if (data.envVars) {
      // Sync .env file on server if project directory exists
      this.syncEnvFile(id, data.envVars);
      data.envVars = this.encryption.encrypt(JSON.stringify(data.envVars));
    }
    delete data.port;
    return this.prisma.project.update({ where: { id }, data });
  }

  private async syncEnvFile(projectId: string, envVars: Record<string, string>) {
    try {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return;
      const projectsDir = this.getProjectsDir();
      const repoDir = join(projectsDir, project.directory || project.slug);
      const projectDir = project.workDir ? join(repoDir, project.workDir) : repoDir;
      const envPath = join(projectDir, '.env');
      if (!existsSync(projectDir)) return;
      const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      writeFileSync(envPath, envContent);
    } catch {}
  }

  async provisionDatabase(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.useLocalDb && project.dbName) {
      throw new BadRequestException('Project already has a platform database');
    }

    const dbName = await this.dbProvisioner.generateDbName(project.slug);
    const db = await this.dbProvisioner.provision(dbName);

    // Merge DATABASE_URL into existing envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    envVarsObj.DATABASE_URL = db.databaseUrl;

    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalDb: true,
        dbName,
        envVars: this.encryption.encrypt(JSON.stringify(envVarsObj)),
      },
    });

    // Auto-create service connection
    const dbUrl = new URL(db.databaseUrl);
    await this.prisma.serviceConnection.create({
      data: {
        projectId: id,
        type: 'POSTGRESQL',
        name: 'Platform Database',
        config: this.encryption.encrypt(JSON.stringify({
          host: dbUrl.hostname,
          port: parseInt(dbUrl.port || '5432'),
          database: dbName,
          user: dbUrl.username,
          password: dbUrl.password,
        })),
        autoDetected: true,
      },
    });

    return { dbName, databaseUrl: db.databaseUrl };
  }

  async deprovisionDatabase(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalDb || !project.dbName) {
      throw new BadRequestException('Project has no platform database');
    }

    // Drop the database
    await this.dbProvisioner.dropDatabase(project.dbName);

    // Remove DATABASE_URL from envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    delete envVarsObj.DATABASE_URL;

    // Update project
    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalDb: false,
        dbName: null,
        envVars: Object.keys(envVarsObj).length > 0 ? this.encryption.encrypt(JSON.stringify(envVarsObj)) : '',
      },
    });

    // Remove platform database service connection
    await this.prisma.serviceConnection.deleteMany({
      where: { projectId: id, type: 'POSTGRESQL', autoDetected: true },
    });

    // Sync .env file
    if (Object.keys(envVarsObj).length > 0) {
      this.syncEnvFile(id, envVarsObj);
    }

    return { success: true };
  }

  async exportDatabase(id: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalDb || !project.dbName) {
      throw new BadRequestException('Project has no platform database');
    }
    return this.dbProvisioner.exportDatabase(project.dbName);
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

    // Regenerate ecosystem.config.js with latest ENV and PM2 config before restarting
    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsDir, project.directory || project.slug);
    const projectDir = project.workDir ? join(repoDir, project.workDir) : repoDir;

    const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId: id } });

    let script = pm2Config?.script || project.startCommand || 'dist/main.js';
    let isNpmStart = false;
    if (!pm2Config?.script && !project.startCommand) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
        if (pkg.scripts?.start) { script = 'npm'; isNpmStart = true; }
        else if (pkg.main) { script = pkg.main; }
      } catch {}
    }
    if (script === 'npm') isNpmStart = true;

    const pm2Stage = new Pm2Stage();
    const ecosystemContent = pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars,
        instances: pm2Config?.instances,
        execMode: pm2Config?.execMode,
        maxMemoryRestart: pm2Config?.maxMemoryRestart ?? undefined,
      },
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
