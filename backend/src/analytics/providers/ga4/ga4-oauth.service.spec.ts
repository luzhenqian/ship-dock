import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Ga4OAuthService } from './ga4-oauth.service';

describe('Ga4OAuthService', () => {
  let service: Ga4OAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4OAuthService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                GOOGLE_CLIENT_ID: 'test-client-id',
                GOOGLE_CLIENT_SECRET: 'test-client-secret',
                GOOGLE_REDIRECT_URI: 'http://localhost:4000/api/analytics/callback/google',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(Ga4OAuthService);
  });

  describe('getAuthUrl', () => {
    it('should generate a Google OAuth URL with correct scopes and state', () => {
      const url = service.getAuthUrl('random-state-123');

      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('state=random-state-123');
      expect(url).toContain('access_type=offline');
      expect(url).toContain(encodeURIComponent('analytics.edit'));
      expect(url).toContain(encodeURIComponent('analytics.readonly'));
    });
  });
});
