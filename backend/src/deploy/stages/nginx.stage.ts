import { StageContext, StageResult } from './command.stage';
import { writeFileSync } from 'fs';
import { spawn } from 'child_process';

export interface NginxConfig {
  domain: string; port: number; slug: string; hasSsl: boolean;
}

export class NginxStage {
  buildConfig(config: NginxConfig): string {
    const proxyBlock = `
    location / {
        proxy_pass http://127.0.0.1:${config.port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }`;

    if (!config.hasSsl) {
      return `server {\n    listen 80;\n    server_name ${config.domain};\n${proxyBlock}\n}`;
    }

    return `server {
    listen 80;
    server_name ${config.domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name ${config.domain};

    ssl_certificate /etc/letsencrypt/live/${config.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.domain}/privkey.pem;
${proxyBlock}
}`;
  }

  async execute(config: NginxConfig, ctx: StageContext): Promise<StageResult> {
    const confPath = `/etc/nginx/sites-available/${config.slug}.conf`;
    const enabledPath = `/etc/nginx/sites-enabled/${config.slug}.conf`;
    try { writeFileSync(confPath, this.buildConfig(config)); ctx.onLog(`Wrote nginx config to ${confPath}`); }
    catch (err: any) { return { success: false, error: `Failed to write nginx config: ${err.message}` }; }
    const command = `ln -sf ${confPath} ${enabledPath} && nginx -t && nginx -s reload`;
    ctx.onLog(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `nginx config failed (code ${code})` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
