import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

@Injectable()
export class Ga4OAuthService {
  private oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

  constructor(private config: ConfigService) {
    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.config.get('GOOGLE_REDIRECT_URI');
    if (clientId && clientSecret && redirectUri) {
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }
  }

  private ensureClient() {
    if (!this.oauth2Client) {
      throw new Error('Google Analytics is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.');
    }
    return this.oauth2Client;
  }

  getAuthUrl(state: string): string {
    return this.ensureClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/analytics.edit',
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });
  }

  async exchangeCode(code: string) {
    const client = this.ensureClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      tokenExpiry: new Date(tokens.expiry_date!),
      accountEmail: userInfo.email!,
      accountId: userInfo.id || undefined,
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const client = this.ensureClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token || refreshToken,
      tokenExpiry: new Date(credentials.expiry_date!),
    };
  }

  getAuthClient(accessToken: string) {
    const client = new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
    );
    client.setCredentials({ access_token: accessToken });
    return client;
  }
}
