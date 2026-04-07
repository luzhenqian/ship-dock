import * as fs from 'fs';
import * as path from 'path';
import { Detector, DetectedProject } from './detector.interface';
import {
  directoryId,
  readProjectEnv,
  extractConnectionUrls,
  getGitInfo,
  readPackageName,
} from '../utils';

const SYSTEMD_DIR = '/etc/systemd/system';

export class SystemdDetector implements Detector {
  name = 'systemd';

  async detect(): Promise<DetectedProject[]> {
    let files: string[];
    try {
      files = fs.readdirSync(SYSTEMD_DIR).filter((f) => f.endsWith('.service'));
    } catch {
      return [];
    }

    const projects: DetectedProject[] = [];

    for (const file of files) {
      const filePath = path.join(SYSTEMD_DIR, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Skip system services — only look for custom ones
      if (
        content.includes('/usr/lib/systemd') ||
        content.includes('/lib/systemd')
      ) {
        continue;
      }

      const workingDir = this.extractValue(content, 'WorkingDirectory');
      if (!workingDir) continue;

      const execStart = this.extractValue(content, 'ExecStart');
      if (!execStart) continue;

      // Parse inline Environment= and EnvironmentFile=
      const envVars: Record<string, string> = {};
      const envLines = content.match(/^Environment=.+$/gm) || [];
      for (const line of envLines) {
        const val = line.replace('Environment=', '').trim();
        // Can be KEY=VAL or "KEY=VAL KEY2=VAL2"
        const stripped = val.replace(/^["']|["']$/g, '');
        for (const pair of stripped.split(/\s+/)) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            envVars[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
          }
        }
      }

      const envFiles = content.match(/^EnvironmentFile=.+$/gm) || [];
      for (const line of envFiles) {
        const envFilePath = line
          .replace('EnvironmentFile=', '')
          .trim()
          .replace(/^-/, ''); // Leading dash means optional
        try {
          const fileContent = fs.readFileSync(envFilePath, 'utf-8');
          for (const fline of fileContent.split('\n')) {
            const trimmed = fline.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              envVars[trimmed.slice(0, eqIdx).trim()] = trimmed
                .slice(eqIdx + 1)
                .trim()
                .replace(/^["']|["']$/g, '');
            }
          }
        } catch {
          // File not found
        }
      }

      // Also read .env from working dir
      Object.assign(envVars, readProjectEnv(workingDir));

      const { databaseUrl, redisUrl } = extractConnectionUrls(envVars);
      const git = await getGitInfo(workingDir);
      const pkgName = readPackageName(workingDir);
      const unitName = file.replace('.service', '');

      // Detect runtime from ExecStart
      let runtime: string | undefined;
      if (execStart.includes('node') || execStart.includes('npm') || execStart.includes('npx')) {
        runtime = 'node';
      } else if (execStart.includes('python') || execStart.includes('gunicorn') || execStart.includes('uvicorn')) {
        runtime = 'python';
      } else if (execStart.includes('java') || execStart.includes('jar')) {
        runtime = 'java';
      } else if (execStart.includes('php')) {
        runtime = 'php';
      }

      const port = envVars['PORT'] ? parseInt(envVars['PORT'], 10) || undefined : undefined;

      projects.push({
        id: directoryId(workingDir),
        name: pkgName || unitName,
        directory: workingDir,
        detectedBy: 'systemd',
        runtime,
        port,
        processManager: 'systemd',
        processManagerId: unitName,
        startCommand: execStart,
        envVars,
        databaseUrl,
        redisUrl,
        gitRemote: git.remote,
        gitCommit: git.commit,
        gitBranch: git.branch,
      });
    }

    return projects;
  }

  private extractValue(content: string, key: string): string | undefined {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : undefined;
  }
}
