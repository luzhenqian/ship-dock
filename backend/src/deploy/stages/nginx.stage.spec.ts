import { NginxStage } from './nginx.stage';

describe('NginxStage', () => {
  let stage: NginxStage;
  beforeEach(() => { stage = new NginxStage(); });

  it('generates nginx config with SSL', () => {
    const config = stage.buildConfig({ domain: 'app.example.com', port: 3001, slug: 'my-app', hasSsl: true });
    expect(config).toContain('server_name app.example.com');
    expect(config).toContain('proxy_pass http://127.0.0.1:3001');
    expect(config).toContain('listen 443 ssl');
    expect(config).toContain('/etc/letsencrypt/live/app.example.com/');
  });

  it('generates nginx config without SSL', () => {
    const config = stage.buildConfig({ domain: 'app.example.com', port: 3001, slug: 'my-app', hasSsl: false });
    expect(config).toContain('listen 80');
    expect(config).not.toContain('listen 443');
  });
});
