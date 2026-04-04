import { Test } from '@nestjs/testing';
import { DataMigrationProcessor } from './data-migration.processor';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';

describe('DataMigrationProcessor', () => {
  let processor: DataMigrationProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DataMigrationProcessor,
        {
          provide: PrismaService,
          useValue: {
            dataMigration: { findUnique: jest.fn(), update: jest.fn() },
            dataMigrationTable: { findMany: jest.fn(), update: jest.fn() },
            project: { findUnique: jest.fn() },
          },
        },
        { provide: EncryptionService, useValue: { decrypt: jest.fn((v) => v) } },
        { provide: ConfigService, useValue: { get: () => '/tmp', getOrThrow: () => 'postgresql://u:p@localhost:5432/main' } },
        { provide: DataMigrationGateway, useValue: { emitToMigration: jest.fn() } },
      ],
    }).compile();
    processor = module.get(DataMigrationProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
