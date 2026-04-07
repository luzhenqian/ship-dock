import { writeFileSync, mkdirSync } from 'fs';
import { Credentials } from './credentials.js';

const PROJECT_DIR = '/opt/shipdock';

export function generateEnvFile(creds: Credentials): void {
  const dbUrl = `postgresql://${creds.dbUser}:${creds.dbPassword}@${creds.dbHost}:${creds.dbPort}/${creds.dbName}`;

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
    `FRONTEND_URL=http${creds.ssl ? 's' : ''}://${creds.domain}`,
  ].filter(Boolean);

  writeFileSync(`${PROJECT_DIR}/backend/.env`, lines.join('\n') + '\n');
}

function proxyBlock(port: string): string {
  return `    client_max_body_size 20M;

    location / {
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

    location /uploads/ {
        alias ${PROJECT_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }`;
}

export function generateNginxConfig(creds: Credentials): string {
  const lines: string[] = [
    `upstream ship_dock_api {`,
    `    server 127.0.0.1:${creds.port};`,
    `}`,
    ``,
  ];

  if (creds.ssl) {
    // HTTP → redirect to HTTPS
    lines.push(
      `server {`,
      `    listen 80;`,
      `    server_name ${creds.domain};`,
      `    return 301 https://$host$request_uri;`,
      `}`,
      ``,
    );
    // HTTPS
    lines.push(
      `server {`,
      `    listen 443 ssl http2;`,
      `    server_name ${creds.domain};`,
      ``,
      `    ssl_certificate /etc/letsencrypt/live/${creds.domain}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${creds.domain}/privkey.pem;`,
      `    ssl_protocols TLSv1.2 TLSv1.3;`,
      `    ssl_ciphers HIGH:!aNULL:!MD5;`,
      ``,
      proxyBlock(creds.port),
      `}`,
    );
  } else {
    // HTTP only
    lines.push(
      `server {`,
      `    listen 80;`,
      `    server_name ${creds.domain};`,
      ``,
      proxyBlock(creds.port),
      `}`,
    );
  }

  return lines.join('\n');
}

export function generatePm2Ecosystem(): string {
  return JSON.stringify({
    apps: [{
      name: 'ship-dock-api',
      script: 'dist/main.js',
      cwd: `${PROJECT_DIR}/backend`,
      instances: 1,
      env: { NODE_ENV: 'production' },
    }],
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
  // .env
  generateEnvFile(creds);

  // Nginx
  mkdirSync(`${PROJECT_DIR}/nginx`, { recursive: true });
  writeFileSync(`${PROJECT_DIR}/nginx/ship-dock.conf`, generateNginxConfig(creds));

  // PM2 ecosystem
  writeFileSync(`${PROJECT_DIR}/backend/ecosystem.config.json`, generatePm2Ecosystem());
}
