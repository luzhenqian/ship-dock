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
      return {
        name: p.name,
        type: p.type || 'unknown',
        directory: p.directory || '',
        command: p.command || '',
        port: p.port,
        env: p.env || {},
        nginx: p.nginx || null,
        cron: p.cron || [],
        databases: p.databases || [],
        redis: p.redis || [],
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
