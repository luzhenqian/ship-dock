import { Test } from '@nestjs/testing';
import { PortAllocationService } from './port-allocation.service';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('PortAllocationService', () => {
  let service: PortAllocationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      portAllocation: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        PortAllocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string, def: any) => def } },
      ],
    }).compile();
    service = module.get(PortAllocationService);
  });

  describe('allocate', () => {
    it('assigns the first available port', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue({ id: '1', port: 3001, projectId: null });
      prisma.portAllocation.update.mockResolvedValue({ id: '1', port: 3001, projectId: 'proj-1' });
      const port = await service.allocate('proj-1');
      expect(port).toBe(3001);
    });

    it('creates a new allocation if none exist', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue(null);
      prisma.portAllocation.create.mockResolvedValue({ id: '2', port: 3001, projectId: 'proj-1' });
      const port = await service.allocate('proj-1');
      expect(port).toBe(3001);
    });
  });

  describe('allocateSpecific', () => {
    it('assigns a specific port if available', async () => {
      prisma.portAllocation.findUnique.mockResolvedValue(null);
      prisma.portAllocation.create.mockResolvedValue({ id: '3', port: 3050, projectId: 'proj-2' });
      const port = await service.allocateSpecific('proj-2', 3050);
      expect(port).toBe(3050);
    });

    it('throws if port is already taken', async () => {
      prisma.portAllocation.findUnique.mockResolvedValue({ id: '3', port: 3050, projectId: 'proj-other' });
      await expect(service.allocateSpecific('proj-2', 3050)).rejects.toThrow('Port 3050 is already allocated');
    });
  });

  describe('release', () => {
    it('releases a port by projectId', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue({ id: '1', port: 3001, projectId: 'proj-1' });
      prisma.portAllocation.update.mockResolvedValue({ id: '1', port: 3001, projectId: null });
      await service.release('proj-1');
      expect(prisma.portAllocation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { projectId: null, allocatedAt: null } }),
      );
    });
  });
});
