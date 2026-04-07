import { ManifestParser } from './manifest-parser';

describe('ManifestParser', () => {
  let parser: ManifestParser;

  beforeEach(() => {
    parser = new ManifestParser();
  });

  const validManifest = {
    version: 1,
    createdAt: '2026-04-07T12:00:00Z',
    sourceServer: { hostname: 'prod-1', ip: '10.0.0.1' },
    projects: [
      {
        name: 'my-api',
        type: 'pm2',
        directory: '/var/www/my-api',
        command: 'node dist/main.js',
        port: 3001,
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@localhost:5432/myapi' },
        nginx: { serverNames: ['api.example.com'], sslCert: '/etc/letsencrypt/live/api.example.com/fullchain.pem' },
        cron: [{ schedule: '*/5 * * * *', command: 'node scripts/cleanup.js' }],
        databases: [{ type: 'postgresql', connectionUrl: 'postgresql://user:pass@localhost:5432/myapi' }],
        redis: [{ connectionUrl: 'redis://localhost:6379/0' }],
        storage: [],
        data: { database: 'projects/my-api/database.sql.gz', redis: 'projects/my-api/redis.rdb', code: null },
        gitRemote: 'git@github.com:user/my-api.git',
        gitCommit: 'abc123',
      },
    ],
  };

  it('parses a valid manifest', () => {
    const result = parser.parse(validManifest);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('my-api');
    expect(result.projects[0].databases).toHaveLength(1);
  });

  it('throws on missing version', () => {
    expect(() => parser.parse({ ...validManifest, version: undefined })).toThrow('Missing required field: version');
  });

  it('throws on empty projects array', () => {
    expect(() => parser.parse({ ...validManifest, projects: [] })).toThrow('No projects found');
  });

  it('throws on project missing name', () => {
    const bad = { ...validManifest, projects: [{ ...validManifest.projects[0], name: '' }] };
    expect(() => parser.parse(bad)).toThrow('Project at index 0 missing name');
  });
});
