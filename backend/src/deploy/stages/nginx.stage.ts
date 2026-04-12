import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface CustomLocation {
  path: string;
  cacheEnabled?: boolean;
  cacheDuration?: string;
  cacheMaxSize?: string;
}

export interface NginxStageConfig {
  domain: string;
  port: number;
  slug: string;
  hasSsl: boolean;
  clientMaxBodySize?: number;
  proxyReadTimeout?: number;
  proxySendTimeout?: number;
  proxyConnectTimeout?: number;
  gzipEnabled?: boolean;
  gzipMinLength?: number;
  gzipTypes?: string;
  proxyBuffering?: boolean;
  proxyBufferSize?: string;
  proxyBuffers?: string;
  customLocations?: CustomLocation[];
}

const DEFAULTS = {
  clientMaxBodySize: 10,
  proxyReadTimeout: 60,
  proxySendTimeout: 60,
  proxyConnectTimeout: 60,
  gzipEnabled: true,
  gzipMinLength: 1024,
  gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
  proxyBuffering: true,
  proxyBufferSize: '4k',
  proxyBuffers: '8 4k',
};

export class NginxStage {
  buildConfig(config: NginxStageConfig): string {
    const c = { ...DEFAULTS, ...config };

    const gzipBlock = c.gzipEnabled
      ? `
    gzip on;
    gzip_min_length ${c.gzipMinLength};
    gzip_types ${c.gzipTypes};`
      : `
    gzip off;`;

    const customLocationBlocks = (c.customLocations || []).map((loc) => {
      const path = loc.path.endsWith('/') ? loc.path : loc.path + '/';
      const cacheName = `cache_${c.slug}_${path.replace(/\//g, '_').replace(/^_|_$/g, '')}`;
      const cacheLines = loc.cacheEnabled ? `
        proxy_cache ${cacheName};
        proxy_cache_valid 200 ${loc.cacheDuration || '7d'};
        proxy_cache_key $uri;
        add_header X-Cache-Status $upstream_cache_status;` : '';
      return `
    location ${path} {
        proxy_pass http://127.0.0.1:${c.port};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;${cacheLines}
    }`;
    }).join('\n');

    const locationBlock = `${customLocationBlocks}

    location / {
        proxy_pass http://127.0.0.1:${c.port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout ${c.proxyReadTimeout}s;
        proxy_send_timeout ${c.proxySendTimeout}s;
        proxy_connect_timeout ${c.proxyConnectTimeout}s;
        proxy_buffering ${c.proxyBuffering ? 'on' : 'off'};${c.proxyBuffering ? `
        proxy_buffer_size ${c.proxyBufferSize};
        proxy_buffers ${c.proxyBuffers};` : ''}
    }`;

    const serverBlock = `
    client_max_body_size ${c.clientMaxBodySize}m;
${gzipBlock}
${locationBlock}`;

    if (!config.hasSsl) {
      return `server {\n    listen 80;\n    server_name ${config.domain};\n${serverBlock}\n}`;
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
${serverBlock}
}`;
  }

  buildCacheConfig(config: NginxStageConfig): string | null {
    const locs = (config.customLocations || []).filter((l) => l.cacheEnabled);
    if (!locs.length) return null;
    return locs.map((loc) => {
      const path = loc.path.endsWith('/') ? loc.path : loc.path + '/';
      const cacheName = `cache_${config.slug}_${path.replace(/\//g, '_').replace(/^_|_$/g, '')}`;
      const maxSize = loc.cacheMaxSize || '500m';
      return `proxy_cache_path /tmp/nginx-cache-${cacheName} levels=1:2 keys_zone=${cacheName}:10m max_size=${maxSize} inactive=${loc.cacheDuration || '7d'};`;
    }).join('\n');
  }

  async execute(config: NginxStageConfig, ctx: StageContext): Promise<StageResult> {
    const confPath = `/etc/nginx/sites-available/${config.slug}.conf`;
    const enabledPath = `/etc/nginx/sites-enabled/${config.slug}.conf`;
    const nginxConf = this.buildConfig(config);
    const command = `echo '${nginxConf.replace(/'/g, "'\\''")}' | sudo tee ${confPath} > /dev/null && sudo ln -sf ${confPath} ${enabledPath} && sudo nginx -t && sudo nginx -s reload`;
    ctx.onLog(`Writing nginx config to ${confPath}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => { const c = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m'; ctx.onLog(`${c}${line}\x1b[0m`); }); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `nginx config failed (code ${code})` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
