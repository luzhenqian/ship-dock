import { Detector, DetectedProject, DockerMeta } from './detector.interface';
import {
  exec,
  execShell,
  directoryId,
  readProjectEnv,
  extractConnectionUrls,
  getGitInfo,
} from '../utils';

interface DockerContainer {
  ID: string;
  Names: string;
  Image: string;
  Ports: string;
  Labels: string;
}

interface DockerInspect {
  Id: string;
  Name: string;
  Config: {
    Env?: string[];
    WorkingDir?: string;
    Labels?: Record<string, string>;
    Cmd?: string[];
    Image?: string;
  };
  Mounts?: Array<{
    Source: string;
    Destination: string;
    Type: string;
  }>;
  NetworkSettings?: {
    Networks?: Record<
      string,
      {
        NetworkID: string;
      }
    >;
    Ports?: Record<
      string,
      Array<{ HostPort: string }> | null
    >;
  };
  HostConfig?: {
    Binds?: string[];
  };
}

export class DockerDetector implements Detector {
  name = 'docker';

  async detect(): Promise<DetectedProject[]> {
    const output = await exec('docker', [
      'ps',
      '--format',
      '{{json .}}',
    ]);
    if (!output) return [];

    const containers: DockerContainer[] = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as DockerContainer[];

    const projects: DetectedProject[] = [];

    for (const container of containers) {
      const inspectOutput = await exec('docker', [
        'inspect',
        container.ID,
      ]);
      if (!inspectOutput) continue;

      let inspectData: DockerInspect[];
      try {
        inspectData = JSON.parse(inspectOutput);
      } catch {
        continue;
      }

      const info = inspectData[0];
      if (!info) continue;

      // Parse env vars from container
      const envVars: Record<string, string> = {};
      for (const envStr of info.Config?.Env || []) {
        const eqIdx = envStr.indexOf('=');
        if (eqIdx > 0) {
          envVars[envStr.slice(0, eqIdx)] = envStr.slice(eqIdx + 1);
        }
      }

      // Find working directory — prefer bind mounts, fallback to container workdir
      const bindMounts = (info.Mounts || [])
        .filter((m) => m.Type === 'bind')
        .map((m) => m.Source);
      const dir = bindMounts[0] || info.Config?.WorkingDir || `/docker/${container.ID}`;

      // Try reading .env from the host bind mount
      if (bindMounts[0]) {
        const fileEnv = readProjectEnv(bindMounts[0]);
        Object.assign(envVars, fileEnv);
      }

      const { databaseUrl, redisUrl } = extractConnectionUrls(envVars);

      // Extract ports
      const ports: string[] = [];
      let port: number | undefined;
      if (info.NetworkSettings?.Ports) {
        for (const [containerPort, bindings] of Object.entries(
          info.NetworkSettings.Ports,
        )) {
          if (bindings) {
            for (const b of bindings) {
              ports.push(`${b.HostPort}->${containerPort}`);
              if (!port) {
                port = parseInt(b.HostPort, 10) || undefined;
              }
            }
          }
        }
      }

      const networks = Object.keys(info.NetworkSettings?.Networks || {});
      const volumes = (info.Mounts || []).map(
        (m) => `${m.Source}:${m.Destination}`,
      );

      const git = bindMounts[0] ? await getGitInfo(bindMounts[0]) : {};

      const name =
        info.Config?.Labels?.['com.docker.compose.service'] ||
        info.Name?.replace(/^\//, '') ||
        container.Names;

      projects.push({
        id: directoryId(dir),
        name,
        directory: dir,
        detectedBy: 'docker',
        port,
        processManager: 'docker',
        processManagerId: container.ID,
        startCommand: info.Config?.Cmd?.join(' '),
        envVars,
        databaseUrl,
        redisUrl,
        gitRemote: git.remote,
        gitCommit: git.commit,
        gitBranch: git.branch,
        docker: {
          containerId: container.ID,
          image: container.Image,
          ports,
          volumes,
          networks,
        },
      });
    }

    return projects;
  }
}
