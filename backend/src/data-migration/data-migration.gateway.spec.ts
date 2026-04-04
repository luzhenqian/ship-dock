import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';

describe('DataMigrationGateway', () => {
  let gateway: DataMigrationGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DataMigrationGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN' }) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-secret' } },
      ],
    }).compile();
    gateway = module.get(DataMigrationGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('emitToMigration does nothing when server is not set', () => {
    expect(() => gateway.emitToMigration('m1', 'progress', {})).not.toThrow();
  });
});
