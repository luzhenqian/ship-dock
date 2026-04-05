import { Test, TestingModule } from '@nestjs/testing';
import { ClarityAdminService } from './clarity-admin.service';
import { ConnectionsService } from '../../connections/connections.service';

describe('ClarityAdminService', () => {
  let service: ClarityAdminService;

  const mockConnectionsService = {
    getDecryptedTokens: jest.fn().mockResolvedValue({
      accessToken: 'test-ms-token',
      refreshToken: '',
      tokenExpiry: new Date(Date.now() + 3600000),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClarityAdminService,
        { provide: ConnectionsService, useValue: mockConnectionsService },
      ],
    }).compile();

    service = module.get(ClarityAdminService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
