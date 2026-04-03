import { Pm2Stage } from './pm2.stage';

describe('Pm2Stage', () => {
  let stage: Pm2Stage;
  beforeEach(() => { stage = new Pm2Stage(); });

  it('generates ecosystem config content', () => {
    const config = stage.buildEcosystemConfig({ name: 'my-app', script: 'dist/main.js', cwd: '/var/www/my-app', port: 3001, envVars: { NODE_ENV: 'production', DB_HOST: 'localhost' } });
    expect(config).toContain("name: 'my-app'");
    expect(config).toContain("script: 'dist/main.js'");
    expect(config).toContain('PORT: 3001');
    expect(config).toContain("DB_HOST: 'localhost'");
  });

  it('generates pm2 start command for first deploy', () => {
    expect(stage.buildCommand('/var/www/my-app', true)).toContain('pm2 start ecosystem.config.js');
  });

  it('generates pm2 restart command for subsequent deploys', () => {
    expect(stage.buildCommand('/var/www/my-app', false)).toContain('pm2 restart ecosystem.config.js');
  });
});
