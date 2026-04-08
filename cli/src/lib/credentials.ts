import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'fs';
import { dirname } from 'path';

export function generateSecret(length = 32): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

export interface Credentials {
  adminEmail: string;
  adminPassword: string;
  domain: string;
  port: string;
  ssl: boolean;
  // PostgreSQL
  useExistingDb: boolean;
  dbHost: string;
  dbPort: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  // Redis
  useExistingRedis: boolean;
  redisHost: string;
  redisPort: string;
  redisPassword: string;
  // MinIO
  useExistingMinio: boolean;
  minioEndpoint: string;
  minioPort: string;
  minioAccessKey: string;
  minioSecretKey: string;
  // Secrets
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
  // GitHub App (optional)
  githubAppId: string;
  githubAppPrivateKey: string;
  githubAppWebhookSecret: string;
  githubAppSlug: string;
  // Google Analytics (optional)
  googleClientId: string;
  googleClientSecret: string;
  // Microsoft Clarity (optional)
  microsoftClientId: string;
  microsoftClientSecret: string;
}

export function saveCredentials(creds: Credentials, path: string): void {
  mkdirSync(dirname(path), { recursive: true });

  const lines = [
    '# Ship Dock Credentials',
    `# Generated at ${new Date().toISOString()}`,
    '',
    `Admin Email:       ${creds.adminEmail}`,
    `Admin Password:    ${creds.adminPassword}`,
    '',
    `Domain:            ${creds.domain}`,
    `API Port:          ${creds.port}`,
    `SSL:               ${creds.ssl ? 'enabled' : 'disabled'}`,
    '',
    `PostgreSQL Host:     ${creds.dbHost}:${creds.dbPort}`,
    `PostgreSQL Database: ${creds.dbName}`,
    `PostgreSQL User:     ${creds.dbUser}`,
    `PostgreSQL Password: ${creds.dbPassword}`,
    '',
    `Redis Host:          ${creds.redisHost}:${creds.redisPort}`,
    `Redis Password:      ${creds.redisPassword || '(none)'}`,
    '',
    `MinIO Endpoint:    ${creds.minioEndpoint}:${creds.minioPort}`,
    `MinIO Access Key:  ${creds.minioAccessKey}`,
    `MinIO Secret Key:  ${creds.minioSecretKey}`,
    '',
    `JWT Secret:        ${creds.jwtSecret}`,
    `JWT Refresh Secret: ${creds.jwtRefreshSecret}`,
    `Encryption Key:    ${creds.encryptionKey}`,
  ];

  writeFileSync(path, lines.join('\n') + '\n');
  chmodSync(path, 0o600);
}
