import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionsService } from './connections.service';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { NotFoundException } from '@nestjs/common';

describe('ConnectionsService', () => {
  let service: ConnectionsService;
  let prisma: PrismaService;
  let encryption: EncryptionService;

  const mockPrisma = {
    analyticsConnection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    mask: jest.fn((v: string) => '****' + v.slice(-4)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();

    service = module.get(ConnectionsService);
    prisma = module.get(PrismaService);
    encryption = module.get(EncryptionService);
    jest.clearAllMocks();
  });

  describe('findAllByUser', () => {
    it('should return connections with masked tokens', async () => {
      mockPrisma.analyticsConnection.findMany.mockResolvedValue([
        {
          id: '1',
          userId: 'user1',
          provider: 'GOOGLE_GA4',
          accessToken: 'enc:access123',
          refreshToken: 'enc:refresh123',
          tokenExpiry: new Date('2026-01-01'),
          accountEmail: 'test@gmail.com',
          accountId: '123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.findAllByUser('user1');

      expect(result).toHaveLength(1);
      expect((result[0] as any).accessToken).toBeUndefined();
      expect((result[0] as any).refreshToken).toBeUndefined();
      expect(result[0].accountEmail).toBe('test@gmail.com');
      expect(mockPrisma.analyticsConnection.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('deleteConnection', () => {
    it('should delete a connection owned by the user', async () => {
      mockPrisma.analyticsConnection.findUnique.mockResolvedValue({
        id: '1',
        userId: 'user1',
      });
      mockPrisma.analyticsConnection.delete.mockResolvedValue({ id: '1' });

      await service.deleteConnection('1', 'user1');

      expect(mockPrisma.analyticsConnection.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw if connection not found or not owned', async () => {
      mockPrisma.analyticsConnection.findUnique.mockResolvedValue(null);

      await expect(service.deleteConnection('1', 'user1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('saveConnection', () => {
    it('should encrypt tokens before saving', async () => {
      mockPrisma.analyticsConnection.create.mockResolvedValue({ id: '1' });

      await service.saveConnection({
        userId: 'user1',
        provider: 'GOOGLE_GA4',
        accessToken: 'myAccessToken',
        refreshToken: 'myRefreshToken',
        tokenExpiry: new Date('2026-01-01'),
        accountEmail: 'test@gmail.com',
        accountId: '123',
      });

      expect(mockEncryption.encrypt).toHaveBeenCalledWith('myAccessToken');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('myRefreshToken');
      expect(mockPrisma.analyticsConnection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accessToken: 'enc:myAccessToken',
          refreshToken: 'enc:myRefreshToken',
        }),
      });
    });
  });
});
