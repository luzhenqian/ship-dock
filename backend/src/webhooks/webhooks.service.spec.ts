import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { DeployService } from '../deploy/deploy.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  const mockPrisma = {
    webhookConfig: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    webhookEvent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    project: { findUnique: jest.fn() },
  };
  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
  };
  const mockFilter = {
    matchEvent: jest.fn().mockReturnValue({ pass: true }),
    matchBranch: jest.fn().mockReturnValue({ pass: true }),
    matchPaths: jest.fn().mockReturnValue({ pass: true }),
  };
  const mockDeploy = { trigger: jest.fn().mockResolvedValue({ id: 'deploy-1' }) };
  const mockConfig = { getOrThrow: jest.fn().mockReturnValue('http://localhost:4000') };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
        { provide: WebhooksFilterService, useValue: mockFilter },
        { provide: DeployService, useValue: mockDeploy },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(WebhooksService);
    jest.clearAllMocks();
  });

  describe('processWebhookEvent', () => {
    const baseArgs = {
      projectId: 'proj-1',
      deliveryId: 'del-1',
      event: 'push',
      headers: { 'x-github-event': 'push' },
      payload: { ref: 'refs/heads/main', after: 'abc', pusher: { name: 'u' }, head_commit: { message: 'm' }, commits: [] },
    };

    it('should trigger deployment when all filters pass', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue({
        projectId: 'proj-1', events: ['push'], branchFilters: [], pathFilters: [], enabled: true,
      });
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.webhookEvent.update.mockResolvedValue({});
      mockPrisma.project.findUnique.mockResolvedValue({ createdById: 'user-1' });

      await service.processWebhookEvent(baseArgs);

      expect(mockDeploy.trigger).toHaveBeenCalledWith('proj-1', expect.any(String));
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'TRIGGERED' }) }),
      );
    });

    it('should set FILTERED status when branch filter fails', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue({
        projectId: 'proj-1', events: ['push'], branchFilters: ['main'], pathFilters: [], enabled: true,
      });
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockFilter.matchBranch.mockReturnValueOnce({ pass: false, reason: 'not main' });
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.webhookEvent.update.mockResolvedValue({});

      await service.processWebhookEvent(baseArgs);

      expect(mockDeploy.trigger).not.toHaveBeenCalled();
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FILTERED' }) }),
      );
    });
  });

  describe('getConfig', () => {
    it('should throw NotFoundException when no config exists', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue(null);
      await expect(service.getConfig('proj-1')).rejects.toThrow(NotFoundException);
    });
  });
});
