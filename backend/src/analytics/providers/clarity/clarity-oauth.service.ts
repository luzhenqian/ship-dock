import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConfidentialClientApplication,
  AuthorizationUrlRequest,
  AuthorizationCodeRequest,
} from '@azure/msal-node';

@Injectable()
export class ClarityOAuthService {
  private msalClient: ConfidentialClientApplication | null = null;
  private redirectUri: string = '';

  constructor(private config: ConfigService) {
    const clientId = this.config.get('MICROSOFT_CLIENT_ID');
    const clientSecret = this.config.get('MICROSOFT_CLIENT_SECRET');
    const redirectUri = this.config.get('MICROSOFT_REDIRECT_URI');
    if (clientId && clientSecret && redirectUri) {
      this.redirectUri = redirectUri;
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId,
          clientSecret,
          authority: 'https://login.microsoftonline.com/common',
        },
      });
    }
  }

  private ensureClient() {
    if (!this.msalClient) {
      throw new Error('Microsoft Clarity is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI.');
    }
    return this.msalClient;
  }

  async getAuthUrl(state: string): Promise<string> {
    const authUrlParams: AuthorizationUrlRequest = {
      scopes: ['User.Read', 'openid', 'profile', 'email'],
      redirectUri: this.redirectUri,
      state,
    };
    return this.ensureClient().getAuthCodeUrl(authUrlParams);
  }

  async exchangeCode(code: string) {
    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: ['User.Read', 'openid', 'profile', 'email'],
      redirectUri: this.redirectUri,
    };
    const response = await this.ensureClient().acquireTokenByCode(tokenRequest);

    return {
      accessToken: response.accessToken,
      refreshToken: '',
      tokenExpiry: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      accountEmail: response.account?.username || '',
      accountId: response.account?.homeAccountId || undefined,
    };
  }
}
