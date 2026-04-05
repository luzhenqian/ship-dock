import { Test, TestingModule } from '@nestjs/testing';
import { Ga4AdminService } from './ga4-admin.service';
import { Ga4OAuthService } from './ga4-oauth.service';
import { ConnectionsService } from '../../connections/connections.service';

describe('Ga4AdminService', () => {
  let service: Ga4AdminService;

  const mockConnectionsService = {
    getDecryptedTokens: jest.fn().mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      tokenExpiry: new Date(Date.now() + 3600000),
    }),
  };

  const mockGa4OAuth = {
    getAuthClient: jest.fn().mockReturnValue({}),
    refreshAccessToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4AdminService,
        { provide: ConnectionsService, useValue: mockConnectionsService },
        { provide: Ga4OAuthService, useValue: mockGa4OAuth },
      ],
    }).compile();

    service = module.get(Ga4AdminService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should get decrypted tokens for a connection', async () => {
    await service.getAuthClientForConnection('conn-1');
    expect(mockConnectionsService.getDecryptedTokens).toHaveBeenCalledWith('conn-1');
    expect(mockGa4OAuth.getAuthClient).toHaveBeenCalledWith('test-token');
  });
});
