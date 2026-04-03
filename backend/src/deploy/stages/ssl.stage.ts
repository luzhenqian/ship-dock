import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

export class SslStage {
  buildCommand(domain: string): string {
    return `certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email`;
  }

  hasCert(domain: string): boolean {
    return existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
  }

  async execute(domain: string, ctx: StageContext): Promise<StageResult> {
    if (this.hasCert(domain)) { ctx.onLog(`SSL certificate already exists for ${domain}, skipping`); return { success: true }; }
    const command = this.buildCommand(domain);
    ctx.onLog(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `certbot failed (code ${code})` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
