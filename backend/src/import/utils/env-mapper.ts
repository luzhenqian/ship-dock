export interface LocalServices {
  databaseUrl?: string;
  redisUrl?: string;
  minioEndpoint?: string;
  minioPort?: string;
  minioAccessKey?: string;
  minioSecretKey?: string;
  minioBucket?: string;
}

export interface EnvMappingResult {
  key: string;
  originalValue: string;
  suggestedValue: string;
  autoDetected: boolean;
  warning?: string;
}

const DB_NAME_PATTERNS =
  /^(DATABASE_URL|DB_URL|DB_HOST|DB_CONNECTION|POSTGRES_URL|PG_CONNECTION_STRING)$/i;
const REDIS_NAME_PATTERNS = /^(REDIS_URL|REDIS_HOST|REDIS_CONNECTION)$/i;
const STORAGE_NAME_PATTERNS =
  /^(S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|S3_BUCKET|MINIO_ENDPOINT|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|MINIO_BUCKET|AWS_S3_ENDPOINT|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_S3_BUCKET)$/i;

const STORAGE_KEY_MAP: Record<string, keyof LocalServices> = {
  S3_ENDPOINT: 'minioEndpoint',
  MINIO_ENDPOINT: 'minioEndpoint',
  AWS_S3_ENDPOINT: 'minioEndpoint',
  S3_ACCESS_KEY: 'minioAccessKey',
  MINIO_ACCESS_KEY: 'minioAccessKey',
  AWS_ACCESS_KEY_ID: 'minioAccessKey',
  S3_SECRET_KEY: 'minioSecretKey',
  MINIO_SECRET_KEY: 'minioSecretKey',
  AWS_SECRET_ACCESS_KEY: 'minioSecretKey',
  S3_BUCKET: 'minioBucket',
  MINIO_BUCKET: 'minioBucket',
  AWS_S3_BUCKET: 'minioBucket',
};

export class EnvMapper {
  static map(
    env: Record<string, string>,
    local: LocalServices,
  ): EnvMappingResult[] {
    return Object.entries(env).map(([key, rawValue]) => {
      // Ensure value is a string (env vars from CLI may include numbers/booleans)
      const value = String(rawValue ?? '');

      // Check connection string formats first
      if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.databaseUrl || value,
          autoDetected: true,
        };
      }
      if (value.startsWith('mysql://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.databaseUrl || value,
          autoDetected: true,
          warning:
            'MySQL connection detected. Ship Dock uses PostgreSQL — data conversion may be required.',
        };
      }
      if (value.startsWith('redis://') || value.startsWith('rediss://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.redisUrl || value,
          autoDetected: true,
        };
      }
      // Check name patterns
      if (DB_NAME_PATTERNS.test(key) && local.databaseUrl) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.databaseUrl,
          autoDetected: true,
        };
      }
      if (REDIS_NAME_PATTERNS.test(key) && local.redisUrl) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.redisUrl,
          autoDetected: true,
        };
      }
      if (STORAGE_NAME_PATTERNS.test(key)) {
        const upperKey = key.toUpperCase();
        const localKey = STORAGE_KEY_MAP[upperKey];
        const replacement = localKey ? local[localKey] : undefined;
        return {
          key,
          originalValue: value,
          suggestedValue: replacement || value,
          autoDetected: !!replacement,
        };
      }
      // Unrecognized
      return {
        key,
        originalValue: value,
        suggestedValue: value,
        autoDetected: false,
      };
    });
  }
}
