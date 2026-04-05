import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../../common/prisma.service';
import { AnalyticsProvider } from '@prisma/client';

const mockPrisma = {
  analyticsIntegration: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    jest.clearAllMocks();
  });

  describe('findByProject', () => {
    it('returns integrations for a project', async () => {
      const integrations = [
        { id: 'int-1', projectId: 'proj-1', provider: 'GOOGLE_GA4' },
        { id: 'int-2', projectId: 'proj-1', provider: 'MICROSOFT_CLARITY' },
      ];
      mockPrisma.analyticsIntegration.findMany.mockResolvedValue(integrations);

      const result = await service.findByProject('proj-1');

      expect(mockPrisma.analyticsIntegration.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        include: {
          connection: { select: { accountEmail: true, provider: true } },
        },
      });
      expect(result).toEqual(integrations);
    });
  });

  describe('create', () => {
    it('throws ConflictException if provider already linked to project', async () => {
      mockPrisma.analyticsIntegration.findFirst.mockResolvedValue({
        id: 'int-1',
        projectId: 'proj-1',
        provider: 'GOOGLE_GA4',
      });

      await expect(
        service.create({
          projectId: 'proj-1',
          connectionId: 'conn-1',
          provider: AnalyticsProvider.GOOGLE_GA4,
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.analyticsIntegration.create).not.toHaveBeenCalled();
    });

    it('creates integration if provider not yet linked', async () => {
      mockPrisma.analyticsIntegration.findFirst.mockResolvedValue(null);
      const created = {
        id: 'int-new',
        projectId: 'proj-1',
        connectionId: 'conn-1',
        provider: 'GOOGLE_GA4',
        ga4PropertyId: 'properties/123',
      };
      mockPrisma.analyticsIntegration.create.mockResolvedValue(created);

      const result = await service.create({
        projectId: 'proj-1',
        connectionId: 'conn-1',
        provider: AnalyticsProvider.GOOGLE_GA4,
        ga4PropertyId: 'properties/123',
      });

      expect(mockPrisma.analyticsIntegration.create).toHaveBeenCalledWith({
        data: {
          projectId: 'proj-1',
          connectionId: 'conn-1',
          provider: AnalyticsProvider.GOOGLE_GA4,
          ga4PropertyId: 'properties/123',
          ga4StreamId: undefined,
          measurementId: undefined,
          clarityProjectId: undefined,
          clarityTrackingCode: undefined,
        },
      });
      expect(result).toEqual(created);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException if integration not found', async () => {
      mockPrisma.analyticsIntegration.findUnique.mockResolvedValue(null);

      await expect(service.delete('int-missing', 'proj-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.analyticsIntegration.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if integration belongs to different project', async () => {
      mockPrisma.analyticsIntegration.findUnique.mockResolvedValue({
        id: 'int-1',
        projectId: 'proj-other',
      });

      await expect(service.delete('int-1', 'proj-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.analyticsIntegration.delete).not.toHaveBeenCalled();
    });
  });
});
