import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { ConnectionsService } from '../../connections/connections.service';
import { Ga4OAuthService } from './ga4-oauth.service';

@Injectable()
export class Ga4AdminService {
  constructor(
    private connectionsService: ConnectionsService,
    private ga4OAuth: Ga4OAuthService,
  ) {}

  async getAuthClientForConnection(connectionId: string) {
    const { accessToken, refreshToken, tokenExpiry } =
      await this.connectionsService.getDecryptedTokens(connectionId);

    if (tokenExpiry < new Date(Date.now() + 5 * 60 * 1000)) {
      const refreshed = await this.ga4OAuth.refreshAccessToken(refreshToken);
      await this.connectionsService.updateTokens(
        connectionId,
        refreshed.accessToken,
        refreshed.refreshToken,
        refreshed.tokenExpiry,
      );
      return this.ga4OAuth.getAuthClient(refreshed.accessToken);
    }

    return this.ga4OAuth.getAuthClient(accessToken);
  }

  async listAccounts(connectionId: string) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.accounts.list();
    return (data.accounts || []).map((a) => ({
      name: a.name,
      displayName: a.displayName,
    }));
  }

  async listProperties(connectionId: string, accountId: string) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.properties.list({
      filter: `parent:${accountId}`,
    });
    return (data.properties || []).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      timeZone: p.timeZone,
      currencyCode: p.currencyCode,
    }));
  }

  async createProperty(
    connectionId: string,
    accountId: string,
    displayName: string,
    timeZone: string,
    currencyCode: string,
  ) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.properties.create({
      requestBody: {
        parent: accountId,
        displayName,
        timeZone,
        currencyCode,
      },
    });
    return { name: data.name, displayName: data.displayName };
  }

  async listDataStreams(connectionId: string, propertyId: string) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.properties.dataStreams.list({ parent: propertyId });
    return (data.dataStreams || []).map((s) => ({
      name: s.name,
      displayName: s.displayName,
      type: s.type,
      measurementId: s.webStreamData?.measurementId,
      defaultUri: s.webStreamData?.defaultUri,
    }));
  }

  async createDataStream(
    connectionId: string,
    propertyId: string,
    displayName: string,
    defaultUri: string,
  ) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.properties.dataStreams.create({
      parent: propertyId,
      requestBody: {
        displayName,
        type: 'WEB_DATA_STREAM',
        webStreamData: { defaultUri },
      },
    });
    return {
      name: data.name,
      displayName: data.displayName,
      measurementId: data.webStreamData?.measurementId,
    };
  }
}
