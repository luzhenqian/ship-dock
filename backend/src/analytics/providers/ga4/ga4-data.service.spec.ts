import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Ga4DataService, ReportQuery } from './ga4-data.service';
import { Ga4AdminService } from './ga4-admin.service';

const mockRedisInstance = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => mockRedisInstance);
  (MockRedis as any).default = MockRedis;
  return MockRedis;
});

const mockGa4Admin = {
  getAuthClientForConnection: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: any) => defaultValue),
};

describe('Ga4DataService', () => {
  let service: Ga4DataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4DataService,
        { provide: Ga4AdminService, useValue: mockGa4Admin },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<Ga4DataService>(Ga4DataService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildCacheKey', () => {
    it('generates a deterministic cache key for the same query', () => {
      const query: ReportQuery = {
        dimensions: ['date', 'country'],
        metrics: ['sessions', 'activeUsers'],
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const key1 = service.buildCacheKey('properties/123', query);
      const key2 = service.buildCacheKey('properties/123', query);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^ga4:report:properties\/123:[a-f0-9]{32}$/);
    });

    it('generates different keys for different queries', () => {
      const query1: ReportQuery = {
        dimensions: ['date'],
        metrics: ['sessions'],
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };
      const query2: ReportQuery = {
        dimensions: ['country'],
        metrics: ['activeUsers'],
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const key1 = service.buildCacheKey('properties/123', query1);
      const key2 = service.buildCacheKey('properties/123', query2);

      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different property IDs', () => {
      const query: ReportQuery = {
        dimensions: ['date'],
        metrics: ['sessions'],
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const key1 = service.buildCacheKey('properties/123', query);
      const key2 = service.buildCacheKey('properties/456', query);

      expect(key1).not.toBe(key2);
    });
  });
});
