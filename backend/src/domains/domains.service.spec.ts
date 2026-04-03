import { Test } from '@nestjs/testing';
import { DomainsService } from './domains.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';

describe('DomainsService', () => {
  let service: DomainsService;
  let prisma: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = { domainProvider: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() } };
    encryption = { encrypt: jest.fn((v) => 'enc:' + v), decrypt: jest.fn((v) => v.replace('enc:', '')), mask: jest.fn((v) => '****' + v.slice(-4)) };
    const module = await Test.createTestingModule({
      providers: [DomainsService, { provide: PrismaService, useValue: prisma }, { provide: EncryptionService, useValue: encryption }],
    }).compile();
    service = module.get(DomainsService);
  });

  it('encrypts API credentials before storing', async () => {
    prisma.domainProvider.create.mockResolvedValue({ id: '1', provider: 'NAMECHEAP', apiKey: 'enc:key123', apiSecret: 'enc:secret123' });
    await service.createProvider('user-1', { provider: 'NAMECHEAP', apiKey: 'key123', apiSecret: 'secret123' });
    expect(encryption.encrypt).toHaveBeenCalledWith('key123');
    expect(encryption.encrypt).toHaveBeenCalledWith('secret123');
  });

  it('returns providers with masked credentials', async () => {
    prisma.domainProvider.findMany.mockResolvedValue([{ id: '1', provider: 'NAMECHEAP', apiKey: 'enc:key123', apiSecret: 'enc:secret123' }]);
    const result = await service.listProviders();
    expect(result[0].apiKey).toContain('****');
    expect(result[0].apiSecret).toContain('****');
  });
});
