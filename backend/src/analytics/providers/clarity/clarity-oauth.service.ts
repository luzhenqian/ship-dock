import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConfidentialClientApplication,
  AuthorizationUrlRequest,
  AuthorizationCodeRequest,
} from '@azure/msal-node';

@Injectable()
export class ClarityOAuthService {
  private msalClient: ConfidentialClientApplication;
  private redirectUri: string;

  constructor(private config: ConfigService) {
    this.redirectUri = this.config.getOrThrow('MICROSOFT_REDIRECT_URI');
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: this.config.getOrThrow('MICROSOFT_CLIENT_ID'),
        clientSecret: this.config.getOrThrow('MICROSOFT_CLIENT_SECRET'),
        authority: 'https://login.microsoftonline.com/common',
      },
    });
  }

  async getAuthUrl(state: string): Promise<string> {
    const authUrlParams: AuthorizationUrlRequest = {
      scopes: ['User.Read', 'openid', 'profile', 'email'],
      redirectUri: this.redirectUri,
      state,
    };
    return this.msalClient.getAuthCodeUrl(authUrlParams);
  }

  async exchangeCode(code: string) {
    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: ['User.Read', 'openid', 'profile', 'email'],
      redirectUri: this.redirectUri,
    };
    const response = await this.msalClient.acquireTokenByCode(tokenRequest);

    return {
      accessToken: response.accessToken,
      refreshToken: '',
      tokenExpiry: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      accountEmail: response.account?.username || '',
      accountId: response.account?.homeAccountId || undefined,
    };
  }
}
