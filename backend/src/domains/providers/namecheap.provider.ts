import { DnsProviderInterface, DnsRecord } from './dns-provider.interface';
import { BadRequestException } from '@nestjs/common';

export class NamecheapProvider implements DnsProviderInterface {
  private baseUrl = 'https://api.namecheap.com/xml.response';
  private clientIp: string | null = null;
  constructor(private apiUser: string, private apiKey: string) {}

  private async getClientIp(): Promise<string> {
    if (this.clientIp) return this.clientIp;
    const res = await fetch('https://api.ipify.org?format=text');
    this.clientIp = (await res.text()).trim();
    return this.clientIp;
  }

  private checkErrors(xml: string): void {
    if (xml.includes('Status="ERROR"')) {
      const match = xml.match(/<Error[^>]*>([^<]+)<\/Error>/);
      throw new BadRequestException(`Namecheap API error: ${match?.[1] || 'Unknown error'}`);
    }
  }

  async listDomains(): Promise<string[]> {
    const clientIp = await this.getClientIp();
    const params = new URLSearchParams({ ApiUser: this.apiUser, ApiKey: this.apiKey, UserName: this.apiUser, Command: 'namecheap.domains.getList', ClientIp: clientIp });
    const res = await fetch(`${this.baseUrl}?${params}`);
    const text = await res.text();
    this.checkErrors(text);
    const matches = [...text.matchAll(/Name="([^"]+)"[^>]*IsExpired="([^"]+)"/g)];
    return matches.filter((m) => m[2] === 'false').map((m) => m[1]);
  }

  async getRecords(domain: string): Promise<DnsRecord[]> {
    const [sld, tld] = this.splitDomain(domain);
    const clientIp = await this.getClientIp();
    const params = new URLSearchParams({ ApiUser: this.apiUser, ApiKey: this.apiKey, UserName: this.apiUser, Command: 'namecheap.domains.dns.getHosts', ClientIp: clientIp, SLD: sld, TLD: tld });
    const res = await fetch(`${this.baseUrl}?${params}`);
    const text = await res.text();
    this.checkErrors(text);
    const records: DnsRecord[] = [];
    const hostMatches = [...text.matchAll(/HostId="[^"]*"\s+Name="([^"]*)"\s+Type="([^"]*)"\s+Address="([^"]*)"\s+.*?TTL="(\d+)"/g)];
    for (const m of hostMatches) records.push({ name: m[1], type: m[2], value: m[3], ttl: parseInt(m[4]) });
    return records;
  }

  async addRecord(domain: string, record: DnsRecord): Promise<void> {
    const existing = await this.getRecords(domain);
    existing.push(record);
    await this.setHosts(domain, existing);
  }

  async deleteRecord(domain: string, target: { name: string; type: string }): Promise<void> {
    const existing = await this.getRecords(domain);
    const filtered = existing.filter((r) => !(r.name === target.name && r.type === target.type));
    await this.setHosts(domain, filtered);
  }

  private async setHosts(domain: string, records: DnsRecord[]): Promise<void> {
    const [sld, tld] = this.splitDomain(domain);
    const clientIp = await this.getClientIp();
    const params = new URLSearchParams({ ApiUser: this.apiUser, ApiKey: this.apiKey, UserName: this.apiUser, Command: 'namecheap.domains.dns.setHosts', ClientIp: clientIp, SLD: sld, TLD: tld });
    records.forEach((r, i) => { params.set(`HostName${i+1}`, r.name); params.set(`RecordType${i+1}`, r.type); params.set(`Address${i+1}`, r.value); params.set(`TTL${i+1}`, String(r.ttl || 1800)); });
    const res = await fetch(`${this.baseUrl}?${params}`);
    const text = await res.text();
    this.checkErrors(text);
  }

  private splitDomain(domain: string): [string, string] {
    const parts = domain.split('.'); const tld = parts.pop()!; const sld = parts.pop()!; return [sld, tld];
  }
}
