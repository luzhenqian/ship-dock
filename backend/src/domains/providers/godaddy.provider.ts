import { DnsProviderInterface, DnsRecord } from './dns-provider.interface';

export class GodaddyProvider implements DnsProviderInterface {
  private baseUrl = 'https://api.godaddy.com/v1';
  constructor(private apiKey: string, private apiSecret: string) {}

  private get headers() { return { Authorization: `sso-key ${this.apiKey}:${this.apiSecret}`, 'Content-Type': 'application/json' }; }

  async listDomains(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/domains`, { headers: this.headers });
    return ((await res.json()) as any[]).map((d) => d.domain);
  }

  async getRecords(domain: string): Promise<DnsRecord[]> {
    const res = await fetch(`${this.baseUrl}/domains/${domain}/records`, { headers: this.headers });
    return ((await res.json()) as any[]).map((r) => ({ name: r.name, type: r.type, value: r.data, ttl: r.ttl }));
  }

  async addRecord(domain: string, record: DnsRecord): Promise<void> {
    await fetch(`${this.baseUrl}/domains/${domain}/records`, {
      method: 'PATCH', headers: this.headers,
      body: JSON.stringify([{ name: record.name, type: record.type, data: record.value, ttl: record.ttl || 600 }]),
    });
  }

  async deleteRecord(domain: string, target: { name: string; type: string }): Promise<void> {
    await fetch(`${this.baseUrl}/domains/${domain}/records/${target.type}/${target.name}`, { method: 'DELETE', headers: this.headers });
  }
}
