import { StageContext, StageResult, spawnWithTimeout } from './command.stage';
import { execSync } from 'child_process';
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
          try {
            const records = await domainsService.getRecords(provider.id, rootDomain);
            const existing = records.find((r) => r.name === subdomain && r.type === 'A');
            if (existing && existing.value === serverIp) {
              onLog(`A record already points to ${serverIp}, skipping`);
              return true;
            }
            const newRecord = { name: subdomain, type: 'A', value: serverIp, ttl: 600 };
            if (existing) {
              onLog(`Updating A record: ${subdomain} ${existing.value} → ${serverIp}`);
              await domainsService.updateRecord(provider.id, rootDomain, { name: subdomain, type: 'A' }, newRecord);
              onLog('DNS record updated successfully');
            } else {
              onLog(`Adding A record: ${subdomain} → ${serverIp}`);
              await domainsService.addRecord(provider.id, rootDomain, newRecord);
              onLog('DNS record added successfully');
            }
            return true;
          } catch (err: any) {
            onLog(`Failed to configure DNS record: ${err.message}`);
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
    return spawnWithTimeout(command, ctx.onLog, {
      timeoutMs: 3 * 60 * 1000,
      label: 'certbot',
    });
  }
}
