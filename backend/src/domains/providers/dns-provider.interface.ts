export interface DnsRecord { name: string; type: string; value: string; ttl: number; }
export interface DnsProviderInterface {
  listDomains(): Promise<string[]>;
  getRecords(domain: string): Promise<DnsRecord[]>;
  addRecord(domain: string, record: DnsRecord): Promise<void>;
  deleteRecord(domain: string, record: { name: string; type: string }): Promise<void>;
}
