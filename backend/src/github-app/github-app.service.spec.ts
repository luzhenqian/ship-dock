import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { GitHubAppService } from './github-app.service';
import { PrismaService } from '../common/prisma.service';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

// Generate a real RSA key pair for testing JWT signing
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } =
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
const TEST_PRIVATE_KEY_B64 = Buffer.from(TEST_PRIVATE_KEY).toString('base64');

describe('GitHubAppService', () => {
  let service: GitHubAppService;
  let configService: ConfigService;
  let prismaService: PrismaService;

  const mockRedisGet = jest.fn();
  const mockRedisSet = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GitHubAppService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const values: Record<string, string> = {
                GITHUB_APP_ID: '12345',
                GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY_B64,
                GITHUB_APP_WEBHOOK_SECRET: 'webhook-secret',
                GITHUB_APP_SLUG: 'ship-dock',
              };
              return values[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            gitHubInstallation: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
            project: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { get: mockRedisGet, set: mockRedisSet },
        },
      ],
    }).compile();

    service = module.get(GitHubAppService);
    configService = module.get(ConfigService);
    prismaService = module.get(PrismaService);

    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
  });

  describe('getInstallationUrl', () => {
    it('should return the GitHub App installation URL', () => {
      const url = service.getInstallationUrl();
      expect(url).toBe('https://github.com/apps/ship-dock/installations/new');
    });
  });

  describe('getWebhookSecret', () => {
    it('should return the webhook secret', () => {
      expect(service.getWebhookSecret()).toBe('webhook-secret');
    });
  });

  describe('generateAppJwt', () => {
    it('should generate a valid JWT signed with RS256', () => {
      const token = service.generateAppJwt();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      // Verify the JWT can be decoded and has correct claims
      const decoded = jwt.verify(token, TEST_PUBLIC_KEY, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;
      expect(decoded.iss).toBe('12345');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      // exp should be ~10 minutes after iat
      expect(decoded.exp! - decoded.iat!).toBe(660);
    });
  });

  describe('saveInstallation', () => {
    it('should create a GitHubInstallation record', async () => {
      const mockInstallation = {
        id: 'uuid-1',
        userId: 'user-1',
        installationId: 99,
        accountLogin: 'octocat',
        accountType: 'User',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prismaService.gitHubInstallation.create as jest.Mock).mockResolvedValue(
        mockInstallation,
      );

      const result = await service.saveInstallation(
        'user-1',
        99,
        'octocat',
        'User',
      );
      expect(prismaService.gitHubInstallation.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          installationId: 99,
          accountLogin: 'octocat',
          accountType: 'User',
        },
      });
      expect(result).toEqual(mockInstallation);
    });
  });

  describe('getUserInstallations', () => {
    it('should return installations for a user', async () => {
      const mockInstallations = [
        {
          id: 'uuid-1',
          installationId: 99,
          accountLogin: 'octocat',
          accountType: 'User',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (
        prismaService.gitHubInstallation.findMany as jest.Mock
      ).mockResolvedValue(mockInstallations);

      const result = await service.getUserInstallations('user-1');
      expect(prismaService.gitHubInstallation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockInstallations);
    });
  });

  describe('deleteInstallation', () => {
    it('should delete an installation owned by the user', async () => {
      const mockInstallation = {
        id: 'uuid-1',
        userId: 'user-1',
        installationId: 99,
      };
      (
        prismaService.gitHubInstallation.findFirst as jest.Mock
      ).mockResolvedValue(mockInstallation);
      (
        prismaService.gitHubInstallation.delete as jest.Mock
      ).mockResolvedValue(mockInstallation);

      await service.deleteInstallation('uuid-1', 'user-1');
      expect(prismaService.gitHubInstallation.delete).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should throw NotFoundException if installation not found', async () => {
      (
        prismaService.gitHubInstallation.findFirst as jest.Mock
      ).mockResolvedValue(null);
      await expect(
        service.deleteInstallation('uuid-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleInstallationDeleted', () => {
    it('should delete installation by GitHub installationId', async () => {
      const mockInstallation = { id: 'uuid-1', installationId: 99 };
      (
        prismaService.gitHubInstallation.findUnique as jest.Mock
      ).mockResolvedValue(mockInstallation);
      (
        prismaService.gitHubInstallation.delete as jest.Mock
      ).mockResolvedValue(mockInstallation);

      await service.handleInstallationDeleted(99);
      expect(prismaService.gitHubInstallation.delete).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should do nothing if installation not found', async () => {
      (
        prismaService.gitHubInstallation.findUnique as jest.Mock
      ).mockResolvedValue(null);
      await service.handleInstallationDeleted(99);
      expect(prismaService.gitHubInstallation.delete).not.toHaveBeenCalled();
    });
  });

  describe('findProjectByRepo', () => {
    it('should find project by repo full name', async () => {
      const mockProject = {
        id: 'proj-1',
        repoUrl: 'https://github.com/octocat/hello-world',
      };
      (prismaService.project.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.findProjectByRepo('octocat/hello-world');
      expect(prismaService.project.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { repoUrl: 'https://github.com/octocat/hello-world' },
            { repoUrl: 'https://github.com/octocat/hello-world.git' },
          ],
          githubInstallationId: { not: null },
        },
      });
      expect(result).toEqual(mockProject);
    });
  });

  describe('getInstallationAccessToken', () => {
    it('should return cached token if available', async () => {
      mockRedisGet.mockResolvedValue('cached-token');

      const result = await service.getInstallationAccessToken(99);
      expect(result).toBe('cached-token');
      expect(mockRedisGet).toHaveBeenCalledWith('github:iat:99');
    });

    it('should fetch token from GitHub API on cache miss and store in Redis', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'new-token' }),
      } as Response);

      const result = await service.getInstallationAccessToken(99);

      expect(result).toBe('new-token');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/99/access_tokens',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockRedisSet).toHaveBeenCalledWith(
        'github:iat:99',
        'new-token',
        'EX',
        3300,
      );

      fetchSpy.mockRestore();
    });
  });

  describe('listRepositories', () => {
    it('should return correctly mapped repos for a single page', async () => {
      jest
        .spyOn(service, 'getInstallationAccessToken')
        .mockResolvedValue('test-token');

      const mockRepos = [
        {
          id: 1,
          full_name: 'octocat/hello-world',
          name: 'hello-world',
          private: false,
          default_branch: 'main',
          extra_field: 'should be stripped',
        },
        {
          id: 2,
          full_name: 'octocat/spoon-knife',
          name: 'spoon-knife',
          private: true,
          default_branch: 'master',
        },
      ];

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ repositories: mockRepos }),
      } as Response);

      const result = await service.listRepositories(99);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/installation/repositories?per_page=100&page=1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
      expect(result).toEqual([
        {
          id: 1,
          full_name: 'octocat/hello-world',
          name: 'hello-world',
          private: false,
          default_branch: 'main',
        },
        {
          id: 2,
          full_name: 'octocat/spoon-knife',
          name: 'spoon-knife',
          private: true,
          default_branch: 'master',
        },
      ]);

      fetchSpy.mockRestore();
    });
  });
});
