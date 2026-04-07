import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { NamecheapProvider } from './providers/namecheap.provider';
import { GodaddyProvider } from './providers/godaddy.provider';
import { DnsProviderInterface, DnsRecord } from './providers/dns-provider.interface';

@Injectable()
export class DomainsService {
  constructor(private prisma: PrismaService, private encryption: EncryptionService) {}

  async createProvider(userId: string, dto: CreateProviderDto) {
    return this.prisma.domainProvider.create({
      data: { provider: dto.provider as any, apiKey: this.encryption.encrypt(dto.apiKey), apiSecret: this.encryption.encrypt(dto.apiSecret), createdById: userId },
    });
  }

  async listProviders() {
    const providers = await this.prisma.domainProvider.findMany();
    return providers.map((p) => ({ ...p, apiKey: this.encryption.mask(this.encryption.decrypt(p.apiKey)), apiSecret: this.encryption.mask(this.encryption.decrypt(p.apiSecret)) }));
  }

  async updateProvider(id: string, dto: UpdateProviderDto) {
    const data: any = {};
    if (dto.apiKey) data.apiKey = this.encryption.encrypt(dto.apiKey);
    if (dto.apiSecret) data.apiSecret = this.encryption.encrypt(dto.apiSecret);
    return this.prisma.domainProvider.update({ where: { id }, data });
  }

  async getProvider(id: string) {
    const provider = await this.prisma.domainProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('Provider not found');
    return {
      ...provider,
      apiKey: this.encryption.decrypt(provider.apiKey),
      apiSecret: this.encryption.decrypt(provider.apiSecret),
    };
  }

  async deleteProvider(id: string) { return this.prisma.domainProvider.delete({ where: { id } }); }

  async getProviderClient(providerId: string): Promise<DnsProviderInterface> {
    const provider = await this.prisma.domainProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');
    const apiKey = this.encryption.decrypt(provider.apiKey);
    const apiSecret = this.encryption.decrypt(provider.apiSecret);
    return provider.provider === 'NAMECHEAP' ? new NamecheapProvider(apiKey, apiSecret) : new GodaddyProvider(apiKey, apiSecret);
  }

  async listDomains(providerId: string) { return (await this.getProviderClient(providerId)).listDomains(); }
  async getRecords(providerId: string, domain: string) { return (await this.getProviderClient(providerId)).getRecords(domain); }

  async addRecord(providerId: string, domain: string, record: DnsRecord) {
    try {
      await (await this.getProviderClient(providerId)).addRecord(domain, record);
      return { success: true };
    } catch (e) { throw new BadRequestException(e.message); }
  }

  async updateRecord(providerId: string, domain: string, original: { name: string; type: string }, updated: DnsRecord) {
    const client = await this.getProviderClient(providerId);
    try {
      await client.deleteRecord(domain, original);
      await client.addRecord(domain, updated);
      return { success: true };
    } catch (e) { throw new BadRequestException(e.message); }
  }

  async deleteRecord(providerId: string, domain: string, record: { name: string; type: string }) {
    try {
      await (await this.getProviderClient(providerId)).deleteRecord(domain, record);
      return { success: true };
    } catch (e) { throw new BadRequestException(e.message); }
  }
}
