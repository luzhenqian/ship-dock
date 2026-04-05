import { StageContext, StageResult } from './command.stage';
import { spawn, execSync } from 'child_process';
import { DomainsService } from '../../domains/domains.service';

export class SslStage {
  buildCommand(domain: string): string {
    return `sudo certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email`;
  }

  hasCert(domain: string): boolean {
    try {
      execSync(`sudo test -f /etc/letsencrypt/live/${domain}/fullchain.pem`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find which provider manages the root domain, then add an A record for the subdomain.
   * e.g. domain = "api.claude-harness.dev" → root = "claude-harness.dev", subdomain = "api"
   */
  async ensureDns(domain: string, serverIp: string, domainsService: DomainsService, onLog: (line: string) => void): Promise<boolean> {
    const providers = await domainsService.listProviders();
    if (providers.length === 0) {
      onLog('No DNS providers configured, skipping auto-DNS');
      return false;
    }

    // Try to find which provider manages a root domain that matches
    for (const provider of providers) {
      let domains: string[];
      try {
        domains = await domainsService.listDomains(provider.id);
      } catch {
        continue;
      }

      for (const rootDomain of domains) {
        if (domain === rootDomain || domain.endsWith(`.${rootDomain}`)) {
          // Found the matching provider + root domain
          const subdomain = domain === rootDomain ? '@' : domain.slice(0, -(rootDomain.length + 1));
          onLog(`Found DNS provider "${provider.provider}" managing ${rootDomain}`);
          onLog(`Adding A record: ${subdomain} → ${serverIp}`);

          try {
            await domainsService.addRecord(provider.id, rootDomain, {
              name: subdomain, type: 'A', value: serverIp, ttl: 600,
            });
            onLog('DNS record added successfully');
            return true;
          } catch (err: any) {
            onLog(`Failed to add DNS record: ${err.message}`);
            return false;
          }
        }
      }
    }

    onLog(`No DNS provider found managing domain ${domain}`);
    return false;
  }

  private async waitForDns(domain: string, expectedIp: string, onLog: (line: string) => void, maxAttempts = 10): Promise<boolean> {
    const { resolve4 } = await import('dns/promises');
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const addresses = await resolve4(domain);
        if (addresses.includes(expectedIp)) {
          onLog(`DNS verified: ${domain} → ${expectedIp}`);
          return true;
        }
        onLog(`Waiting for DNS propagation (${i}/${maxAttempts})... got ${addresses.join(', ')}`);
      } catch {
        onLog(`Waiting for DNS propagation (${i}/${maxAttempts})...`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    onLog('DNS propagation timeout — attempting certbot anyway');
    return false;
  }

  async execute(domain: string, ctx: StageContext, domainsService?: DomainsService, serverIp?: string): Promise<StageResult> {
    if (this.hasCert(domain)) {
      ctx.onLog(`SSL certificate already exists for ${domain}, skipping`);
      return { success: true };
    }

    // Auto-configure DNS if domains service is available
    if (domainsService && serverIp) {
      const dnsAdded = await this.ensureDns(domain, serverIp, domainsService, ctx.onLog);
      if (dnsAdded) {
        await this.waitForDns(domain, serverIp, ctx.onLog);
      }
    }

    const command = this.buildCommand(domain);
    ctx.onLog(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => { const c = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m'; ctx.onLog(`${c}${line}\x1b[0m`); }); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `certbot failed (code ${code})` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
