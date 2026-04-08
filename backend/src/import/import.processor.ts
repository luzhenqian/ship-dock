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
        await this.stageImportDb(importId, projectId!, config);
        return projectId;

      case 'PROVISION_REDIS':
        await this.stageProvisionRedis(importId, projectId!);
        return projectId;

      case 'IMPORT_REDIS':
        await this.stageImportRedis(importId, projectId!, config);
        return projectId;

      case 'PROVISION_STORAGE':
        await this.stageProvisionStorage(importId, projectId!);
        return projectId;

      case 'SYNC_STORAGE':
        await this.stageSyncStorage(importId, projectId!, config);
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

    // Clean slug: lowercase, replace non-alphanumeric with dash, strip leading/trailing dashes, collapse multiple dashes
    const slug = (config.slug || config.name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    // Get the import record to find userId
    const importRecord = await this.prisma.import.findUnique({ where: { id: importId } });

    // Map git remote to repoUrl (CLI detects gitRemote, Ship Dock expects repoUrl)
    const repoUrl = config.repoUrl || config.gitRemote || null;

    const project = await this.projectsService.create(importRecord!.userId, {
      name: config.name,
      slug,
      sourceType: repoUrl ? 'GITHUB' : 'UPLOAD',
      repoUrl,
      branch: config.branch || config.gitBranch || 'main',
      domain: config.domain,
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

  private async stageImportDb(importId: string, projectId: string, config: any): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project?.dbName) {
      this.log(importId, 'info', 'No database provisioned, skipping import');
      return;
    }

    // Find the database dump file in the extracted package
    const imp = await this.prisma.import.findUnique({ where: { id: importId } });
    if (!imp?.packageKey) {
      this.log(importId, 'info', 'No package file, skipping database import');
      return;
    }

    // Derive extract directory from packageKey
    // packageKey is like /tmp/imports/{uploadId}.tar.gz, extract dir is /tmp/imports/{uploadId}/
    const extractDir = imp.packageKey.replace('.tar.gz', '');
    const projectIndex = config.index ?? 0;
    const dumpPath = require('path').join(extractDir, `project-${projectIndex}`, 'database.sql.gz');

    const { existsSync } = require('fs');
    if (!existsSync(dumpPath)) {
      this.log(importId, 'info', 'No database dump found in package, skipping');
      return;
    }

    // Get the target database URL
    const envVarsStr = project.envVars
      ? this.encryption.decrypt(project.envVars)
      : '{}';
    const envVars = JSON.parse(envVarsStr);
    const databaseUrl = envVars.DATABASE_URL;

    if (!databaseUrl) {
      this.log(importId, 'info', 'No DATABASE_URL found, skipping import');
      return;
    }

    this.log(importId, 'info', `Restoring database from ${dumpPath}...`);

    const { execSync } = require('child_process');
    try {
      // gunzip and pipe to psql
      execSync(`gunzip -c "${dumpPath}" | psql "${databaseUrl}"`, {
        timeout: 600000, // 10 minutes
        stdio: 'pipe',
        maxBuffer: 50 * 1024 * 1024,
      });
      this.log(importId, 'info', 'Database imported successfully');
    } catch (err: any) {
      // psql may return warnings/notices that aren't fatal
      const stderr = err.stderr?.toString() || '';
      if (stderr.includes('ERROR')) {
        throw new Error(`Database import failed: ${stderr.slice(0, 500)}`);
      }
      this.log(importId, 'warn', `Database import completed with warnings`);
    }
  }

  private async stageImportRedis(importId: string, projectId: string, config: any): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project?.useLocalRedis || project.redisDbIndex === null) {
      this.log(importId, 'info', 'No Redis provisioned, skipping import');
      return;
    }

    // Find RDB dump in package
    const imp = await this.prisma.import.findUnique({ where: { id: importId } });
    if (!imp?.packageKey) {
      this.log(importId, 'info', 'No package file, skipping Redis import');
      return;
    }

    const extractDir = imp.packageKey.replace('.tar.gz', '');
    const projectIndex = config.index ?? 0;
    const rdbPath = require('path').join(extractDir, `project-${projectIndex}`, 'redis.rdb');

    const { existsSync } = require('fs');
    if (!existsSync(rdbPath)) {
      this.log(importId, 'info', 'No Redis dump found in package, skipping');
      return;
    }

    // Get target Redis connection info
    const envVarsStr = project.envVars ? this.encryption.decrypt(project.envVars) : '{}';
    const envVars = JSON.parse(envVarsStr);
    const redisUrl = envVars.REDIS_URL;

    if (!redisUrl) {
      this.log(importId, 'info', 'No REDIS_URL found, skipping import');
      return;
    }

    this.log(importId, 'info', `Importing Redis data from RDB dump...`);

    // Use redis-cli to load keys from the source Redis URL into target db
    // Since RDB is a full dump and we need to import into a specific db index,
    // we use a key-by-key approach: connect to source, dump keys, restore into target
    const { execSync } = require('child_process');
    const ConfigService = this.config;
    const host = ConfigService.get('REDIS_HOST', 'localhost');
    const port = ConfigService.get('REDIS_PORT', 6379);
    const password = ConfigService.get('REDIS_PASSWORD', '');
    const authArgs = password ? `-a '${password}' --no-auth-warning` : '';
    const dbIndex = project.redisDbIndex;

    try {
      // Use redis-cli with --rdb to load (only works if redis-cli supports it)
      // Fallback: copy source keys using DUMP/RESTORE via the source redisUrl
      // For now, if we have source redisUrl from the original server, do key-by-key sync
      const sourceRedisUrl = config.redisUrl;
      if (sourceRedisUrl) {
        // Source is the original server's Redis — but it's not accessible from Ship Dock server
        // So we skip remote sync and just log
        this.log(importId, 'info', 'Redis source is on remote server — RDB dump available but direct restore requires manual intervention');
        this.log(importId, 'info', `RDB file saved at: ${rdbPath}`);
      } else {
        this.log(importId, 'info', 'No source Redis URL, skipping key import');
      }
    } catch (err: any) {
      this.log(importId, 'warn', `Redis import note: ${err.message}`);
    }
  }

  private async stageSyncStorage(importId: string, projectId: string, config: any): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project?.useLocalMinio || !project.minioBucket) {
      this.log(importId, 'info', 'No storage provisioned, skipping sync');
      return;
    }

    // Find storage files in package
    const imp = await this.prisma.import.findUnique({ where: { id: importId } });
    if (!imp?.packageKey) {
      this.log(importId, 'info', 'No package file, skipping storage sync');
      return;
    }

    const extractDir = imp.packageKey.replace('.tar.gz', '');
    const projectIndex = config.index ?? 0;
    const storagePath = require('path').join(extractDir, `project-${projectIndex}`, 'storage');

    const { existsSync, readdirSync, readFileSync } = require('fs');
    const pathModule = require('path');

    if (!existsSync(storagePath)) {
      this.log(importId, 'info', 'No storage files found in package, skipping');
      return;
    }

    const files = readdirSync(storagePath, { recursive: true, withFileTypes: false }) as string[];
    if (files.length === 0) {
      this.log(importId, 'info', 'Storage directory is empty, skipping');
      return;
    }

    this.log(importId, 'info', `Syncing ${files.length} file(s) to MinIO bucket ${project.minioBucket}...`);

    // Upload each file to MinIO
    const Minio = require('minio');
    const minioClient = new Minio.Client({
      endPoint: this.config.getOrThrow('MINIO_ENDPOINT'),
      port: parseInt(this.config.get('MINIO_PORT', '9000')),
      useSSL: this.config.get('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.getOrThrow('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow('MINIO_SECRET_KEY'),
    });

    let uploaded = 0;
    for (const file of files) {
      const filePath = pathModule.join(storagePath, file);
      const stat = require('fs').statSync(filePath);
      if (stat.isDirectory()) continue;

      try {
        const fileBuffer = readFileSync(filePath);
        await minioClient.putObject(project.minioBucket, file, fileBuffer);
        uploaded++;
      } catch (err: any) {
        this.log(importId, 'warn', `Failed to upload ${file}: ${err.message}`);
      }
    }

    this.log(importId, 'info', `Synced ${uploaded} file(s) to MinIO`);
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
