import {
  DetectedProject,
  Detector,
  PM2Detector,
  DockerDetector,
  SystemdDetector,
  NginxDetector,
  ProcessDetector,
  CronDetector,
} from './detectors';

/**
 * Run all detectors in parallel, deduplicate by directory,
 * and enrich with nginx/cron data.
 */
export async function scanServer(): Promise<DetectedProject[]> {
  const detectors: Detector[] = [
    new PM2Detector(),
    new DockerDetector(),
    new SystemdDetector(),
    new NginxDetector(),
    new ProcessDetector(),
    new CronDetector(),
  ];

  // Run all detectors in parallel
  const results = await Promise.all(
    detectors.map(async (d) => {
      try {
        return await d.detect();
      } catch {
        return [];
      }
    }),
  );

  const allProjects = results.flat();

  // Separate nginx and cron stub projects from real projects
  const nginxProjects = allProjects.filter((p) => p.detectedBy === 'nginx');
  const cronProjects = allProjects.filter((p) => p.detectedBy === 'cron');
  const realProjects = allProjects.filter(
    (p) => p.detectedBy !== 'nginx' && p.detectedBy !== 'cron',
  );

  // Deduplicate by directory
  const byDir = new Map<string, DetectedProject>();
  for (const project of realProjects) {
    if (!project.directory) continue;
    const existing = byDir.get(project.directory);
    if (existing) {
      // Merge: prefer earlier detector's data but fill in gaps
      mergeProject(existing, project);
    } else {
      byDir.set(project.directory, project);
    }
  }

  const projects = Array.from(byDir.values());

  // Enrich with nginx data (match by port)
  for (const project of projects) {
    if (!project.port) continue;
    const matchingNginx = nginxProjects.find((n) => n.port === project.port);
    if (matchingNginx?.nginx) {
      project.nginx = matchingNginx.nginx;
    }
  }

  // Enrich with cron entries (match by directory)
  for (const project of projects) {
    if (!project.directory) continue;
    const matchingCron = cronProjects.find(
      (c) => c.directory && project.directory.startsWith(c.directory),
    );
    if (matchingCron?.cronEntries) {
      project.cronEntries = [
        ...(project.cronEntries || []),
        ...matchingCron.cronEntries,
      ];
    }
  }

  return projects;
}

function mergeProject(target: DetectedProject, source: DetectedProject): void {
  if (!target.runtime && source.runtime) target.runtime = source.runtime;
  if (!target.runtimeVersion && source.runtimeVersion)
    target.runtimeVersion = source.runtimeVersion;
  if (!target.port && source.port) target.port = source.port;
  if (!target.processManager && source.processManager)
    target.processManager = source.processManager;
  if (!target.processManagerId && source.processManagerId)
    target.processManagerId = source.processManagerId;
  if (!target.startCommand && source.startCommand)
    target.startCommand = source.startCommand;
  if (!target.databaseUrl && source.databaseUrl)
    target.databaseUrl = source.databaseUrl;
  if (!target.redisUrl && source.redisUrl) target.redisUrl = source.redisUrl;
  if (!target.gitRemote && source.gitRemote)
    target.gitRemote = source.gitRemote;
  if (!target.gitCommit && source.gitCommit)
    target.gitCommit = source.gitCommit;
  if (!target.gitBranch && source.gitBranch)
    target.gitBranch = source.gitBranch;
  if (!target.docker && source.docker) target.docker = source.docker;

  // Merge env vars
  if (source.envVars) {
    target.envVars = { ...source.envVars, ...(target.envVars || {}) };
  }

  // Track multiple detectors
  if (!target.detectedBy.includes(source.detectedBy)) {
    target.detectedBy += `,${source.detectedBy}`;
  }
}
