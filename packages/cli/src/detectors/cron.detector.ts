import { Detector, DetectedProject, CronEntry } from './detector.interface';
import { execShell, directoryId } from '../utils';

/**
 * CronDetector parses crontab entries.
 * It returns stub projects that get merged by the scanner (matched by directory).
 */
export class CronDetector implements Detector {
  name = 'cron';

  async detect(): Promise<DetectedProject[]> {
    const output = await execShell('crontab -l 2>/dev/null');
    if (!output) return [];

    const entries = this.parseCrontab(output);
    if (entries.length === 0) return [];

    // Group entries by the directory they reference
    const byDir = new Map<string, CronEntry[]>();

    for (const entry of entries) {
      const dir = this.extractDirectory(entry.command);
      const key = dir || '__global__';
      const list = byDir.get(key) || [];
      list.push(entry);
      byDir.set(key, list);
    }

    const projects: DetectedProject[] = [];

    for (const [dir, cronEntries] of byDir.entries()) {
      projects.push({
        id: directoryId(`cron:${dir}`),
        name: dir === '__global__' ? 'global-cron' : `cron-${dir.split('/').pop()}`,
        directory: dir === '__global__' ? '' : dir,
        detectedBy: 'cron',
        cronEntries,
      });
    }

    return projects;
  }

  private parseCrontab(output: string): CronEntry[] {
    const entries: CronEntry[] = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Cron format: min hour day month weekday command
      const match = trimmed.match(
        /^([\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+)\s+(.+)$/,
      );
      if (!match) {
        // Also handle @reboot, @daily, etc.
        const specialMatch = trimmed.match(/^(@\w+)\s+(.+)$/);
        if (specialMatch) {
          entries.push({
            schedule: specialMatch[1],
            command: specialMatch[2],
            raw: trimmed,
          });
        }
        continue;
      }

      entries.push({
        schedule: match[1],
        command: match[2],
        raw: trimmed,
      });
    }

    return entries;
  }

  private extractDirectory(command: string): string | undefined {
    // Look for "cd /some/path &&" pattern
    const cdMatch = command.match(/cd\s+(\/[^\s;&]+)/);
    if (cdMatch) return cdMatch[1];

    // Look for absolute paths to scripts
    const pathMatch = command.match(/(\/[^\s]+\/)[^\s/]+$/);
    if (pathMatch) return pathMatch[1].replace(/\/$/, '');

    return undefined;
  }
}
