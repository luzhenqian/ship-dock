import * as fs from 'fs';
import * as path from 'path';
import { Detector, DetectedProject, NginxConfig } from './detector.interface';
import { directoryId } from '../utils';

const NGINX_SITES_DIRS = [
  '/etc/nginx/sites-enabled',
  '/etc/nginx/conf.d',
];

/**
 * NginxDetector doesn't return full projects — it returns partial data
 * that gets merged into projects detected by other detectors (matched by port).
 * We still implement the Detector interface so it integrates with the scanner.
 */
export class NginxDetector implements Detector {
  name = 'nginx';

  async detect(): Promise<DetectedProject[]> {
    const configs = this.parseAllConfigs();
    // Return stub projects that will be merged by the scanner
    return configs.map((cfg) => ({
      id: directoryId(`nginx:${cfg.serverName}:${cfg.proxyPass || ''}`),
      name: cfg.serverName,
      directory: '',
      detectedBy: 'nginx',
      port: this.extractPort(cfg.proxyPass),
      nginx: cfg,
    }));
  }

  parseAllConfigs(): NginxConfig[] {
    const configs: NginxConfig[] = [];

    for (const dir of NGINX_SITES_DIRS) {
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = this.parseConfig(content, filePath);
          configs.push(...parsed);
        } catch {
          // Skip unreadable files
        }
      }
    }

    return configs;
  }

  private parseConfig(content: string, filePath: string): NginxConfig[] {
    const results: NginxConfig[] = [];

    // Match server blocks (simplified parser)
    const serverBlocks = this.extractServerBlocks(content);

    for (const block of serverBlocks) {
      const serverName = this.extractDirective(block, 'server_name');
      if (!serverName || serverName === '_') continue;

      const proxyPass = this.extractDirective(block, 'proxy_pass');
      const sslEnabled =
        block.includes('ssl_certificate') ||
        block.includes('listen 443') ||
        block.includes('listen [::]:443');

      results.push({
        serverName: serverName.replace(';', '').trim(),
        proxyPass: proxyPass?.replace(';', '').trim(),
        sslEnabled,
        configFile: filePath,
      });
    }

    return results;
  }

  private extractServerBlocks(content: string): string[] {
    const blocks: string[] = [];
    let depth = 0;
    let blockStart = -1;

    // Find "server {" and extract the block
    const lines = content.split('\n');
    let inServerBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('server') && line.includes('{')) {
        inServerBlock = true;
        blockStart = i;
        depth = 0;
      }

      if (inServerBlock) {
        for (const ch of line) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
        if (depth === 0 && blockStart >= 0) {
          blocks.push(lines.slice(blockStart, i + 1).join('\n'));
          inServerBlock = false;
          blockStart = -1;
        }
      }
    }

    return blocks;
  }

  private extractDirective(block: string, directive: string): string | undefined {
    const regex = new RegExp(`\\b${directive}\\s+([^;]+);`, 'm');
    const match = block.match(regex);
    return match ? match[1].trim() : undefined;
  }

  private extractPort(proxyPass?: string): number | undefined {
    if (!proxyPass) return undefined;
    const match = proxyPass.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }
}
