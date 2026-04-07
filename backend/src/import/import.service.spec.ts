import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ImportService } from './import.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { ManifestParser } from './parsers/manifest-parser';
import { JwtService } from '@nestjs/jwt';

describe('ImportService', () => {
  let service: ImportService;
  let prisma: any;
  let jwt: any;
  let queue: any;

  beforeEach(async () => {
    prisma = {
      import: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      importItem: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    jwt = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
    };

    queue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EncryptionService,
          useValue: { encrypt: jest.fn((s) => `enc:${s}`), decrypt: jest.fn((s) => s.replace('enc:', '')) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key, def) => def), getOrThrow: jest.fn().mockReturnValue('test-secret') },
        },
        { provide: ManifestParser, useValue: new ManifestParser() },
        { provide: JwtService, useValue: jwt },
        { provide: getQueueToken('import'), useValue: queue },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
  });

  describe('createUploadToken', () => {
    it('should return a token', async () => {
      const result = await service.createUploadToken();
      expect(result).toEqual({ token: 'mock-token' });
      expect(jwt.signAsync).toHaveBeenCalledWith(
        { scope: 'import' },
        { secret: 'test-secret', expiresIn: '2h' },
      );
    });
  });

  describe('createImport', () => {
    it('should create an import record', async () => {
      const mockImport = { id: 'imp-1', status: 'PENDING', sourceType: 'CLI_PACKAGE', items: [] };
      prisma.import.create.mockResolvedValue(mockImport);
      prisma.import.findUnique.mockResolvedValue(mockImport);

      const result = await service.createImport('user-1', {
        sourceType: 'CLI_PACKAGE',
      });

      expect(prisma.import.create).toHaveBeenCalledWith({
        data: {
          status: 'PENDING',
          sourceType: 'CLI_PACKAGE',
          userId: 'user-1',
        },
      });
      expect(result).toEqual(mockImport);
    });
  });

  describe('getImport', () => {
    it('should return import with items', async () => {
      const mockImport = { id: 'imp-1', items: [{ id: 'item-1' }] };
      prisma.import.findUnique.mockResolvedValue(mockImport);

      const result = await service.getImport('imp-1');
      expect(result).toEqual(mockImport);
      expect(prisma.import.findUnique).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        include: { items: true },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.import.findUnique.mockResolvedValue(null);
      await expect(service.getImport('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('startImport', () => {
    it('should start an import in CONFIGURING status', async () => {
      const mockImport = { id: 'imp-1', status: 'CONFIGURING', items: [] };
      prisma.import.findUnique
        .mockResolvedValueOnce(mockImport)
        .mockResolvedValueOnce({ ...mockImport, status: 'RUNNING' });
      prisma.import.update.mockResolvedValue({ ...mockImport, status: 'RUNNING' });

      const result = await service.startImport('imp-1');

      expect(prisma.import.update).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        data: { status: 'RUNNING' },
      });
      expect(queue.add).toHaveBeenCalledWith('process-import', { importId: 'imp-1' });
    });

    it('should reject starting import in PENDING status', async () => {
      prisma.import.findUnique.mockResolvedValue({ id: 'imp-1', status: 'PENDING' });
      await expect(service.startImport('imp-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if import does not exist', async () => {
      prisma.import.findUnique.mockResolvedValue(null);
      await expect(service.startImport('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelImport', () => {
    it('should cancel import and mark pending items as SKIPPED', async () => {
      const mockImport = {
        id: 'imp-1',
        status: 'RUNNING',
        items: [
          { id: 'item-1', status: 'COMPLETED' },
          { id: 'item-2', status: 'PENDING' },
          { id: 'item-3', status: 'RUNNING' },
        ],
      };
      prisma.import.findUnique
        .mockResolvedValueOnce(mockImport)
        .mockResolvedValueOnce({ ...mockImport, status: 'CANCELLED' });
      prisma.import.update.mockResolvedValue({ ...mockImport, status: 'CANCELLED' });
      prisma.importItem.update.mockResolvedValue({});

      await service.cancelImport('imp-1');

      expect(prisma.import.update).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        data: { status: 'CANCELLED' },
      });
      // item-2 (PENDING) and item-3 (RUNNING) should be marked SKIPPED
      expect(prisma.importItem.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteImport', () => {
    it('should delete an import', async () => {
      prisma.import.findUnique.mockResolvedValue({ id: 'imp-1' });
      prisma.import.delete.mockResolvedValue({});

      const result = await service.deleteImport('imp-1');
      expect(result).toEqual({ deleted: true });
      expect(prisma.import.delete).toHaveBeenCalledWith({ where: { id: 'imp-1' } });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.import.findUnique.mockResolvedValue(null);
      await expect(service.deleteImport('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('parseAndCreateItems', () => {
    it('should create items from manifest and update status', async () => {
      const manifest = {
        version: 1,
        createdAt: '2024-01-01',
        sourceServer: { hostname: 'test', ip: '1.2.3.4' },
        projects: [
          { name: 'proj-1', type: 'node', directory: '/app', command: 'npm start', env: { FOO: 'bar' }, databases: [], redis: [], storage: [], cron: [], data: {} },
          { name: 'proj-2', type: 'node', directory: '/app2', command: 'npm start', env: {}, databases: [], redis: [], storage: [], cron: [], data: {} },
        ],
      };

      prisma.importItem.create.mockResolvedValue({});
      prisma.import.update.mockResolvedValue({});

      await service.parseAndCreateItems('imp-1', manifest);

      expect(prisma.importItem.create).toHaveBeenCalledTimes(2);
      expect(prisma.import.update).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        data: { status: 'CONFIGURING', totalProjects: 2 },
      });
    });
  });
});
