import { Detector, DetectedProject } from './detector.interface';
import {
  execShell,
  directoryId,
  readProjectEnv,
  extractConnectionUrls,
  getGitInfo,
  readPackageName,
} from '../utils';

const RUNTIME_PATTERNS: Array<{ pattern: RegExp; runtime: string }> = [
  { pattern: /\bnode\b/, runtime: 'node' },
  { pattern: /\bnpm\b/, runtime: 'node' },
  { pattern: /\bpython3?\b/, runtime: 'python' },
  { pattern: /\bjava\b/, runtime: 'java' },
  { pattern: /\bphp(-fpm)?\b/, runtime: 'php' },
  { pattern: /\bruby\b/, runtime: 'ruby' },
  { pattern: /\bgo\b/, runtime: 'go' },
  { pattern: /\bdotnet\b/, runtime: 'dotnet' },
];

export class ProcessDetector implements Detector {
  name = 'process';

  async detect(): Promise<DetectedProject[]> {
    const output = await execShell('ps aux');
    if (!output) return [];

    const projects: DetectedProject[] = [];
    const seenDirs = new Set<string>();
    const lines = output.split('\n').slice(1); // Skip header

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parts[1];
      const command = parts.slice(10).join(' ');

      // Match against known runtime patterns
      let runtime: string | undefined;
      for (const { pattern, runtime: rt } of RUNTIME_PATTERNS) {
        if (pattern.test(command)) {
          runtime = rt;
          break;
        }
      }
      if (!runtime) continue;

      // Skip short-lived / system commands
      if (
        command.includes('ps aux') ||
        command.includes('/usr/lib') ||
        command.includes('/usr/sbin') ||
        command.includes('ship-dock-migrate')
      ) {
        continue;
      }

      // Try to get CWD via /proc
      const cwd = await execShell(`readlink /proc/${pid}/cwd 2>/dev/null`);
      const dir = cwd?.trim();
      if (!dir || dir === '/' || seenDirs.has(dir)) continue;
      seenDirs.add(dir);

      const envVars = readProjectEnv(dir);
      const { databaseUrl, redisUrl } = extractConnectionUrls(envVars);
      const git = await getGitInfo(dir);
      const pkgName = readPackageName(dir);
      const port = envVars['PORT'] ? parseInt(envVars['PORT'], 10) || undefined : undefined;

      projects.push({
        id: directoryId(dir),
        name: pkgName || `${runtime}-${pid}`,
        directory: dir,
        detectedBy: 'process',
        runtime,
        port,
        startCommand: command,
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
}
