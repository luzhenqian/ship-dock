import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../common/prisma.service';
import Redis from 'ioredis';

@Injectable()
export class GitHubAppService {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly webhookSecret: string;
  private readonly slug: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {
    this.appId = this.config.getOrThrow('GITHUB_APP_ID');
    this.privateKey = Buffer.from(
      this.config.getOrThrow('GITHUB_APP_PRIVATE_KEY'),
      'base64',
    ).toString('utf8');
    this.webhookSecret = this.config.getOrThrow('GITHUB_APP_WEBHOOK_SECRET');
    this.slug = this.config.getOrThrow('GITHUB_APP_SLUG');
  }

  getInstallationUrl(): string {
    return `https://github.com/apps/${this.slug}/installations/new`;
  }

  getWebhookSecret(): string {
    return this.webhookSecret;
  }

  generateAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iat: now - 60, exp: now + 600, iss: this.appId },
      this.privateKey,
      { algorithm: 'RS256' },
    );
  }

  async getInstallationAccessToken(installationId: number): Promise<string> {
    const cacheKey = `github:iat:${installationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const appJwt = this.generateAppJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to get installation token: ${res.status} ${await res.text()}`,
      );
    }
    const data = await res.json();
    await this.redis.set(cacheKey, data.token, 'EX', 3300); // 55 min TTL
    return data.token;
  }

  async listRepositories(
    installationId: number,
  ): Promise<
    {
      id: number;
      full_name: string;
      name: string;
      private: boolean;
      default_branch: string;
    }[]
  > {
    const token = await this.getInstallationAccessToken(installationId);
    const repos: any[] = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (!res.ok) break;
      const data = await res.json();
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
      page++;
    }

    return repos.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      default_branch: r.default_branch,
    }));
  }

  async saveInstallation(
    userId: string,
    installationId: number,
    accountLogin: string,
    accountType: string,
  ) {
    return this.prisma.gitHubInstallation.create({
      data: { userId, installationId, accountLogin, accountType },
    });
  }

  async getUserInstallations(userId: string) {
    return this.prisma.gitHubInstallation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteInstallation(id: string, userId: string) {
    const installation = await this.prisma.gitHubInstallation.findFirst({
      where: { id, userId },
    });
    if (!installation) throw new NotFoundException('Installation not found');
    return this.prisma.gitHubInstallation.delete({ where: { id } });
  }

  async handleInstallationDeleted(installationId: number) {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { installationId },
    });
    if (!installation) return;
    await this.prisma.gitHubInstallation.delete({
      where: { id: installation.id },
    });
  }

  async findProjectByRepo(repoFullName: string) {
    const repoUrl = `https://github.com/${repoFullName}`;
    return this.prisma.project.findFirst({
      where: {
        OR: [{ repoUrl }, { repoUrl: `${repoUrl}.git` }],
      },
    });
  }
}
