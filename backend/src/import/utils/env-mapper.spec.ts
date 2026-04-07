import { EnvMapper, EnvMappingResult } from './env-mapper';

describe('EnvMapper', () => {
  const localServices = {
    databaseUrl: 'postgresql://shipdock:pass@localhost:5432/proj_myapi',
    redisUrl: 'redis://localhost:6379/3',
    minioEndpoint: 'localhost',
    minioPort: '9000',
    minioAccessKey: 'minioadmin',
    minioSecretKey: 'minioadmin',
    minioBucket: 'proj-myapi',
  };

  it('detects and replaces DATABASE_URL with postgresql connection string', () => {
    const env = { DATABASE_URL: 'postgresql://user:pass@remote:5432/prod' };
    const result = EnvMapper.map(env, localServices);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('DATABASE_URL');
    expect(result[0].originalValue).toBe('postgresql://user:pass@remote:5432/prod');
    expect(result[0].suggestedValue).toBe(localServices.databaseUrl);
    expect(result[0].autoDetected).toBe(true);
  });

  it('detects REDIS_URL', () => {
    const env = { REDIS_URL: 'redis://remote:6379/0' };
    const result = EnvMapper.map(env, localServices);
    expect(result[0].suggestedValue).toBe(localServices.redisUrl);
  });

  it('detects S3/MinIO vars by name pattern', () => {
    const env = {
      S3_ENDPOINT: 's3.amazonaws.com',
      S3_ACCESS_KEY: 'AKIA...',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'my-bucket',
    };
    const result = EnvMapper.map(env, localServices);
    const mapped = result.filter((r) => r.autoDetected);
    expect(mapped.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves unrecognized vars unchanged', () => {
    const env = { APP_NAME: 'MyApp', CUSTOM_FLAG: 'true' };
    const result = EnvMapper.map(env, localServices);
    expect(result.every((r) => !r.autoDetected)).toBe(true);
    expect(result.every((r) => r.suggestedValue === r.originalValue)).toBe(true);
  });

  it('detects mysql connection string and flags it', () => {
    const env = { DATABASE_URL: 'mysql://user:pass@rds.aws.com:3306/prod' };
    const result = EnvMapper.map(env, localServices);
    expect(result[0].autoDetected).toBe(true);
    expect(result[0].warning).toContain('MySQL');
  });
});
