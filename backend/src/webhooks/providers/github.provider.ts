import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  ParsedWebhookEvent,
  WebhookProviderInterface,
} from './webhook-provider.interface';

export class GitHubProvider implements WebhookProviderInterface {
  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) throw new BadRequestException('Invalid GitHub URL');
    return { owner: match[1], repo: match[2] };
  }

  async registerWebhook(
    repoUrl: string,
    callbackUrl: string,
    secret: string,
    events: string[],
    token: string,
  ): Promise<{ webhookId: number }> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ShipDock',
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events,
          config: {
            url: callbackUrl,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      },
    );
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
    const data = await res.json();
    return { webhookId: data.id };
  }

  async updateWebhook(
    repoUrl: string,
    webhookId: number,
    events: string[],
    token: string,
  ): Promise<void> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${webhookId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ShipDock',
        },
        body: JSON.stringify({ events, active: true }),
      },
    );
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
  }

  async deleteWebhook(
    repoUrl: string,
    webhookId: number,
    token: string,
  ): Promise<void> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${webhookId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ShipDock',
        },
      },
    );
    if (!res.ok && res.status !== 404) {
      const err = await res
        .json()
        .catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
  }

  verifySignature(
    payload: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const expected =
      'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parsePayload(event: string, payload: any): ParsedWebhookEvent {
    switch (event) {
      case 'push':
        return {
          branch: payload.ref?.replace('refs/heads/', '') || null,
          commitHash: payload.after || null,
          changedFiles: (payload.commits || []).flatMap((c: any) => [
            ...(c.added || []),
            ...(c.modified || []),
            ...(c.removed || []),
          ]),
          sender: payload.pusher?.name || 'unknown',
          message: payload.head_commit?.message || '',
        };
      case 'pull_request':
        return {
          branch: payload.pull_request?.base?.ref || null,
          commitHash: payload.pull_request?.merge_commit_sha || null,
          changedFiles: [],
          sender: payload.sender?.login || 'unknown',
          message: payload.pull_request?.title || '',
        };
      case 'release':
        return {
          branch: payload.release?.target_commitish || null,
          commitHash: null,
          changedFiles: [],
          sender: payload.sender?.login || 'unknown',
          message:
            payload.release?.name || payload.release?.tag_name || '',
        };
      default:
        return {
          branch: null,
          commitHash: null,
          changedFiles: [],
          sender: 'unknown',
          message: '',
        };
    }
  }
}
