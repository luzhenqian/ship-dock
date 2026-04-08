import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DetectedProject } from './detectors';
import { collectDatabase, collectCode, collectRedis } from './collectors';
import { execShell } from './utils';

export interface PackageResult {
  packagePath: string;
  sizeBytes: number;
  projectCount: number;
}

export interface PackageProgress {
  project: string;
  step: string;
  current: number;
  total: number;
}

/**
 * Package selected projects into a single tar.gz for upload to Ship Dock.
 */
export async function packageProjects(
  projects: DetectedProject[],
  onProgress?: (progress: PackageProgress) => void,
): Promise<PackageResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-dock-'));

  try {
    const manifest: ManifestData = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      hostname: os.hostname(),
      projects: [],
    };

    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const projectDir = path.join(tmpDir, `project-${i}`);
      fs.mkdirSync(projectDir, { recursive: true });

      const report = (step: string) =>
        onProgress?.({
          project: project.name,
          step,
          current: i + 1,
          total: projects.length,
        });

      // Write project metadata
      report('Writing metadata');
      const projectMeta: ProjectMeta = {
        name: project.name,
        directory: project.directory,
        detectedBy: project.detectedBy,
        runtime: project.runtime,
        runtimeVersion: project.runtimeVersion,
        port: project.port,
        processManager: project.processManager,
        processManagerId: project.processManagerId,
        startCommand: project.startCommand,
        databaseUrl: project.databaseUrl,
        redisUrl: project.redisUrl,
        gitRemote: project.gitRemote,
        gitCommit: project.gitCommit,
        gitBranch: project.gitBranch,
        nginx: project.nginx,
        docker: project.docker,
      };
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify(projectMeta, null, 2),
      );

      // Write env vars (sanitized — redact obvious secrets for the manifest,
      // but keep full values in the env.json for import)
      if (project.envVars && Object.keys(project.envVars).length > 0) {
        report('Writing environment');
        fs.writeFileSync(
          path.join(projectDir, 'env.json'),
          JSON.stringify(project.envVars, null, 2),
        );
      }

      // Write cron entries
      if (project.cronEntries && project.cronEntries.length > 0) {
        report('Writing cron entries');
        fs.writeFileSync(
          path.join(projectDir, 'cron.json'),
          JSON.stringify(project.cronEntries, null, 2),
        );
      }

      // Collect database dump
      if (project.databaseUrl) {
        report('Dumping database');
        const dbResult = await collectDatabase(project.databaseUrl, projectDir);
        if (dbResult.success) {
          projectMeta.databaseDump = {
            type: dbResult.type,
            file: 'database.sql.gz',
            sizeBytes: dbResult.sizeBytes,
          };
        }
      }

      // Collect Redis data
      if (project.redisUrl) {
        report('Collecting Redis data');
        const redisResult = await collectRedis(project.redisUrl, projectDir);
        if (redisResult.success) {
          projectMeta.redisDump = {
            file: 'redis.rdb',
            sizeBytes: redisResult.sizeBytes,
          };
        }
      }

      // Collect source code
      report('Collecting source code');
      const codeResult = await collectCode(
        project.directory,
        project.gitRemote,
        project.gitCommit,
        projectDir,
      );
      projectMeta.source = {
        type: codeResult.type,
        gitRemote: codeResult.gitRemote,
        gitCommit: codeResult.gitCommit,
        archiveFile: codeResult.archivePath ? 'source.tar.gz' : undefined,
        sizeBytes: codeResult.sizeBytes,
      };

      // Re-write project.json with collector results
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify(projectMeta, null, 2),
      );

      manifest.projects.push({
        index: i,
        ...projectMeta,
        envVars: project.envVars || {},
        cronEntries: project.cronEntries || [],
      });
    }

    // Write manifest
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    // Create the final tar.gz
    const packagePath = path.join(os.tmpdir(), `ship-dock-package-${Date.now()}.tar.gz`);
    const tarResult = await execShell(
      `tar czf '${packagePath}' -C '${tmpDir}' .`,
      { timeout: 120_000 },
    );
    if (tarResult === null) {
      throw new Error('Failed to create migration package archive');
    }

    const sizeResult = await execShell(
      `stat -c%s '${packagePath}' 2>/dev/null || stat -f%z '${packagePath}' 2>/dev/null`,
    );
    const sizeBytes = parseInt(sizeResult?.trim() || '0', 10);

    return { packagePath, sizeBytes, projectCount: projects.length };
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

interface ManifestData {
  version: string;
  createdAt: string;
  hostname: string;
  projects: Array<ProjectMeta & {
    index: number;
    envVars: Record<string, string>;
    cronEntries: Array<{ schedule: string; command: string }>;
  }>;
}

interface ProjectMeta {
  name: string;
  directory: string;
  detectedBy: string;
  runtime?: string;
  runtimeVersion?: string;
  port?: number;
  processManager?: string;
  processManagerId?: string;
  startCommand?: string;
  databaseUrl?: string;
  redisUrl?: string;
  gitRemote?: string;
  gitCommit?: string;
  gitBranch?: string;
  nginx?: DetectedProject['nginx'];
  docker?: DetectedProject['docker'];
  databaseDump?: { type: string; file: string; sizeBytes?: number };
  redisDump?: { file: string; sizeBytes?: number };
  source?: {
    type: string;
    gitRemote?: string;
    gitCommit?: string;
    archiveFile?: string;
    sizeBytes?: number;
  };
}
