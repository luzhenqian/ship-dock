import { writeFileSync, mkdirSync } from 'fs';
import { Credentials } from './credentials.js';

const PROJECT_DIR = '/opt/shipdock';

export function generateBackendEnv(creds: Credentials): void {
  const dbUrl = `postgresql://${creds.dbUser}:${creds.dbPassword}@${creds.dbHost}:${creds.dbPort}/${creds.dbName}`;
  const proto = creds.ssl ? 'https' : 'http';
  const frontendUrl = creds.domain ? `${proto}://${creds.domain}` : 'http://localhost:3000';

  const lines = [
    `DATABASE_URL="${dbUrl}"`,
    `REDIS_HOST=${creds.redisHost}`,
    `REDIS_PORT=${creds.redisPort}`,
    creds.redisPassword ? `REDIS_PASSWORD=${creds.redisPassword}` : '',
    `JWT_SECRET=${creds.jwtSecret}`,
    `JWT_REFRESH_SECRET=${creds.jwtRefreshSecret}`,
    `ENCRYPTION_KEY=${creds.encryptionKey}`,
    `PORT=${creds.port}`,
    `PROJECTS_DIR=/var/www`,
    `NODE_ENV=production`,
    '',
    `MINIO_ENDPOINT=${creds.minioEndpoint}`,
    `MINIO_PORT=${creds.minioPort}`,
    `MINIO_ACCESS_KEY=${creds.minioAccessKey}`,
    `MINIO_SECRET_KEY=${creds.minioSecretKey}`,
    `MINIO_USE_SSL=false`,
    '',
    `FRONTEND_URL=${frontendUrl}`,
  ].filter(Boolean);

  writeFileSync(`${PROJECT_DIR}/backend/.env`, lines.join('\n') + '\n');
}

export function generateFrontendEnv(creds: Credentials): void {
  const proto = creds.ssl ? 'https' : 'http';
  // Use relative /api path so it works with any IP/domain via Nginx
  const apiUrl = creds.domain
    ? `${proto}://${creds.domain}/api`
    : '/api';

  const lines = [
    `NEXT_PUBLIC_API_URL=${apiUrl}`,
  ];

  writeFileSync(`${PROJECT_DIR}/frontend/.env`, lines.join('\n') + '\n');
}

function locationBlocks(): string {
  return `    client_max_body_size 2048M;

    # API proxy
    location /api/ {
        proxy_pass http://ship_dock_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Uploads static files
    location /uploads/ {
        alias ${PROJECT_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Frontend proxy (everything else)
    location / {
        proxy_pass http://ship_dock_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }`;
}

export function generateNginxConfig(creds: Credentials): string {
  const serverName = creds.domain || '_';
  const lines: string[] = [
    `upstream ship_dock_api {`,
    `    server 127.0.0.1:${creds.port};`,
    `}`,
    ``,
    `upstream ship_dock_frontend {`,
    `    server 127.0.0.1:3000;`,
    `}`,
    ``,
  ];

  if (creds.ssl && creds.domain) {
    lines.push(
      `server {`,
      `    listen 80;`,
      `    server_name ${serverName};`,
      `    return 301 https://$host$request_uri;`,
      `}`,
      ``,
      `server {`,
      `    listen 443 ssl http2;`,
      `    server_name ${serverName};`,
      ``,
      `    ssl_certificate /etc/letsencrypt/live/${creds.domain}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${creds.domain}/privkey.pem;`,
      `    ssl_protocols TLSv1.2 TLSv1.3;`,
      `    ssl_ciphers HIGH:!aNULL:!MD5;`,
      ``,
      locationBlocks(),
      `}`,
    );
  } else {
    lines.push(
      `server {`,
      `    listen 80;`,
      `    server_name ${serverName};`,
      ``,
      locationBlocks(),
      `}`,
    );
  }

  return lines.join('\n');
}

export function generatePm2Ecosystem(): string {
  return JSON.stringify({
    apps: [
      {
        name: 'ship-dock-api',
        script: 'dist/main.js',
        cwd: `${PROJECT_DIR}/backend`,
        instances: 1,
        env: { NODE_ENV: 'production' },
      },
      {
        name: 'ship-dock-web',
        script: 'node_modules/.bin/next',
        args: 'start',
        cwd: `${PROJECT_DIR}/frontend`,
        instances: 1,
        env: { NODE_ENV: 'production', PORT: '3000' },
      },
    ],
  }, null, 2);
}

export function generateMinioSystemd(creds: Credentials): string {
  return `[Unit]
Description=MinIO
After=network.target

[Service]
Type=simple
User=minio-user
Group=minio-user
Environment="MINIO_ROOT_USER=${creds.minioAccessKey}"
Environment="MINIO_ROOT_PASSWORD=${creds.minioSecretKey}"
ExecStart=/usr/local/bin/minio server /data/minio --console-address ":9001"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;
}

export function writeAllConfigs(creds: Credentials): void {
  generateBackendEnv(creds);
  generateFrontendEnv(creds);

  mkdirSync(`${PROJECT_DIR}/nginx`, { recursive: true });
  writeFileSync(`${PROJECT_DIR}/nginx/ship-dock.conf`, generateNginxConfig(creds));

  writeFileSync(`${PROJECT_DIR}/ecosystem.config.json`, generatePm2Ecosystem());
}
