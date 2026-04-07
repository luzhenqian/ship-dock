import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { TaskLine, TaskStatus } from '../components/task-line.js';
import { Credentials, saveCredentials } from '../lib/credentials.js';
import { writeAllConfigs, generateMinioSystemd } from '../lib/config.js';
import { runShell } from '../lib/shell.js';
import { homedir } from 'os';
import { writeFileSync } from 'fs';

const PROJECT_DIR = '/opt/shipdock';

interface Props {
  config: Credentials;
  onComplete: () => void;
}

interface InitTask {
  name: string;
  status: TaskStatus;
  detail?: string;
  run: () => Promise<void>;
}

export function InitializePhase({ config, onComplete }: Props) {
  const [tasks, setTasks] = useState<InitTask[]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const taskDefs: InitTask[] = [
      {
        name: 'Generate configuration files',
        status: 'pending',
        run: async () => {
          writeAllConfigs(config);
        },
      },
      {
        name: 'Install backend dependencies',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npm ci`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Generate Prisma client',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npx prisma generate`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      // Only create DB user/database if not using existing
      ...(!config.useExistingDb ? [{
        name: 'Set up PostgreSQL database',
        status: 'pending' as TaskStatus,
        run: async () => {
          await runShell(`sudo -u postgres psql -c "CREATE USER ${config.dbUser} WITH PASSWORD '${config.dbPassword}';" 2>/dev/null || true`);
          await runShell(`sudo -u postgres psql -c "CREATE DATABASE ${config.dbName} OWNER ${config.dbUser};" 2>/dev/null || true`);
          await runShell(`sudo -u postgres psql -d ${config.dbName} -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true`);
          // Enable password authentication in pg_hba.conf
          const pgHba = (await runShell("sudo find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1")).stdout;
          if (pgHba) {
            // Add scram-sha-256 auth for the user before the default peer/ident lines
            const check = await runShell(`sudo grep -q "^host.*${config.dbName}.*${config.dbUser}" ${pgHba}`);
            if (check.exitCode !== 0) {
              await runShell(`sudo sed -i '/^# IPv4 local connections/a host    ${config.dbName}    ${config.dbUser}    127.0.0.1/32    scram-sha-256' ${pgHba}`);
              await runShell(`sudo sed -i '/^# IPv6 local connections/a host    ${config.dbName}    ${config.dbUser}    ::1/128         scram-sha-256' ${pgHba}`);
              await runShell('sudo systemctl reload postgresql');
            }
          }
        },
      }] : []),
      {
        name: 'Run database migrations',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npx prisma migrate deploy`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      // Only configure Redis password if not using existing
      ...(!config.useExistingRedis && config.redisPassword ? [{
        name: 'Configure Redis password',
        status: 'pending' as TaskStatus,
        run: async () => {
          await runShell(`sudo sed -i 's/^# requirepass .*/requirepass ${config.redisPassword}/' /etc/redis/redis.conf`);
          await runShell(`sudo sed -i 's/^requirepass .*/requirepass ${config.redisPassword}/' /etc/redis/redis.conf`);
          await runShell('sudo systemctl restart redis-server');
        },
      }] : []),
      {
        name: 'Build backend',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npm run build`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Configure Nginx',
        status: 'pending',
        run: async () => {
          await runShell(`sudo cp ${PROJECT_DIR}/nginx/ship-dock.conf /etc/nginx/sites-available/ship-dock.conf`);
          await runShell('sudo ln -sf /etc/nginx/sites-available/ship-dock.conf /etc/nginx/sites-enabled/ship-dock.conf');
          await runShell('sudo rm -f /etc/nginx/sites-enabled/default');
          const test = await runShell('sudo nginx -t');
          if (test.exitCode !== 0) throw new Error('Nginx config test failed');
          await runShell('sudo systemctl reload nginx');
        },
      },
      // Only set up MinIO if not using existing
      ...(!config.useExistingMinio ? [{
        name: 'Set up MinIO',
        status: 'pending' as TaskStatus,
        run: async () => {
          await runShell('id -u minio-user &>/dev/null || sudo useradd -r -s /sbin/nologin minio-user');
          await runShell('sudo mkdir -p /data/minio && sudo chown minio-user:minio-user /data/minio');
          const unit = generateMinioSystemd(config);
          writeFileSync('/tmp/minio.service', unit);
          await runShell('sudo mv /tmp/minio.service /etc/systemd/system/minio.service');
          await runShell('sudo systemctl daemon-reload && sudo systemctl enable minio && sudo systemctl start minio');
        },
      }] : []),
      ...(config.ssl ? [{
        name: 'Set up SSL certificate',
        status: 'pending' as TaskStatus,
        run: async () => {
          await runShell('sudo apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null || sudo yum install -y certbot python3-certbot-nginx 2>/dev/null');
          const result = await runShell(`sudo certbot certonly --nginx --non-interactive --agree-tos --register-unsafely-without-email -d ${config.domain}`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
          await runShell('sudo systemctl reload nginx');
        },
      }] : []),
      {
        name: 'Start services via PM2',
        status: 'pending',
        run: async () => {
          const check = await runShell('pm2 describe ship-dock-api 2>/dev/null');
          if (check.exitCode === 0) {
            await runShell(`cd ${PROJECT_DIR}/backend && pm2 reload ship-dock-api`);
          } else {
            await runShell(`cd ${PROJECT_DIR}/backend && pm2 start dist/main.js --name ship-dock-api -i 1 --env production`);
          }
          await runShell('pm2 save');
          await runShell(`sudo env PATH="$PATH" pm2 startup systemd -u $(whoami) --hp $HOME 2>/dev/null || true`);
        },
      },
      {
        name: 'Create admin account',
        status: 'pending',
        run: async () => {
          let ready = false;
          for (let i = 0; i < 15; i++) {
            const health = await runShell(`curl -sf http://localhost:${config.port}/api/health`);
            if (health.exitCode === 0) { ready = true; break; }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!ready) throw new Error('API failed to start — check pm2 logs ship-dock-api');

          const result = await runShell(`curl -sf -X POST http://localhost:${config.port}/api/auth/setup -H "Content-Type: application/json" -d '${JSON.stringify({ email: config.adminEmail, password: config.adminPassword, name: 'Admin' })}'`);
          if (result.exitCode !== 0) throw new Error('Failed to create admin account');
        },
      },
      {
        name: 'Save credentials file',
        status: 'pending',
        run: async () => {
          saveCredentials(config, `${homedir()}/.shipdock/credentials`);
        },
      },
    ];
    setTasks(taskDefs);
  }, []);

  // Run tasks sequentially
  useEffect(() => {
    if (tasks.length === 0 || started) return;
    setStarted(true);

    (async () => {
      for (let i = 0; i < tasks.length; i++) {
        setTasks((prev) =>
          prev.map((t, j) => (j === i ? { ...t, status: 'running' } : t))
        );

        try {
          await tasks[i].run();
          setTasks((prev) =>
            prev.map((t, j) => (j === i ? { ...t, status: 'done' } : t))
          );
        } catch (err: any) {
          setTasks((prev) =>
            prev.map((t, j) =>
              j === i ? { ...t, status: 'failed', detail: err.message?.slice(0, 100) } : t
            )
          );
          const critical = ['PostgreSQL', 'migrations', 'backend dependencies', 'Build backend'];
          if (critical.some((c) => tasks[i].name.toLowerCase().includes(c.toLowerCase()))) {
            return;
          }
        }
      }
      onComplete();
    })();
  }, [tasks]);

  return (
    <Box flexDirection="column">
      <Text bold>Initializing services:</Text>
      {tasks.map((t) => (
        <TaskLine key={t.name} label={t.name} status={t.status} detail={t.detail} />
      ))}
    </Box>
  );
}
