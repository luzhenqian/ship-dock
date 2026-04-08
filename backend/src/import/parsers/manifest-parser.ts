import { Injectable } from '@nestjs/common';

export interface ManifestProjectData {
  database?: string | null;
  redis?: string | null;
  storage?: string | null;
  code?: string | null;
}

export interface ManifestProject {
  name: string;
  type: string;
  directory: string;
  command: string;
  port?: number;
  env: Record<string, string>;
  nginx?: { serverNames: string[]; sslCert?: string; sslKey?: string } | null;
  cron?: { schedule: string; command: string }[];
  databases: { type: string; connectionUrl: string }[];
  redis: { connectionUrl: string }[];
  storage: { type: string; endpoint: string; bucket: string; credentials: any }[];
  data: ManifestProjectData;
  gitRemote?: string | null;
  gitCommit?: string | null;
}

export interface Manifest {
  version: number;
  createdAt: string;
  sourceServer: { hostname: string; ip: string };
  projects: ManifestProject[];
}

@Injectable()
export class ManifestParser {
  parse(raw: any): Manifest {
    if (!raw.version) throw new Error('Missing required field: version');
    if (!Array.isArray(raw.projects) || raw.projects.length === 0) throw new Error('No projects found');

    const projects: ManifestProject[] = raw.projects.map((p: any, i: number) => {
      if (!p.name) throw new Error(`Project at index ${i} missing name`);

      // Build databases array from CLI's databaseUrl string or existing array
      const databases = p.databases || [];
      if (databases.length === 0 && p.databaseUrl) {
        const dbType = p.databaseUrl.startsWith('mysql') ? 'mysql' : 'postgresql';
        databases.push({ type: dbType, connectionUrl: p.databaseUrl });
      }

      // Build redis array from CLI's redisUrl string or existing array
      const redis = p.redis || [];
      if (redis.length === 0 && p.redisUrl) {
        redis.push({ connectionUrl: p.redisUrl });
      }

      // Map env from CLI's envVars or existing env
      const env = p.env || p.envVars || {};

      // Map type from CLI's processManager/detectedBy or existing type
      const type = p.type && p.type !== 'unknown'
        ? p.type
        : p.processManager || p.detectedBy?.split(',')[0] || 'unknown';

      // Map cron from CLI's cronEntries or existing cron
      const cron = p.cron || p.cronEntries || [];

      // Map nginx from CLI format to standard format
      let nginx = p.nginx || null;
      if (nginx && nginx.serverName && !nginx.serverNames) {
        nginx = { serverNames: [nginx.serverName], sslCert: nginx.sslCert, sslKey: nginx.sslKey };
      }

      return {
        name: p.name,
        type,
        directory: p.directory || '',
        command: p.command || p.startCommand || '',
        port: p.port,
        env,
        nginx,
        cron,
        databases,
        redis,
        storage: p.storage || [],
        data: p.data || {},
        gitRemote: p.gitRemote || null,
        gitCommit: p.gitCommit || null,
      };
    });

    return {
      version: raw.version,
      createdAt: raw.createdAt || new Date().toISOString(),
      sourceServer: raw.sourceServer || { hostname: 'unknown', ip: 'unknown' },
      projects,
    };
  }
}
