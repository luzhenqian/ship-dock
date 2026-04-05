import { Injectable } from '@nestjs/common';
import { ConnectionsService } from '../../connections/connections.service';

const CLARITY_API_BASE = 'https://www.clarity.ms/api/v1';

@Injectable()
export class ClarityAdminService {
  constructor(private connectionsService: ConnectionsService) {}

  private async getAccessToken(connectionId: string): Promise<string> {
    const { accessToken } =
      await this.connectionsService.getDecryptedTokens(connectionId);
    return accessToken;
  }

  async listProjects(connectionId: string) {
    const token = await this.getAccessToken(connectionId);
    const res = await fetch(`${CLARITY_API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Clarity API error: ${res.status}`);
    return res.json();
  }

  async createProject(connectionId: string, name: string, siteUrl: string) {
    const token = await this.getAccessToken(connectionId);
    const res = await fetch(`${CLARITY_API_BASE}/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, url: siteUrl }),
    });
    if (!res.ok) throw new Error(`Clarity API error: ${res.status}`);
    return res.json();
  }
}
