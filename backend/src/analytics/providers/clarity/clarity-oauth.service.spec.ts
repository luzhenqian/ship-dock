import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClarityOAuthService } from './clarity-oauth.service';

describe('ClarityOAuthService', () => {
  let service: ClarityOAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClarityOAuthService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                MICROSOFT_CLIENT_ID: 'test-ms-client-id',
                MICROSOFT_CLIENT_SECRET: 'test-ms-secret',
                MICROSOFT_REDIRECT_URI: 'http://localhost:4000/api/analytics/callback/microsoft',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ClarityOAuthService);
  });

  describe('getAuthUrl', () => {
    it('should generate a Microsoft OAuth URL with state', async () => {
      const url = await service.getAuthUrl('random-state-456');

      expect(url).toContain('login.microsoftonline.com');
      expect(url).toContain('client_id=test-ms-client-id');
      expect(url).toContain('state=random-state-456');
    });
  });
});
