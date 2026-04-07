import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ImportService } from './import.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { ManifestParser } from './parsers/manifest-parser';
import { JwtService } from '@nestjs/jwt';

/**
 * Integration test for the full import flow.
 *
 * Uses ImportService directly with mocked persistence (Prisma),
 * queue (BullMQ), and supporting services. Verifies the end-to-end
 * lifecycle: create -> parse -> configure -> start -> cancel.
 */
describe('ImportService – Integration (full flow)', () => {
  let service: ImportService;
  let prisma: any;
  let queue: any;

  // In-memory stores to simulate persistence across calls
  let importStore: Record<string, any>;
  let itemStore: Record<string, any>;
  let nextItemId: number;

  beforeEach(async () => {
    importStore = {};
    itemStore = {};
    nextItemId = 1;

    prisma = {
      import: {
        create: jest.fn().mockImplementation(({ data }) => {
          const id = `imp-${Date.now()}`;
          const record = { id, ...data, items: [] };
          importStore[id] = record;
          return Promise.resolve(record);
        }),
        findUnique: jest.fn().mockImplementation(({ where, include }) => {
          const record = importStore[where.id] || null;
          if (record && include?.items) {
            return Promise.resolve({
              ...record,
              items: Object.values(itemStore).filter(
                (i: any) => i.importId === where.id,
              ),
            });
          }
          return Promise.resolve(record);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const record = importStore[where.id];
          if (record) {
            Object.assign(record, data);
          }
          return Promise.resolve(record);
        }),
        delete: jest.fn().mockImplementation(({ where }) => {
          delete importStore[where.id];
          return Promise.resolve({});
        }),
      },
      importItem: {
        create: jest.fn().mockImplementation(({ data }) => {
          const id = `item-${nextItemId++}`;
          const record = { id, ...data };
          itemStore[id] = record;
          return Promise.resolve(record);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(itemStore[where.id] || null);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const record = itemStore[where.id];
          if (record) {
            Object.assign(record, data);
          }
          return Promise.resolve(record);
        }),
      },
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
          useValue: {
            encrypt: jest.fn((s) => `enc:${s}`),
            decrypt: jest.fn((s) => s.replace('enc:', '')),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key, def) => def),
            getOrThrow: jest.fn().mockReturnValue('test-secret'),
          },
        },
        { provide: ManifestParser, useValue: new ManifestParser() },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('mock-token') },
        },
        { provide: getQueueToken('import'), useValue: queue },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
  });

  // ---------------------------------------------------------------
  // Full lifecycle: create -> parse -> config -> start -> cancel
  // ---------------------------------------------------------------
  describe('full import lifecycle (CLI_PACKAGE)', () => {
    const manifest = {
      version: 1,
      createdAt: '2024-06-01',
      sourceServer: { hostname: 'prod-1', ip: '10.0.0.1' },
      projects: [
        {
          name: 'api-service',
          type: 'node',
          directory: '/srv/api',
          command: 'npm start',
          env: { NODE_ENV: 'production', DB_URL: 'postgres://...' },
          databases: [],
          redis: [],
          storage: [],
          cron: [],
          data: {},
        },
        {
          name: 'worker',
          type: 'node',
          directory: '/srv/worker',
          command: 'node worker.js',
          env: { QUEUE_URL: 'redis://...' },
          databases: [],
          redis: [],
          storage: [],
          cron: [],
          data: {},
        },
      ],
    };

    it('should complete the full create -> parse -> start -> cancel flow', async () => {
      // Step 1: Create import
      const created = await service.createImport('user-1', {
        sourceType: 'CLI_PACKAGE',
      });

      expect(created).toBeDefined();
      expect(created.sourceType).toBe('CLI_PACKAGE');
      expect(created.status).toBe('PENDING');
      const importId = created.id;

      // Step 2: Parse manifest and create items
      await service.parseAndCreateItems(importId, manifest);

      const afterParse = await service.getImport(importId);
      expect(afterParse.status).toBe('CONFIGURING');
      expect(afterParse.items).toHaveLength(2);
      expect(afterParse.items[0].sourceName).toBe('api-service');
      expect(afterParse.items[1].sourceName).toBe('worker');

      // Verify item configs contain env vars
      expect(afterParse.items[0].config.env).toEqual({
        NODE_ENV: 'production',
        DB_URL: 'postgres://...',
      });

      // Step 3: Submit config for items (update config)
      const item1Id = afterParse.items[0].id;
      const item2Id = afterParse.items[1].id;

      await service.updateConfig(importId, {
        items: [
          {
            itemId: item1Id,
            name: 'api-service',
            slug: 'api-service',
            port: 3001,
            repoUrl: 'https://github.com/org/api.git',
            branch: 'main',
          },
          {
            itemId: item2Id,
            name: 'worker',
            slug: 'worker',
            port: 3002,
          },
        ],
      });

      // Verify config was merged
      const updatedItem = itemStore[item1Id];
      expect(updatedItem.config.slug).toBe('api-service');
      expect(updatedItem.config.port).toBe(3001);
      expect(updatedItem.config.repoUrl).toBe(
        'https://github.com/org/api.git',
      );

      // Step 4: Start import – verify queue job enqueued
      await service.startImport(importId);

      expect(queue.add).toHaveBeenCalledWith('process-import', {
        importId,
      });
      expect(importStore[importId].status).toBe('RUNNING');

      // Step 5: Cancel import – verify pending items marked SKIPPED
      // Reset items to have meaningful statuses for cancel
      itemStore[item1Id].status = 'COMPLETED';
      itemStore[item2Id].status = 'PENDING';

      await service.cancelImport(importId);

      expect(importStore[importId].status).toBe('CANCELLED');
      // item1 was COMPLETED – should remain unchanged
      expect(itemStore[item1Id].status).toBe('COMPLETED');
      // item2 was PENDING – should be marked SKIPPED
      expect(itemStore[item2Id].status).toBe('SKIPPED');
    });
  });

  // ---------------------------------------------------------------
  // REMOTE source type
  // ---------------------------------------------------------------
  describe('createImport – REMOTE type', () => {
    it('should create an import with REMOTE source type', async () => {
      const result = await service.createImport('user-2', {
        sourceType: 'REMOTE',
      });

      expect(result).toBeDefined();
      expect(result.sourceType).toBe('REMOTE');
      expect(result.status).toBe('PENDING');
      expect(prisma.import.create).toHaveBeenCalledWith({
        data: {
          status: 'PENDING',
          sourceType: 'REMOTE',
          userId: 'user-2',
        },
      });
    });
  });

  // ---------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------
  describe('getImport – not found', () => {
    it('should throw NotFoundException for missing import ID', async () => {
      await expect(service.getImport('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('startImport – wrong status', () => {
    it('should throw BadRequestException if status is not CONFIGURING', async () => {
      const created = await service.createImport('user-1', {
        sourceType: 'CLI_PACKAGE',
      });

      // Status is PENDING, not CONFIGURING
      await expect(service.startImport(created.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for RUNNING status', async () => {
      const created = await service.createImport('user-1', {
        sourceType: 'CLI_PACKAGE',
      });
      // Manually set to RUNNING
      importStore[created.id].status = 'RUNNING';

      await expect(service.startImport(created.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for non-existent import', async () => {
      await expect(service.startImport('does-not-exist')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
