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
  dbPassword: string;
  redisPassword: string;
  minioAccessKey: string;
  minioSecretKey: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
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
    `PostgreSQL Password: ${creds.dbPassword}`,
    `Redis Password:      ${creds.redisPassword}`,
    '',
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
