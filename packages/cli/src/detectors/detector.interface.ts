export interface DetectedProject {
  /** Unique identifier derived from the working directory */
  id: string;
  /** Human-readable name (from package.json, docker container, systemd unit, etc.) */
  name: string;
  /** Absolute path to the project directory */
  directory: string;
  /** How the project was detected */
  detectedBy: string;
  /** Runtime (node, python, java, php, etc.) */
  runtime?: string;
  /** Runtime version if detectable */
  runtimeVersion?: string;
  /** Port the project listens on */
  port?: number;
  /** Process manager (pm2, docker, systemd, none) */
  processManager?: string;
  /** Process manager identifier (pm2 id, container id, unit name) */
  processManagerId?: string;
  /** Start command */
  startCommand?: string;
  /** Environment variables (from .env or process env) */
  envVars?: Record<string, string>;
  /** Database connection URL (extracted from env) */
  databaseUrl?: string;
  /** Redis connection URL (extracted from env) */
  redisUrl?: string;
  /** Git remote URL */
  gitRemote?: string;
  /** Current git commit hash */
  gitCommit?: string;
  /** Git branch name */
  gitBranch?: string;
  /** Nginx configuration if found */
  nginx?: NginxConfig;
  /** Cron entries associated with this project */
  cronEntries?: CronEntry[];
  /** Docker-specific metadata */
  docker?: DockerMeta;
}

export interface NginxConfig {
  serverName: string;
  proxyPass?: string;
  sslEnabled: boolean;
  configFile: string;
}

export interface CronEntry {
  schedule: string;
  command: string;
  raw: string;
}

export interface DockerMeta {
  containerId: string;
  image: string;
  ports: string[];
  volumes: string[];
  networks: string[];
}

export interface Detector {
  /** Name of this detector */
  name: string;
  /** Detect running projects */
  detect(): Promise<DetectedProject[]>;
}
