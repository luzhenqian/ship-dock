import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { DatabaseProvisionerService } from '../common/database-provisioner.service';
import { RedisProvisionerService } from '../common/redis-provisioner.service';
import { MinioProvisionerService } from '../common/minio-provisioner.service';
import { ProjectsService } from '../projects/projects.service';
import { DeployService } from '../deploy/deploy.service';
import { ImportGateway } from './import.gateway';
import { EnvMapper, LocalServices } from './utils/env-mapper';

const STAGES = [
  'CREATE_PROJECT',
  'PROVISION_DB',
  'IMPORT_DB',
  'PROVISION_REDIS',
  'IMPORT_REDIS',
  'PROVISION_STORAGE',
  'SYNC_STORAGE',
  'SET_ENV',
  'SETUP_CRON',
  'DEPLOY',
  'SWITCH_DNS',
] as const;

type StageName = (typeof STAGES)[number];

interface StageRecord {
  name: StageName;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED';
  error?: string;
}

@Processor('import')
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    @Inject(forwardRef(() => ProjectsService)) private projectsService: ProjectsService,
    @Inject(forwardRef(() => DeployService)) private deployService: DeployService,
    private gateway: ImportGateway,
  ) {
    super();
  }

  async process(job: Job<{ importId: string }>): Promise<void> {
    const { importId } = job.data;

    const importRecord = await this.prisma.import.findUnique({
      where: { id: importId },
      include: { items: true },
    });

    if (!importRecord || importRecord.status === 'CANCELLED') return;

    let hasFailures = false;

    for (const item of importRecord.items) {
      if (item.status === 'SKIPPED' || item.status === 'COMPLETED') continue;

      // Check if cancelled
      const current = await this.prisma.import.findUnique({ where: { id: importId } });
      if (current?.status === 'CANCELLED') {
        this.log(importId, 'info', 'Import cancelled by user');
        return;
      }

      try {
        await this.processItem(importId, item);
        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'COMPLETED' },
        });
      } catch (err: any) {
        hasFailures = true;
        this.logger.error(`Import item ${item.id} failed: ${err.message}`);
        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'FAILED', errorMessage: err.message },
        });
        this.log(importId, 'error', `Failed to import "${item.sourceName}": ${err.message}`);
        // Continue with next item
      }
    }

    const finalStatus = hasFailures ? 'FAILED' : 'COMPLETED';
    await this.prisma.import.update({
      where: { id: importId },
      data: { status: finalStatus },
    });
    this.gateway.emitStatus(importId, { status: finalStatus });
    this.log(importId, 'info', `Import ${finalStatus.toLowerCase()}`);
  }

  private async processItem(importId: string, item: any): Promise<void> {
    const config = (item.config as any) || {};
    const stages = this.buildStages(config);

    await this.prisma.importItem.update({
      where: { id: item.id },
      data: { status: 'RUNNING', stages: stages as any },
    });

    this.log(importId, 'info', `Processing "${item.sourceName}"...`);

    let projectId: string | null = null;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      if (stage.status === 'SKIPPED') continue;

      stage.status = 'RUNNING';
      await this.updateItemStages(item.id, stages);
      this.gateway.emitProgress(importId, {
        itemId: item.id,
        stage: stage.name,
        stageIndex: i,
        totalStages: stages.length,
      });

      try {
        projectId = await this.executeStage(
          importId,
          item,
          stage.name,
          config,
          projectId,
        );
        stage.status = 'COMPLETED';
      } catch (err: any) {
        stage.status = 'FAILED';
        stage.error = err.message;
        await this.updateItemStages(item.id, stages);
        throw err;
      }

      await this.updateItemStages(item.id, stages);
    }
  }

  private buildStages(config: any): StageRecord[] {
    const hasDatabase = config.databases?.length > 0 && !config.skipDatabase;
    const hasRedis = config.redis?.length > 0 && !config.skipRedis;
    const hasStorage = config.storage?.length > 0 && !config.skipStorage;
    const hasCron = config.cronJobs?.length > 0 || config.cron?.length > 0;
    const hasDomain = !!config.domain;

    return STAGES.map((name) => {
      let status: StageRecord['status'] = 'PENDING';

      switch (name) {
        case 'PROVISION_DB':
        case 'IMPORT_DB':
          if (!hasDatabase) status = 'SKIPPED';
          break;
        case 'PROVISION_REDIS':
        case 'IMPORT_REDIS':
          if (!hasRedis) status = 'SKIPPED';
          break;
        case 'PROVISION_STORAGE':
        case 'SYNC_STORAGE':
          if (!hasStorage) status = 'SKIPPED';
          break;
        case 'SETUP_CRON':
          if (!hasCron) status = 'SKIPPED';
          break;
        case 'DEPLOY':
          // Skip deploy during import — no source code configured yet.
          // Users can deploy manually after configuring git repo in Ship Dock.
          status = 'SKIPPED';
          break;
        case 'SWITCH_DNS':
          if (!hasDomain) status = 'SKIPPED';
          break;
      }

      return { name, status };
    });
  }

  private async executeStage(
    importId: string,
    item: any,
    stageName: StageName,
    config: any,
    projectId: string | null,
  ): Promise<string | null> {
    switch (stageName) {
      case 'CREATE_PROJECT':
        return this.stageCreateProject(importId, item, config);

      case 'PROVISION_DB':
        await this.stageProvisionDb(importId, projectId!);
        return projectId;

      case 'IMPORT_DB':
        this.log(importId, 'info', 'Database import -- will be implemented with DataMigrationService integration');
        return projectId;

      case 'PROVISION_REDIS':
        await this.stageProvisionRedis(importId, projectId!);
        return projectId;

      case 'IMPORT_REDIS':
        this.log(importId, 'info', 'Redis import -- placeholder for future implementation');
        return projectId;

      case 'PROVISION_STORAGE':
        await this.stageProvisionStorage(importId, projectId!);
        return projectId;

      case 'SYNC_STORAGE':
        this.log(importId, 'info', 'Storage sync -- placeholder for future implementation');
        return projectId;

      case 'SET_ENV':
        await this.stageSetEnv(importId, item, config, projectId!);
        return projectId;

      case 'SETUP_CRON':
        this.log(importId, 'info', `Cron jobs configured: ${JSON.stringify(config.cronJobs || config.cron || [])}`);
        return projectId;

      case 'DEPLOY':
        await this.stageDeploy(importId, item, projectId!);
        return projectId;

      case 'SWITCH_DNS':
        this.log(importId, 'info', `DNS switch pending: manual action required for domain "${config.domain}"`);
        return projectId;

      default:
        return projectId;
    }
  }

  private async stageCreateProject(
    importId: string,
    item: any,
    config: any,
  ): Promise<string> {
    const hasDatabase = config.databases?.length > 0 && !config.skipDatabase;
    const hasRedis = config.redis?.length > 0 && !config.skipRedis;
    const hasStorage = config.storage?.length > 0 && !config.skipStorage;

    const slug = config.slug || config.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Get the import record to find userId
    const importRecord = await this.prisma.import.findUnique({ where: { id: importId } });

    // Only pass port if within Ship Dock's valid range, otherwise let auto-assign
    const port = config.port && config.port >= 3001 && config.port <= 3999 ? config.port : undefined;

    const project = await this.projectsService.create(importRecord!.userId, {
      name: config.name,
      slug,
      sourceType: config.repoUrl ? 'GITHUB' : 'UPLOAD',
      repoUrl: config.repoUrl,
      branch: config.branch || 'main',
      domain: config.domain,
      port,
      useLocalDb: hasDatabase,
      useLocalRedis: hasRedis,
      useLocalMinio: hasStorage,
      pipeline: config.pipeline,
    });

    await this.prisma.importItem.update({
      where: { id: item.id },
      data: { projectId: project.id },
    });

    this.log(importId, 'info', `Created project "${config.name}" (${project.id})`);
    return project.id;
  }

  private async stageProvisionDb(importId: string, projectId: string): Promise<void> {
    // Check if DB was already provisioned during create (useLocalDb: true)
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project?.useLocalDb && project.dbName) {
      this.log(importId, 'info', `Database already provisioned: ${project.dbName}`);
      return;
    }
    await this.projectsService.provisionDatabase(projectId);
    this.log(importId, 'info', 'Database provisioned');
  }

  private async stageProvisionRedis(importId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project?.useLocalRedis && project.redisDbIndex !== null) {
      this.log(importId, 'info', `Redis already provisioned: db ${project.redisDbIndex}`);
      return;
    }
    await this.projectsService.provisionRedis(projectId);
    this.log(importId, 'info', 'Redis provisioned');
  }

  private async stageProvisionStorage(importId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project?.useLocalMinio && project.minioBucket) {
      this.log(importId, 'info', `Storage already provisioned: ${project.minioBucket}`);
      return;
    }
    await this.projectsService.provisionMinio(projectId);
    this.log(importId, 'info', 'Storage provisioned');
  }

  private async stageSetEnv(
    importId: string,
    item: any,
    config: any,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('Project not found');

    // Get the project's current env vars (auto-provisioned ones)
    let currentEnvVars: Record<string, string> = {};
    if (project.envVars) {
      try {
        currentEnvVars = JSON.parse(this.encryption.decrypt(project.envVars));
      } catch {}
    }

    // Build local services info from auto-provisioned vars
    const localServices: LocalServices = {
      databaseUrl: currentEnvVars.DATABASE_URL,
      redisUrl: currentEnvVars.REDIS_URL,
      minioEndpoint: currentEnvVars.MINIO_ENDPOINT,
      minioPort: currentEnvVars.MINIO_PORT,
      minioAccessKey: currentEnvVars.MINIO_ACCESS_KEY,
      minioSecretKey: currentEnvVars.MINIO_SECRET_KEY,
      minioBucket: currentEnvVars.MINIO_BUCKET,
    };

    // Get the original env vars from the manifest config
    const originalEnv: Record<string, string> = config.envVars || config.env || {};

    // Use EnvMapper to map original env vars to local services
    const mapped = EnvMapper.map(originalEnv, localServices);

    // Build final env vars: start with current (auto-provisioned), overlay mapped values
    const finalEnvVars: Record<string, string> = { ...currentEnvVars };
    for (const mapping of mapped) {
      finalEnvVars[mapping.key] = mapping.suggestedValue;
    }

    // Encrypt and update project
    const encryptedEnvVars = this.encryption.encrypt(JSON.stringify(finalEnvVars));
    await this.prisma.project.update({
      where: { id: projectId },
      data: { envVars: encryptedEnvVars },
    });

    const autoDetected = mapped.filter((m) => m.autoDetected).length;
    this.log(
      importId,
      'info',
      `Environment variables set: ${mapped.length} total, ${autoDetected} auto-mapped`,
    );
  }

  private async stageDeploy(
    importId: string,
    item: any,
    projectId: string,
  ): Promise<void> {
    const config = (item.config as any) || {};
    const importRecord = await this.prisma.import.findUnique({ where: { id: importId } });

    const deployment = await this.deployService.trigger(
      projectId,
      importRecord!.userId,
      undefined,
      config.gitCommit ? { hash: config.gitCommit, message: null } : undefined,
    );

    this.log(importId, 'info', `Deployment triggered (v${deployment.version})`);

    // Poll for deployment completion
    const maxWait = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const dep = await this.prisma.deployment.findUnique({
        where: { id: deployment.id },
      });

      if (!dep) throw new Error('Deployment not found');

      if (dep.status === 'SUCCESS') {
        this.log(importId, 'info', `Deployment v${deployment.version} succeeded`);
        return;
      }

      if (dep.status === 'FAILED') {
        throw new Error(`Deployment v${deployment.version} failed`);
      }

      if (dep.status === 'CANCELLED') {
        throw new Error(`Deployment v${deployment.version} was cancelled`);
      }

      // Check if import was cancelled
      const currentImport = await this.prisma.import.findUnique({ where: { id: importId } });
      if (currentImport?.status === 'CANCELLED') {
        this.log(importId, 'info', 'Import cancelled during deployment');
        throw new Error('Import cancelled');
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`Deployment timed out after ${maxWait / 1000}s`);
  }

  private async updateItemStages(itemId: string, stages: StageRecord[]): Promise<void> {
    await this.prisma.importItem.update({
      where: { id: itemId },
      data: { stages: stages as any },
    });
  }

  private log(importId: string, level: string, message: string) {
    this.gateway.emitLog(importId, {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
    if (level === 'error') {
      this.logger.error(`[${importId}] ${message}`);
    } else {
      this.logger.log(`[${importId}] ${message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
