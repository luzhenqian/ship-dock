import { runShell } from './shell.js';

export type PackageManager = 'apt' | 'yum' | 'dnf';

export async function detectPackageManager(): Promise<PackageManager> {
  const apt = await runShell('command -v apt-get');
  if (apt.exitCode === 0) return 'apt';
  const dnf = await runShell('command -v dnf');
  if (dnf.exitCode === 0) return 'dnf';
  const yum = await runShell('command -v yum');
  if (yum.exitCode === 0) return 'yum';
  throw new Error('Unsupported OS: no apt, yum, or dnf found');
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

type Installer = (pm: PackageManager) => Promise<InstallResult>;

async function tryInstall(cmd: string): Promise<InstallResult> {
  const result = await runShell(cmd);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || result.stdout };
  }
  return { success: true };
}

const installPostgres: Installer = async (pm) => {
  if (pm === 'apt') {
    await runShell('sudo apt-get update -qq');
    await runShell('sudo apt-get install -y -qq gnupg2 lsb-release');
    await runShell('echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null');
    await runShell('curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg --yes');
    await runShell('sudo apt-get update -qq');
    const result = await tryInstall('sudo apt-get install -y -qq postgresql-16 postgresql-client-16 postgresql-16-pgvector');
    if (!result.success) return result;
    await runShell('sudo systemctl enable postgresql && sudo systemctl start postgresql');
    return { success: true };
  }
  // yum/dnf
  await runShell('sudo yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %{rhel})-x86_64/pgdg-redhat-repo-latest.noarch.rpm');
  const result = await tryInstall(`sudo ${pm} install -y postgresql16-server postgresql16 pgvector_16`);
  if (!result.success) return result;
  await runShell('sudo /usr/pgsql-16/bin/postgresql-16-setup initdb');
  await runShell('sudo systemctl enable postgresql-16 && sudo systemctl start postgresql-16');
  return { success: true };
};

const installRedis: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('sudo apt-get install -y -qq redis-server');
    if (!result.success) return result;
  } else {
    const result = await tryInstall(`sudo ${pm} install -y redis`);
    if (!result.success) return result;
  }
  await runShell('sudo systemctl enable redis-server && sudo systemctl start redis-server');
  return { success: true };
};

const installNginx: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('sudo apt-get install -y -qq nginx');
    if (!result.success) return result;
  } else {
    const result = await tryInstall(`sudo ${pm} install -y nginx`);
    if (!result.success) return result;
  }
  await runShell('sudo systemctl enable nginx && sudo systemctl start nginx');
  return { success: true };
};

const installMinio: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio && sudo mv /tmp/minio /usr/local/bin/minio && sudo chmod +x /usr/local/bin/minio');
    if (!result.success) return result;
  } else {
    const result = await tryInstall('wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio && sudo mv /tmp/minio /usr/local/bin/minio && sudo chmod +x /usr/local/bin/minio');
    if (!result.success) return result;
  }
  return { success: true };
};

const installPm2: Installer = async () => {
  return tryInstall('sudo npm install -g pm2');
};

export const installers: Record<string, Installer> = {
  'PostgreSQL 16': installPostgres,
  'Redis 7': installRedis,
  'Nginx': installNginx,
  'MinIO': installMinio,
  'PM2': installPm2,
};
