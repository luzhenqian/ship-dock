import { NginxStage } from './nginx.stage';

describe('NginxStage.buildStaticConfig', () => {
  const stage = new NginxStage();

  it('generates root-based config without SSL', () => {
    const config = stage.buildStaticConfig({
      domain: 'example.com',
      slug: 'my-site',
      rootDir: '/var/www/my-site',
      hasSsl: false,
    });
    expect(config).toContain('listen 80');
    expect(config).toContain('server_name example.com');
    expect(config).toContain('root /var/www/my-site');
    expect(config).toContain('try_files $uri $uri/ /index.html');
    expect(config).not.toContain('proxy_pass');
  });

  it('generates SSL redirect + https block with SSL', () => {
    const config = stage.buildStaticConfig({
      domain: 'example.com',
      slug: 'my-site',
      rootDir: '/var/www/my-site',
      hasSsl: true,
    });
    expect(config).toContain('return 301 https://');
    expect(config).toContain('listen 443 ssl');
    expect(config).toContain('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem');
  });
});
