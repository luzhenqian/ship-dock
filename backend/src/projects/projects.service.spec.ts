import { Test } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { PortAllocationService } from './port-allocation.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: any;
  let encryption: any;
  let portAllocation: any;

  beforeEach(async () => {
    prisma = {
      project: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      deployment: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
    };
    encryption = { encrypt: jest.fn((v: string) => 'enc:' + v), decrypt: jest.fn((v: string) => v.replace('enc:', '')) };
    portAllocation = { allocate: jest.fn().mockResolvedValue(3001), allocateSpecific: jest.fn().mockResolvedValue(3050), release: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: PortAllocationService, useValue: portAllocation },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  describe('create', () => {
    it('creates a project with auto-assigned port and default pipeline', async () => {
      prisma.project.create.mockResolvedValue({ id: '1', name: 'My App', slug: 'my-app', port: 3001 });
      const result = await service.create('user-1', { name: 'My App', slug: 'my-app', sourceType: 'GITHUB', repoUrl: 'https://github.com/user/repo' });
      expect(portAllocation.allocate).toHaveBeenCalled();
      expect(result.port).toBe(3001);
    });

    it('uses specific port when provided', async () => {
      prisma.project.create.mockResolvedValue({ id: '1', name: 'My App', slug: 'my-app', port: 3050 });
      await service.create('user-1', { name: 'My App', slug: 'my-app', sourceType: 'GITHUB', port: 3050 });
      expect(portAllocation.allocateSpecific).toHaveBeenCalledWith(expect.any(String), 3050);
    });

    it('encrypts env vars before storing', async () => {
      prisma.project.create.mockImplementation(({ data }: any) => ({ id: '1', ...data }));
      await service.create('user-1', { name: 'My App', slug: 'my-app', sourceType: 'GITHUB', envVars: { DB_HOST: 'localhost' } });
      expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify({ DB_HOST: 'localhost' }));
    });
  });

  describe('delete', () => {
    it('releases port and deletes project', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: '1', slug: 'my-app' });
      prisma.project.delete.mockResolvedValue({ id: '1' });
      await service.delete('1');
      expect(portAllocation.release).toHaveBeenCalledWith('1');
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });
});
