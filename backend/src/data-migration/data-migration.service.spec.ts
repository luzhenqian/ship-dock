import { Test } from '@nestjs/testing';
import { DataMigrationService } from './data-migration.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';

describe('DataMigrationService', () => {
  let service: DataMigrationService;
  let prisma: any;
  let queue: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      dataMigration: {
        create: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'PENDING' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'PENDING' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'CANCELLED' }),
      },
      dataMigrationTable: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', dbName: 'test_db', useLocalDb: true }),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    encryption = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    };

    const module = await Test.createTestingModule({
      providers: [
        DataMigrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('data-migration'), useValue: queue },
        { provide: EncryptionService, useValue: encryption },
        { provide: ConfigService, useValue: { get: () => '/tmp', getOrThrow: () => 'postgresql://u:p@localhost:5432/main' } },
      ],
    }).compile();
    service = module.get(DataMigrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a remote migration and enqueues a job', async () => {
    const result = await service.createMigration('p1', 'u1', {
      source: 'REMOTE',
      connection: { host: 'remote', port: 5432, username: 'user', password: 'pass', database: 'src' },
      tables: [{ tableName: 'users', schemaName: 'public' }],
      conflictStrategy: 'ERROR',
    });
    expect(prisma.dataMigration.create).toHaveBeenCalled();
    expect(prisma.dataMigrationTable.createMany).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('data-migration', expect.objectContaining({ migrationId: 'mig-1' }));
    expect(result.id).toBe('mig-1');
  });

  it('cancels a pending migration', async () => {
    await service.cancelMigration('mig-1');
    expect(prisma.dataMigration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mig-1' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  it('throws if project has no local db', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', useLocalDb: false });
    await expect(service.createMigration('p1', 'u1', {
      source: 'REMOTE',
      connection: { host: 'h', port: 5432, username: 'u', password: 'p', database: 'd' },
      tables: [{ tableName: 't' }],
      conflictStrategy: 'ERROR',
    })).rejects.toThrow();
  });
});
