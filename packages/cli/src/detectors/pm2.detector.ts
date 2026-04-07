import { Detector, DetectedProject } from './detector.interface';
import {
  exec,
  directoryId,
  readProjectEnv,
  extractConnectionUrls,
  getGitInfo,
  readPackageName,
} from '../utils';

interface PM2Process {
  pm_id: number;
  name: string;
  pm2_env: {
    pm_cwd?: string;
    cwd?: string;
    exec_interpreter?: string;
    node_version?: string;
    pm_exec_path?: string;
    env?: Record<string, string>;
    PORT?: string | number;
    status?: string;
  };
}

export class PM2Detector implements Detector {
  name = 'pm2';

  async detect(): Promise<DetectedProject[]> {
    const output = await exec('pm2', ['jlist']);
    if (!output) return [];

    let processes: PM2Process[];
    try {
      processes = JSON.parse(output);
    } catch {
      return [];
    }

    const projects: DetectedProject[] = [];

    for (const proc of processes) {
      const env = proc.pm2_env;
      const dir = env.pm_cwd || env.cwd || '';
      if (!dir) continue;

      const projectEnv = {
        ...(env.env || {}),
        ...readProjectEnv(dir),
      };
      const { databaseUrl, redisUrl } = extractConnectionUrls(projectEnv);
      const git = await getGitInfo(dir);
      const pkgName = readPackageName(dir);

      const port =
        typeof env.PORT === 'number'
          ? env.PORT
          : typeof env.PORT === 'string'
            ? parseInt(env.PORT, 10) || undefined
            : projectEnv['PORT']
              ? parseInt(projectEnv['PORT'], 10) || undefined
              : undefined;

      projects.push({
        id: directoryId(dir),
        name: pkgName || proc.name || `pm2-${proc.pm_id}`,
        directory: dir,
        detectedBy: 'pm2',
        runtime: env.exec_interpreter || 'node',
        runtimeVersion: env.node_version,
        port,
        processManager: 'pm2',
        processManagerId: String(proc.pm_id),
        startCommand: env.pm_exec_path,
        envVars: projectEnv,
        databaseUrl,
        redisUrl,
        gitRemote: git.remote,
        gitCommit: git.commit,
        gitBranch: git.branch,
      });
    }

    return projects;
  }
}
