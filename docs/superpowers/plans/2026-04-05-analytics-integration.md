# Analytics Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add centralized analytics tracking management (GA4 deep + Clarity lightweight) to Ship Dock, allowing users to OAuth-connect Google/Microsoft accounts at user level and associate GA4 properties / Clarity projects at project level, with a custom GA4 report builder.

**Architecture:** Backend proxy model — all Google/Microsoft API calls go through NestJS backend. OAuth tokens encrypted with existing EncryptionService (AES-256-CBC). Redis caching for GA4 reports. Frontend uses React Query + recharts for the report builder.

**Tech Stack:** NestJS 11, Prisma, googleapis (GA4 Admin + Data API), @azure/msal-node (Microsoft OAuth), recharts (frontend charts), existing EncryptionService, Redis (ioredis), React Query, react-hook-form + Zod.

**Spec:** `docs/superpowers/specs/2026-04-05-analytics-integration-design.md`

---

### Task 1: Prisma Schema — Add Analytics Models

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add AnalyticsProvider enum and AnalyticsConnection model**

Add after the `NginxConfig` model at the end of the schema:

```prisma
enum AnalyticsProvider {
  GOOGLE_GA4
  MICROSOFT_CLARITY
}

model AnalyticsConnection {
  id           String            @id @default(uuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     AnalyticsProvider
  accessToken  String
  refreshToken String
  tokenExpiry  DateTime
  accountEmail String
  accountId    String?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  integrations AnalyticsIntegration[]

  @@unique([userId, provider, accountEmail])
}

model AnalyticsIntegration {
  id                  String              @id @default(uuid())
  projectId           String
  project             Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  connectionId        String
  connection          AnalyticsConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  provider            AnalyticsProvider
  ga4PropertyId       String?
  ga4StreamId         String?
  measurementId       String?
  clarityProjectId    String?
  clarityTrackingCode String?
  enabled             Boolean             @default(true)
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  @@unique([projectId, provider])
  @@index([connectionId])
}
```

- [ ] **Step 2: Add relations to existing User and Project models**

In the `User` model, add after the `dataMigrations` field:

```prisma
  analyticsConnections AnalyticsConnection[]
```

In the `Project` model, add after the `nginxConfig` field:

```prisma
  analyticsIntegrations AnalyticsIntegration[]
```

- [ ] **Step 3: Generate and run migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add-analytics-models
```

Expected: Migration created and applied successfully. Prisma client regenerated.

- [ ] **Step 4: Verify Prisma client generation**

Run:
```bash
cd backend && npx prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/
git commit -m "feat(analytics): add AnalyticsConnection and AnalyticsIntegration Prisma models"
```

---

### Task 2: Install Backend Dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install googleapis and Microsoft auth packages**

```bash
cd backend && npm install googleapis @azure/msal-node ioredis
```

Note: `ioredis` is already installed but listed for clarity. `googleapis` provides GA4 Admin API and Data API clients. `@azure/msal-node` handles Microsoft OAuth 2.0 for Clarity.

- [ ] **Step 2: Verify installation**

Run:
```bash
cd backend && node -e "require('googleapis'); require('@azure/msal-node'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat(analytics): add googleapis and msal-node dependencies"
```

---

### Task 3: Analytics Module Scaffold + OAuth Connections CRUD

**Files:**
- Create: `backend/src/analytics/analytics.module.ts`
- Create: `backend/src/analytics/connections/connections.controller.ts`
- Create: `backend/src/analytics/connections/connections.service.ts`
- Create: `backend/src/analytics/connections/connections.service.spec.ts`
- Create: `backend/src/analytics/dto/analytics-connection.dto.ts`
- Modify: `backend/src/app.module.ts` (import AnalyticsModule)

- [ ] **Step 1: Write the connections service test**

Create `backend/src/analytics/connections/connections.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionsService } from './connections.service';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { NotFoundException } from '@nestjs/common';

describe('ConnectionsService', () => {
  let service: ConnectionsService;
  let prisma: PrismaService;
  let encryption: EncryptionService;

  const mockPrisma = {
    analyticsConnection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    mask: jest.fn((v: string) => '****' + v.slice(-4)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();

    service = module.get(ConnectionsService);
    prisma = module.get(PrismaService);
    encryption = module.get(EncryptionService);
    jest.clearAllMocks();
  });

  describe('findAllByUser', () => {
    it('should return connections with masked tokens', async () => {
      mockPrisma.analyticsConnection.findMany.mockResolvedValue([
        {
          id: '1',
          userId: 'user1',
          provider: 'GOOGLE_GA4',
          accessToken: 'enc:access123',
          refreshToken: 'enc:refresh123',
          tokenExpiry: new Date('2026-01-01'),
          accountEmail: 'test@gmail.com',
          accountId: '123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.findAllByUser('user1');

      expect(result).toHaveLength(1);
      expect(result[0].accessToken).toBeUndefined();
      expect(result[0].refreshToken).toBeUndefined();
      expect(result[0].accountEmail).toBe('test@gmail.com');
      expect(mockPrisma.analyticsConnection.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('deleteConnection', () => {
    it('should delete a connection owned by the user', async () => {
      mockPrisma.analyticsConnection.findUnique.mockResolvedValue({
        id: '1',
        userId: 'user1',
      });
      mockPrisma.analyticsConnection.delete.mockResolvedValue({ id: '1' });

      await service.deleteConnection('1', 'user1');

      expect(mockPrisma.analyticsConnection.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw if connection not found or not owned', async () => {
      mockPrisma.analyticsConnection.findUnique.mockResolvedValue(null);

      await expect(service.deleteConnection('1', 'user1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('saveConnection', () => {
    it('should encrypt tokens before saving', async () => {
      mockPrisma.analyticsConnection.create.mockResolvedValue({ id: '1' });

      await service.saveConnection({
        userId: 'user1',
        provider: 'GOOGLE_GA4',
        accessToken: 'myAccessToken',
        refreshToken: 'myRefreshToken',
        tokenExpiry: new Date('2026-01-01'),
        accountEmail: 'test@gmail.com',
        accountId: '123',
      });

      expect(mockEncryption.encrypt).toHaveBeenCalledWith('myAccessToken');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('myRefreshToken');
      expect(mockPrisma.analyticsConnection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accessToken: 'enc:myAccessToken',
          refreshToken: 'enc:myRefreshToken',
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=connections.service.spec --no-coverage`

Expected: FAIL — `Cannot find module './connections.service'`

- [ ] **Step 3: Implement ConnectionsService**

Create `backend/src/analytics/connections/connections.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { AnalyticsProvider } from '@prisma/client';

export interface SaveConnectionInput {
  userId: string;
  provider: AnalyticsProvider;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  accountEmail: string;
  accountId?: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async findAllByUser(userId: string) {
    const connections = await this.prisma.analyticsConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map(({ accessToken, refreshToken, ...rest }) => rest);
  }

  async findById(id: string) {
    return this.prisma.analyticsConnection.findUnique({ where: { id } });
  }

  async getDecryptedTokens(id: string) {
    const conn = await this.prisma.analyticsConnection.findUnique({
      where: { id },
    });
    if (!conn) throw new NotFoundException('Connection not found');

    return {
      accessToken: this.encryption.decrypt(conn.accessToken),
      refreshToken: this.encryption.decrypt(conn.refreshToken),
      tokenExpiry: conn.tokenExpiry,
    };
  }

  async saveConnection(input: SaveConnectionInput) {
    return this.prisma.analyticsConnection.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        accessToken: this.encryption.encrypt(input.accessToken),
        refreshToken: this.encryption.encrypt(input.refreshToken),
        tokenExpiry: input.tokenExpiry,
        accountEmail: input.accountEmail,
        accountId: input.accountId,
      },
    });
  }

  async updateTokens(
    id: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiry: Date,
  ) {
    return this.prisma.analyticsConnection.update({
      where: { id },
      data: {
        accessToken: this.encryption.encrypt(accessToken),
        refreshToken: this.encryption.encrypt(refreshToken),
        tokenExpiry,
      },
    });
  }

  async deleteConnection(id: string, userId: string) {
    const conn = await this.prisma.analyticsConnection.findUnique({
      where: { id },
    });
    if (!conn || conn.userId !== userId) {
      throw new NotFoundException('Connection not found');
    }

    return this.prisma.analyticsConnection.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=connections.service.spec --no-coverage`

Expected: All 3 tests PASS

- [ ] **Step 5: Create DTOs**

Create `backend/src/analytics/dto/analytics-connection.dto.ts`:

```typescript
import { IsEnum, IsString } from 'class-validator';
import { AnalyticsProvider } from '@prisma/client';

export class ConnectProviderDto {
  @IsEnum(AnalyticsProvider)
  provider: AnalyticsProvider;
}
```

- [ ] **Step 6: Create ConnectionsController**

Create `backend/src/analytics/connections/connections.controller.ts`:

```typescript
import {
  Controller,
  Delete,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';

@Controller('analytics/connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private connectionsService: ConnectionsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.connectionsService.findAllByUser(req.user.id);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }
}
```

- [ ] **Step 7: Create AnalyticsModule and register in AppModule**

Create `backend/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class AnalyticsModule {}
```

In `backend/src/app.module.ts`, add import:

```typescript
import { AnalyticsModule } from './analytics/analytics.module';
```

Add `AnalyticsModule` to the `imports` array.

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/ backend/src/app.module.ts
git commit -m "feat(analytics): add ConnectionsService with encrypted token storage and CRUD"
```

---

### Task 4: Google OAuth Flow

**Files:**
- Create: `backend/src/analytics/providers/ga4/ga4-oauth.service.ts`
- Create: `backend/src/analytics/providers/ga4/ga4-oauth.service.spec.ts`
- Modify: `backend/src/analytics/connections/connections.controller.ts` (add OAuth routes)
- Modify: `backend/src/analytics/analytics.module.ts` (register provider)

- [ ] **Step 1: Write the GA4 OAuth service test**

Create `backend/src/analytics/providers/ga4/ga4-oauth.service.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=ga4-oauth.service.spec --no-coverage`

Expected: FAIL — `Cannot find module './ga4-oauth.service'`

- [ ] **Step 3: Implement Ga4OAuthService**

Create `backend/src/analytics/providers/ga4/ga4-oauth.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

@Injectable()
export class Ga4OAuthService {
  private oauth2Client;

  constructor(private config: ConfigService) {
    this.oauth2Client = new google.auth.OAuth2(
      this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      this.config.getOrThrow('GOOGLE_REDIRECT_URI'),
    );
  }

  getAuthUrl(state: string): string {
    return this.oauth2Client.generateAuthUrl({
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
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
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
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.oauth2Client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token || refreshToken,
      tokenExpiry: new Date(credentials.expiry_date!),
    };
  }

  getAuthClient(accessToken: string) {
    const client = new google.auth.OAuth2(
      this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
    );
    client.setCredentials({ access_token: accessToken });
    return client;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=ga4-oauth.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Add OAuth routes to ConnectionsController**

Update `backend/src/analytics/connections/connections.controller.ts` — add these imports and methods:

```typescript
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';
import { Ga4OAuthService } from '../providers/ga4/ga4-oauth.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  private redis: Redis;

  constructor(
    private connectionsService: ConnectionsService,
    private ga4OAuth: Ga4OAuthService,
    private config: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
    });
  }

  @Get('connections')
  findAll(@Req() req: any) {
    return this.connectionsService.findAllByUser(req.user.id);
  }

  @Delete('connections/:id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }

  @Get('connect/google')
  async connectGoogle(@Req() req: any, @Res() res: Response) {
    const state = randomUUID();
    await this.redis.set(
      `oauth:state:${state}`,
      req.user.id,
      'EX',
      600,
    );
    const url = this.ga4OAuth.getAuthUrl(state);
    res.redirect(url);
  }

  @Get('callback/google')
  async callbackGoogle(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const userId = await this.redis.get(`oauth:state:${state}`);
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.del(`oauth:state:${state}`);

    const tokens = await this.ga4OAuth.exchangeCode(code);

    await this.connectionsService.saveConnection({
      userId,
      provider: 'GOOGLE_GA4',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      accountEmail: tokens.accountEmail,
      accountId: tokens.accountId,
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    res.redirect(`${frontendUrl}/settings/analytics?connected=google`);
  }
}
```

- [ ] **Step 6: Register Ga4OAuthService in AnalyticsModule**

Update `backend/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, Ga4OAuthService],
  exports: [ConnectionsService, Ga4OAuthService],
})
export class AnalyticsModule {}
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add Google OAuth flow with state validation and token storage"
```

---

### Task 5: Microsoft OAuth Flow (Clarity)

**Files:**
- Create: `backend/src/analytics/providers/clarity/clarity-oauth.service.ts`
- Create: `backend/src/analytics/providers/clarity/clarity-oauth.service.spec.ts`
- Modify: `backend/src/analytics/connections/connections.controller.ts` (add Microsoft routes)
- Modify: `backend/src/analytics/analytics.module.ts`

- [ ] **Step 1: Write the Clarity OAuth service test**

Create `backend/src/analytics/providers/clarity/clarity-oauth.service.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=clarity-oauth.service.spec --no-coverage`

Expected: FAIL — `Cannot find module './clarity-oauth.service'`

- [ ] **Step 3: Implement ClarityOAuthService**

Create `backend/src/analytics/providers/clarity/clarity-oauth.service.ts`:

```typescript
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
      refreshToken: '', // MSAL handles refresh internally via cache
      tokenExpiry: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      accountEmail: response.account?.username || '',
      accountId: response.account?.homeAccountId || undefined,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=clarity-oauth.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Add Microsoft OAuth routes to ConnectionsController**

Add to `backend/src/analytics/connections/connections.controller.ts`:

Import `ClarityOAuthService`:
```typescript
import { ClarityOAuthService } from '../providers/clarity/clarity-oauth.service';
```

Add to constructor:
```typescript
constructor(
  private connectionsService: ConnectionsService,
  private ga4OAuth: Ga4OAuthService,
  private clarityOAuth: ClarityOAuthService,
  private config: ConfigService,
) { ... }
```

Add methods:
```typescript
  @Get('connect/microsoft')
  async connectMicrosoft(@Req() req: any, @Res() res: Response) {
    const state = randomUUID();
    await this.redis.set(
      `oauth:state:${state}`,
      req.user.id,
      'EX',
      600,
    );
    const url = await this.clarityOAuth.getAuthUrl(state);
    res.redirect(url);
  }

  @Get('callback/microsoft')
  async callbackMicrosoft(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const userId = await this.redis.get(`oauth:state:${state}`);
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.del(`oauth:state:${state}`);

    const tokens = await this.clarityOAuth.exchangeCode(code);

    await this.connectionsService.saveConnection({
      userId,
      provider: 'MICROSOFT_CLARITY',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      accountEmail: tokens.accountEmail,
      accountId: tokens.accountId,
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    res.redirect(`${frontendUrl}/settings/analytics?connected=microsoft`);
  }
```

- [ ] **Step 6: Register ClarityOAuthService in AnalyticsModule**

Update `backend/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';
import { ClarityOAuthService } from './providers/clarity/clarity-oauth.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, Ga4OAuthService, ClarityOAuthService],
  exports: [ConnectionsService, Ga4OAuthService, ClarityOAuthService],
})
export class AnalyticsModule {}
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add Microsoft OAuth flow for Clarity integration"
```

---

### Task 6: GA4 Admin Service (Accounts, Properties, Streams)

**Files:**
- Create: `backend/src/analytics/providers/ga4/ga4-admin.service.ts`
- Create: `backend/src/analytics/providers/ga4/ga4-admin.service.spec.ts`
- Create: `backend/src/analytics/providers/ga4/ga4-admin.controller.ts`
- Create: `backend/src/analytics/dto/ga4.dto.ts`
- Modify: `backend/src/analytics/analytics.module.ts`

- [ ] **Step 1: Write GA4 Admin service test**

Create `backend/src/analytics/providers/ga4/ga4-admin.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Ga4AdminService } from './ga4-admin.service';
import { Ga4OAuthService } from './ga4-oauth.service';
import { ConnectionsService } from '../../connections/connections.service';

describe('Ga4AdminService', () => {
  let service: Ga4AdminService;

  const mockConnectionsService = {
    getDecryptedTokens: jest.fn().mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      tokenExpiry: new Date(Date.now() + 3600000),
    }),
  };

  const mockGa4OAuth = {
    getAuthClient: jest.fn().mockReturnValue({}),
    refreshAccessToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4AdminService,
        { provide: ConnectionsService, useValue: mockConnectionsService },
        { provide: Ga4OAuthService, useValue: mockGa4OAuth },
      ],
    }).compile();

    service = module.get(Ga4AdminService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should get decrypted tokens for a connection', async () => {
    await service.getAuthClientForConnection('conn-1');
    expect(mockConnectionsService.getDecryptedTokens).toHaveBeenCalledWith('conn-1');
    expect(mockGa4OAuth.getAuthClient).toHaveBeenCalledWith('test-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=ga4-admin.service.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement Ga4AdminService**

Create `backend/src/analytics/providers/ga4/ga4-admin.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { google, analyticsadmin_v1beta } from 'googleapis';
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
    const admin = google.analyticsadmin({
      version: 'v1beta',
      auth,
    });
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
    return {
      name: data.name,
      displayName: data.displayName,
    };
  }

  async listDataStreams(connectionId: string, propertyId: string) {
    const auth = await this.getAuthClientForConnection(connectionId);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await admin.properties.dataStreams.list({
      parent: propertyId,
    });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=ga4-admin.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Create GA4 DTOs**

Create `backend/src/analytics/dto/ga4.dto.ts`:

```typescript
import { IsString, IsOptional } from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  connectionId: string;

  @IsString()
  accountId: string;

  @IsString()
  displayName: string;

  @IsString()
  @IsOptional()
  timeZone?: string = 'America/New_York';

  @IsString()
  @IsOptional()
  currencyCode?: string = 'USD';
}

export class CreateDataStreamDto {
  @IsString()
  connectionId: string;

  @IsString()
  propertyId: string;

  @IsString()
  displayName: string;

  @IsString()
  defaultUri: string;
}
```

- [ ] **Step 6: Create GA4 Admin Controller**

Create `backend/src/analytics/providers/ga4/ga4-admin.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Ga4AdminService } from './ga4-admin.service';
import { CreatePropertyDto, CreateDataStreamDto } from '../../dto/ga4.dto';

@Controller('analytics/ga4')
@UseGuards(JwtAuthGuard)
export class Ga4AdminController {
  constructor(private ga4Admin: Ga4AdminService) {}

  @Get('accounts')
  listAccounts(@Query('connectionId') connectionId: string) {
    return this.ga4Admin.listAccounts(connectionId);
  }

  @Get('properties')
  listProperties(
    @Query('connectionId') connectionId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.ga4Admin.listProperties(connectionId, accountId);
  }

  @Post('properties')
  createProperty(@Body() dto: CreatePropertyDto) {
    return this.ga4Admin.createProperty(
      dto.connectionId,
      dto.accountId,
      dto.displayName,
      dto.timeZone,
      dto.currencyCode,
    );
  }

  @Get('streams')
  listStreams(
    @Query('connectionId') connectionId: string,
    @Query('propertyId') propertyId: string,
  ) {
    return this.ga4Admin.listDataStreams(connectionId, propertyId);
  }

  @Post('streams')
  createStream(@Body() dto: CreateDataStreamDto) {
    return this.ga4Admin.createDataStream(
      dto.connectionId,
      dto.propertyId,
      dto.displayName,
      dto.defaultUri,
    );
  }
}
```

- [ ] **Step 7: Register in AnalyticsModule**

Update `backend/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';
import { Ga4AdminService } from './providers/ga4/ga4-admin.service';
import { Ga4AdminController } from './providers/ga4/ga4-admin.controller';
import { ClarityOAuthService } from './providers/clarity/clarity-oauth.service';

@Module({
  controllers: [ConnectionsController, Ga4AdminController],
  providers: [
    ConnectionsService,
    Ga4OAuthService,
    Ga4AdminService,
    ClarityOAuthService,
  ],
  exports: [ConnectionsService, Ga4OAuthService, Ga4AdminService, ClarityOAuthService],
})
export class AnalyticsModule {}
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add GA4 Admin service for accounts, properties, and data streams"
```

---

### Task 7: Clarity Admin Service

**Files:**
- Create: `backend/src/analytics/providers/clarity/clarity-admin.service.ts`
- Create: `backend/src/analytics/providers/clarity/clarity-admin.service.spec.ts`
- Create: `backend/src/analytics/providers/clarity/clarity-admin.controller.ts`
- Create: `backend/src/analytics/dto/clarity.dto.ts`
- Modify: `backend/src/analytics/analytics.module.ts`

- [ ] **Step 1: Write Clarity Admin service test**

Create `backend/src/analytics/providers/clarity/clarity-admin.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ClarityAdminService } from './clarity-admin.service';
import { ConnectionsService } from '../../connections/connections.service';

describe('ClarityAdminService', () => {
  let service: ClarityAdminService;

  const mockConnectionsService = {
    getDecryptedTokens: jest.fn().mockResolvedValue({
      accessToken: 'test-ms-token',
      refreshToken: '',
      tokenExpiry: new Date(Date.now() + 3600000),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClarityAdminService,
        { provide: ConnectionsService, useValue: mockConnectionsService },
      ],
    }).compile();

    service = module.get(ClarityAdminService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=clarity-admin.service.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement ClarityAdminService**

Create `backend/src/analytics/providers/clarity/clarity-admin.service.ts`:

```typescript
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

  async createProject(
    connectionId: string,
    name: string,
    siteUrl: string,
  ) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=clarity-admin.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Create Clarity DTO**

Create `backend/src/analytics/dto/clarity.dto.ts`:

```typescript
import { IsString } from 'class-validator';

export class CreateClarityProjectDto {
  @IsString()
  connectionId: string;

  @IsString()
  name: string;

  @IsString()
  siteUrl: string;
}
```

- [ ] **Step 6: Create Clarity Admin Controller**

Create `backend/src/analytics/providers/clarity/clarity-admin.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ClarityAdminService } from './clarity-admin.service';
import { CreateClarityProjectDto } from '../../dto/clarity.dto';

@Controller('analytics/clarity')
@UseGuards(JwtAuthGuard)
export class ClarityAdminController {
  constructor(private clarityAdmin: ClarityAdminService) {}

  @Get('projects')
  listProjects(@Query('connectionId') connectionId: string) {
    return this.clarityAdmin.listProjects(connectionId);
  }

  @Post('projects')
  createProject(@Body() dto: CreateClarityProjectDto) {
    return this.clarityAdmin.createProject(
      dto.connectionId,
      dto.name,
      dto.siteUrl,
    );
  }
}
```

- [ ] **Step 7: Register in AnalyticsModule**

Update `backend/src/analytics/analytics.module.ts` — add imports for `ClarityAdminService`, `ClarityAdminController` and add them to `controllers` and `providers` arrays.

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add Clarity admin service for project management"
```

---

### Task 8: Project Integrations CRUD

**Files:**
- Create: `backend/src/analytics/integrations/integrations.service.ts`
- Create: `backend/src/analytics/integrations/integrations.service.spec.ts`
- Create: `backend/src/analytics/integrations/integrations.controller.ts`
- Create: `backend/src/analytics/dto/integration.dto.ts`
- Modify: `backend/src/analytics/analytics.module.ts`

- [ ] **Step 1: Write integrations service test**

Create `backend/src/analytics/integrations/integrations.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../../common/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  const mockPrisma = {
    analyticsIntegration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(IntegrationsService);
    jest.clearAllMocks();
  });

  describe('findByProject', () => {
    it('should return integrations for a project', async () => {
      const integrations = [
        { id: '1', projectId: 'proj1', provider: 'GOOGLE_GA4', measurementId: 'G-123' },
      ];
      mockPrisma.analyticsIntegration.findMany.mockResolvedValue(integrations);

      const result = await service.findByProject('proj1');

      expect(result).toEqual(integrations);
      expect(mockPrisma.analyticsIntegration.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj1' },
        include: { connection: { select: { accountEmail: true, provider: true } } },
      });
    });
  });

  describe('create', () => {
    it('should throw ConflictException if provider already linked', async () => {
      mockPrisma.analyticsIntegration.findFirst.mockResolvedValue({ id: '1' });

      await expect(
        service.create({
          projectId: 'proj1',
          connectionId: 'conn1',
          provider: 'GOOGLE_GA4',
          ga4PropertyId: 'properties/123',
          ga4StreamId: 'dataStreams/456',
          measurementId: 'G-123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create integration if provider not yet linked', async () => {
      mockPrisma.analyticsIntegration.findFirst.mockResolvedValue(null);
      mockPrisma.analyticsIntegration.create.mockResolvedValue({ id: '1' });

      const result = await service.create({
        projectId: 'proj1',
        connectionId: 'conn1',
        provider: 'GOOGLE_GA4',
        ga4PropertyId: 'properties/123',
        ga4StreamId: 'dataStreams/456',
        measurementId: 'G-123',
      });

      expect(mockPrisma.analyticsIntegration.create).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if integration does not exist', async () => {
      mockPrisma.analyticsIntegration.findUnique.mockResolvedValue(null);

      await expect(service.delete('1', 'proj1')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=integrations.service.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement IntegrationsService**

Create `backend/src/analytics/integrations/integrations.service.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AnalyticsProvider } from '@prisma/client';

export interface CreateIntegrationInput {
  projectId: string;
  connectionId: string;
  provider: AnalyticsProvider;
  ga4PropertyId?: string;
  ga4StreamId?: string;
  measurementId?: string;
  clarityProjectId?: string;
  clarityTrackingCode?: string;
}

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.analyticsIntegration.findMany({
      where: { projectId },
      include: {
        connection: { select: { accountEmail: true, provider: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.analyticsIntegration.findUnique({ where: { id } });
  }

  async create(input: CreateIntegrationInput) {
    const existing = await this.prisma.analyticsIntegration.findFirst({
      where: { projectId: input.projectId, provider: input.provider },
    });
    if (existing) {
      throw new ConflictException(
        `Project already has a ${input.provider} integration`,
      );
    }

    return this.prisma.analyticsIntegration.create({
      data: {
        projectId: input.projectId,
        connectionId: input.connectionId,
        provider: input.provider,
        ga4PropertyId: input.ga4PropertyId,
        ga4StreamId: input.ga4StreamId,
        measurementId: input.measurementId,
        clarityProjectId: input.clarityProjectId,
        clarityTrackingCode: input.clarityTrackingCode,
      },
    });
  }

  async update(
    id: string,
    data: Partial<Omit<CreateIntegrationInput, 'projectId' | 'provider'>>,
  ) {
    return this.prisma.analyticsIntegration.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, projectId: string) {
    const integration = await this.prisma.analyticsIntegration.findUnique({
      where: { id },
    });
    if (!integration || integration.projectId !== projectId) {
      throw new NotFoundException('Integration not found');
    }
    return this.prisma.analyticsIntegration.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=integrations.service.spec --no-coverage`

Expected: All 4 tests PASS

- [ ] **Step 5: Create Integration DTO**

Create `backend/src/analytics/dto/integration.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { AnalyticsProvider } from '@prisma/client';

export class CreateIntegrationDto {
  @IsString()
  connectionId: string;

  @IsEnum(AnalyticsProvider)
  provider: AnalyticsProvider;

  @IsString()
  @IsOptional()
  ga4PropertyId?: string;

  @IsString()
  @IsOptional()
  ga4StreamId?: string;

  @IsString()
  @IsOptional()
  measurementId?: string;

  @IsString()
  @IsOptional()
  clarityProjectId?: string;

  @IsString()
  @IsOptional()
  clarityTrackingCode?: string;
}

export class UpdateIntegrationDto {
  @IsString()
  @IsOptional()
  connectionId?: string;

  @IsString()
  @IsOptional()
  ga4PropertyId?: string;

  @IsString()
  @IsOptional()
  ga4StreamId?: string;

  @IsString()
  @IsOptional()
  measurementId?: string;

  @IsString()
  @IsOptional()
  clarityProjectId?: string;

  @IsString()
  @IsOptional()
  clarityTrackingCode?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
```

- [ ] **Step 6: Create IntegrationsController**

Create `backend/src/analytics/integrations/integrations.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MinRole } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, UpdateIntegrationDto } from '../dto/integration.dto';

@Controller('analytics/integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  @Get(':projectId')
  findByProject(@Param('projectId') projectId: string) {
    return this.integrationsService.findByProject(projectId);
  }

  @Post(':projectId')
  @MinRole('ADMIN')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    return this.integrationsService.create({ projectId, ...dto });
  }

  @Put(':projectId/:id')
  @MinRole('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrationsService.update(id, dto);
  }

  @Delete(':projectId/:id')
  @MinRole('ADMIN')
  delete(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ) {
    return this.integrationsService.delete(id, projectId);
  }
}
```

- [ ] **Step 7: Register in AnalyticsModule**

Update `backend/src/analytics/analytics.module.ts` — add `IntegrationsService`, `IntegrationsController` to the module.

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add project integrations CRUD with conflict detection"
```

---

### Task 9: GA4 Data (Reports) Service with Redis Caching

**Files:**
- Create: `backend/src/analytics/providers/ga4/ga4-data.service.ts`
- Create: `backend/src/analytics/providers/ga4/ga4-data.service.spec.ts`
- Create: `backend/src/analytics/dto/ga4-report.dto.ts`
- Modify: `backend/src/analytics/integrations/integrations.controller.ts` (add reports endpoint)
- Modify: `backend/src/analytics/analytics.module.ts`

- [ ] **Step 1: Write GA4 Data service test**

Create `backend/src/analytics/providers/ga4/ga4-data.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Ga4DataService } from './ga4-data.service';
import { Ga4AdminService } from './ga4-admin.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

describe('Ga4DataService', () => {
  let service: Ga4DataService;

  const mockGa4Admin = {
    getAuthClientForConnection: jest.fn().mockResolvedValue({}),
  };

  const mockConfig = {
    get: jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = {
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
      };
      return map[key] ?? def;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4DataService,
        { provide: Ga4AdminService, useValue: mockGa4Admin },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(Ga4DataService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildCacheKey', () => {
    it('should generate deterministic cache key from query params', () => {
      const key1 = service.buildCacheKey('properties/123', {
        dimensions: ['date'],
        metrics: ['activeUsers'],
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      const key2 = service.buildCacheKey('properties/123', {
        dimensions: ['date'],
        metrics: ['activeUsers'],
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      expect(key1).toBe(key2);
      expect(key1).toContain('ga4:report:properties/123:');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=ga4-data.service.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement Ga4DataService**

Create `backend/src/analytics/providers/ga4/ga4-data.service.ts`:

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { Ga4AdminService } from './ga4-admin.service';

export interface ReportQuery {
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  limit?: number;
}

@Injectable()
export class Ga4DataService implements OnModuleDestroy {
  private redis: Redis;

  constructor(
    private ga4Admin: Ga4AdminService,
    private config: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
    });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  buildCacheKey(propertyId: string, query: ReportQuery): string {
    const hash = createHash('md5')
      .update(JSON.stringify(query))
      .digest('hex');
    return `ga4:report:${propertyId}:${hash}`;
  }

  async runReport(
    connectionId: string,
    propertyId: string,
    query: ReportQuery,
  ) {
    const cacheKey = this.buildCacheKey(propertyId, query);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const auth = await this.ga4Admin.getAuthClientForConnection(connectionId);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const { data } = await analyticsData.properties.runReport({
      property: propertyId,
      requestBody: {
        dimensions: query.dimensions.map((name) => ({ name })),
        metrics: query.metrics.map((name) => ({ name })),
        dateRanges: [
          { startDate: query.startDate, endDate: query.endDate },
        ],
        limit: query.limit || 10000,
      },
    });

    const result = {
      dimensionHeaders: (data.dimensionHeaders || []).map((h) => h.name),
      metricHeaders: (data.metricHeaders || []).map((h) => ({
        name: h.name,
        type: h.type,
      })),
      rows: (data.rows || []).map((row) => ({
        dimensions: (row.dimensionValues || []).map((v) => v.value),
        metrics: (row.metricValues || []).map((v) => v.value),
      })),
      rowCount: data.rowCount || 0,
    };

    // Cache for 5 minutes
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300);

    return result;
  }

  async runRealtimeReport(connectionId: string, propertyId: string) {
    const cacheKey = `ga4:realtime:${propertyId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const auth = await this.ga4Admin.getAuthClientForConnection(connectionId);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const { data } = await analyticsData.properties.runRealtimeReport({
      property: propertyId,
      requestBody: {
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
      },
    });

    const result = {
      rows: (data.rows || []).map((row) => ({
        dimensions: (row.dimensionValues || []).map((v) => v.value),
        metrics: (row.metricValues || []).map((v) => v.value),
      })),
      rowCount: data.rowCount || 0,
    };

    // Cache for 30 seconds
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);

    return result;
  }

  getAvailableDimensions(): { name: string; description: string }[] {
    return [
      { name: 'date', description: 'Date' },
      { name: 'country', description: 'Country' },
      { name: 'city', description: 'City' },
      { name: 'deviceCategory', description: 'Device Category' },
      { name: 'browser', description: 'Browser' },
      { name: 'operatingSystem', description: 'Operating System' },
      { name: 'sessionSource', description: 'Traffic Source' },
      { name: 'sessionMedium', description: 'Traffic Medium' },
      { name: 'sessionCampaignName', description: 'Campaign' },
      { name: 'pagePath', description: 'Page Path' },
      { name: 'pageTitle', description: 'Page Title' },
      { name: 'language', description: 'Language' },
      { name: 'screenResolution', description: 'Screen Resolution' },
      { name: 'firstUserSource', description: 'First User Source' },
    ];
  }

  getAvailableMetrics(): { name: string; description: string }[] {
    return [
      { name: 'activeUsers', description: 'Active Users' },
      { name: 'newUsers', description: 'New Users' },
      { name: 'totalUsers', description: 'Total Users' },
      { name: 'sessions', description: 'Sessions' },
      { name: 'sessionsPerUser', description: 'Sessions per User' },
      { name: 'screenPageViews', description: 'Page Views' },
      { name: 'screenPageViewsPerSession', description: 'Pages per Session' },
      { name: 'averageSessionDuration', description: 'Avg Session Duration' },
      { name: 'bounceRate', description: 'Bounce Rate' },
      { name: 'engagementRate', description: 'Engagement Rate' },
      { name: 'engagedSessions', description: 'Engaged Sessions' },
      { name: 'eventCount', description: 'Event Count' },
      { name: 'conversions', description: 'Conversions' },
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=ga4-data.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Create Report DTO**

Create `backend/src/analytics/dto/ga4-report.dto.ts`:

```typescript
import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class RunReportDto {
  @IsArray()
  @IsString({ each: true })
  dimensions: string[];

  @IsArray()
  @IsString({ each: true })
  metrics: string[];

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsInt()
  @IsOptional()
  limit?: number;
}
```

- [ ] **Step 6: Add reports endpoint to IntegrationsController**

Update `backend/src/analytics/integrations/integrations.controller.ts` — add:

```typescript
import { Ga4DataService } from '../providers/ga4/ga4-data.service';
import { IntegrationsService } from './integrations.service';
import { RunReportDto } from '../dto/ga4-report.dto';

// Add to constructor:
constructor(
  private integrationsService: IntegrationsService,
  private ga4Data: Ga4DataService,
) {}

// Add these methods:
@Post(':projectId/reports')
async runReport(
  @Param('projectId') projectId: string,
  @Body() dto: RunReportDto,
) {
  const integrations = await this.integrationsService.findByProject(projectId);
  const ga4 = integrations.find((i) => i.provider === 'GOOGLE_GA4');
  if (!ga4) throw new NotFoundException('No GA4 integration for this project');

  return this.ga4Data.runReport(ga4.connectionId, ga4.ga4PropertyId, dto);
}

@Get(':projectId/realtime')
async realtimeReport(@Param('projectId') projectId: string) {
  const integrations = await this.integrationsService.findByProject(projectId);
  const ga4 = integrations.find((i) => i.provider === 'GOOGLE_GA4');
  if (!ga4) throw new NotFoundException('No GA4 integration for this project');

  return this.ga4Data.runRealtimeReport(ga4.connectionId, ga4.ga4PropertyId);
}
```

Add two static endpoints to `Ga4AdminController`:

```typescript
@Get('dimensions')
getDimensions() {
  return this.ga4Data.getAvailableDimensions();
}

@Get('metrics')
getMetrics() {
  return this.ga4Data.getAvailableMetrics();
}
```

Note: inject `Ga4DataService` in `Ga4AdminController` constructor.

- [ ] **Step 7: Register Ga4DataService in AnalyticsModule**

Add `Ga4DataService` to `providers` and `exports` arrays.

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/
git commit -m "feat(analytics): add GA4 Data service with custom reports and Redis caching"
```

---

### Task 10: Install Frontend Dependencies (recharts)

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install recharts**

```bash
cd frontend && npm install recharts
```

- [ ] **Step 2: Verify installation**

```bash
cd frontend && node -e "require('recharts'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(analytics): add recharts dependency for GA4 report charts"
```

---

### Task 11: Frontend — React Query Hooks for Analytics

**Files:**
- Create: `frontend/src/hooks/use-analytics.ts`

- [ ] **Step 1: Create analytics hooks**

Create `frontend/src/hooks/use-analytics.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// === Connections ===

export function useAnalyticsConnections() {
  return useQuery({
    queryKey: ['analytics', 'connections'],
    queryFn: () => api('/analytics/connections'),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/analytics/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['analytics', 'connections'] }),
  });
}

// === GA4 Admin ===

export function useGa4Accounts(connectionId: string | null) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'accounts', connectionId],
    queryFn: () => api(`/analytics/ga4/accounts?connectionId=${connectionId}`),
    enabled: !!connectionId,
  });
}

export function useGa4Properties(
  connectionId: string | null,
  accountId: string | null,
) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'properties', connectionId, accountId],
    queryFn: () =>
      api(
        `/analytics/ga4/properties?connectionId=${connectionId}&accountId=${accountId}`,
      ),
    enabled: !!connectionId && !!accountId,
  });
}

export function useGa4Streams(
  connectionId: string | null,
  propertyId: string | null,
) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'streams', connectionId, propertyId],
    queryFn: () =>
      api(
        `/analytics/ga4/streams?connectionId=${connectionId}&propertyId=${propertyId}`,
      ),
    enabled: !!connectionId && !!propertyId,
  });
}

export function useCreateGa4Property() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      accountId: string;
      displayName: string;
      timeZone?: string;
      currencyCode?: string;
    }) =>
      api('/analytics/ga4/properties', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useCreateGa4Stream() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      propertyId: string;
      displayName: string;
      defaultUri: string;
    }) =>
      api('/analytics/ga4/streams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

// === Clarity Admin ===

export function useClarityProjects(connectionId: string | null) {
  return useQuery({
    queryKey: ['analytics', 'clarity', 'projects', connectionId],
    queryFn: () =>
      api(`/analytics/clarity/projects?connectionId=${connectionId}`),
    enabled: !!connectionId,
  });
}

export function useCreateClarityProject() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      name: string;
      siteUrl: string;
    }) =>
      api('/analytics/clarity/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

// === Integrations ===

export function useProjectIntegrations(projectId: string) {
  return useQuery({
    queryKey: ['analytics', 'integrations', projectId],
    queryFn: () => api(`/analytics/integrations/${projectId}`),
  });
}

export function useCreateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      ...data
    }: {
      projectId: string;
      connectionId: string;
      provider: string;
      ga4PropertyId?: string;
      ga4StreamId?: string;
      measurementId?: string;
      clarityProjectId?: string;
      clarityTrackingCode?: string;
    }) =>
      api(`/analytics/integrations/${projectId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({
        queryKey: ['analytics', 'integrations', variables.projectId],
      }),
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      integrationId,
    }: {
      projectId: string;
      integrationId: string;
    }) =>
      api(`/analytics/integrations/${projectId}/${integrationId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({
        queryKey: ['analytics', 'integrations', variables.projectId],
      }),
  });
}

// === GA4 Reports ===

export function useGa4Dimensions() {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'dimensions'],
    queryFn: () => api('/analytics/ga4/dimensions'),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
  });
}

export function useGa4Metrics() {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'metrics'],
    queryFn: () => api('/analytics/ga4/metrics'),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useRunReport() {
  return useMutation({
    mutationFn: ({
      projectId,
      ...query
    }: {
      projectId: string;
      dimensions: string[];
      metrics: string[];
      startDate: string;
      endDate: string;
      limit?: number;
    }) =>
      api(`/analytics/integrations/${projectId}/reports`, {
        method: 'POST',
        body: JSON.stringify(query),
      }),
  });
}

export function useRealtimeReport(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'realtime', projectId],
    queryFn: () => api(`/analytics/integrations/${projectId}/realtime`),
    enabled,
    refetchInterval: 30000, // 30 seconds
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-analytics.ts
git commit -m "feat(analytics): add React Query hooks for analytics API"
```

---

### Task 12: Frontend — Settings > Analytics Page (OAuth Connections)

**Files:**
- Create: `frontend/src/app/(app)/settings/analytics/page.tsx`

- [ ] **Step 1: Create the settings analytics page**

Create `frontend/src/app/(app)/settings/analytics/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useAnalyticsConnections,
  useDeleteConnection,
} from '@/hooks/use-analytics';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function getProviderLabel(provider: string) {
  return provider === 'GOOGLE_GA4' ? 'Google Analytics' : 'Microsoft Clarity';
}

function getProviderIcon(provider: string) {
  return provider === 'GOOGLE_GA4' ? '🔵' : '🟢';
}

export default function SettingsAnalyticsPage() {
  const { data: connections, isLoading } = useAnalyticsConnections();
  const deleteConnection = useDeleteConnection();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function handleConnect(provider: 'google' | 'microsoft') {
    const token = localStorage.getItem('access_token');
    window.location.href = `${API_URL}/analytics/connect/${provider}?token=${token}`;
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteConnection.mutateAsync(deleteId);
      toast.success('Connection removed');
    } catch (err: any) {
      toast.error(err.message);
    }
    setDeleteId(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics Connections</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Google and Microsoft accounts to manage analytics tracking.
        </p>
      </div>

      <div className="flex gap-3">
        <Button onClick={() => handleConnect('google')}>
          Connect Google Account
        </Button>
        <Button variant="outline" onClick={() => handleConnect('microsoft')}>
          Connect Microsoft Account
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : connections?.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No accounts connected yet. Connect a Google or Microsoft account to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections?.map((conn: any) => (
            <Card key={conn.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{getProviderIcon(conn.provider)}</span>
                  {getProviderLabel(conn.provider)}
                  <Badge variant="secondary">{conn.accountEmail}</Badge>
                  {new Date(conn.tokenExpiry) < new Date() && (
                    <Badge variant="destructive">Expired</Badge>
                  )}
                </CardTitle>
                <CardAction>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteId(conn.id)}
                  >
                    Disconnect
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(conn.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Disconnect Account"
        description="This will remove the connection and any project integrations using this account."
        onConfirm={handleDelete}
        confirmLabel="Disconnect"
        destructive
      />
    </div>
  );
}
```

- [ ] **Step 2: Add Analytics link to Settings navigation**

In `frontend/src/app/(app)/settings/` layout or nav component (follow existing pattern), add a link to `/settings/analytics`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/settings/analytics/
git commit -m "feat(analytics): add Settings > Analytics connections page"
```

---

### Task 13: Frontend — Project Analytics Overview Page

**Files:**
- Create: `frontend/src/app/projects/[id]/analytics/page.tsx`

- [ ] **Step 1: Create the project analytics overview page**

Create `frontend/src/app/projects/[id]/analytics/page.tsx`:

```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useProjectIntegrations, useDeleteIntegration } from '@/hooks/use-analytics';
import { toast } from 'sonner';

export default function ProjectAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { data: integrations, isLoading } = useProjectIntegrations(projectId);
  const deleteIntegration = useDeleteIntegration();

  const ga4 = integrations?.find((i: any) => i.provider === 'GOOGLE_GA4');
  const clarity = integrations?.find(
    (i: any) => i.provider === 'MICROSOFT_CLARITY',
  );

  async function handleRemove(integrationId: string) {
    try {
      await deleteIntegration.mutateAsync({ projectId, integrationId });
      toast.success('Integration removed');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <Link href={`/projects/${projectId}/analytics/setup`}>
          <Button>Set Up Integration</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* GA4 Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Analytics (GA4)</CardTitle>
            {ga4 && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(ga4.id)}
                >
                  Remove
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {ga4 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>{ga4.measurementId}</Badge>
                  <span className="text-xs text-muted-foreground">
                    via {ga4.connection?.accountEmail}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/projects/${projectId}/analytics/reports`}>
                    <Button size="sm">View Reports</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not configured.{' '}
                <Link
                  href={`/projects/${projectId}/analytics/setup`}
                  className="underline"
                >
                  Set up GA4
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Clarity Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Microsoft Clarity</CardTitle>
            {clarity && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(clarity.id)}
                >
                  Remove
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {clarity ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>{clarity.clarityProjectId}</Badge>
                  <span className="text-xs text-muted-foreground">
                    via {clarity.connection?.accountEmail}
                  </span>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`https://clarity.microsoft.com/projects/view/${clarity.clarityProjectId}/dashboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="outline">
                      Open Clarity Dashboard ↗
                    </Button>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not configured.{' '}
                <Link
                  href={`/projects/${projectId}/analytics/setup`}
                  className="underline"
                >
                  Set up Clarity
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Analytics to ProjectSidebar**

In `frontend/src/components/project-sidebar.tsx`, add an "Analytics" group or link. Follow the existing pattern — add it under the "Project" group:

```tsx
{ name: 'Analytics', href: `/projects/${projectId}/analytics`, icon: BarChart3 }
```

Import `BarChart3` from `lucide-react`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/ frontend/src/components/project-sidebar.tsx
git commit -m "feat(analytics): add project analytics overview page and sidebar link"
```

---

### Task 14: Frontend — Analytics Setup Flow

**Files:**
- Create: `frontend/src/app/projects/[id]/analytics/setup/page.tsx`

- [ ] **Step 1: Create the setup page**

Create `frontend/src/app/projects/[id]/analytics/setup/page.tsx`:

```tsx
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  useAnalyticsConnections,
  useGa4Accounts,
  useGa4Properties,
  useGa4Streams,
  useClarityProjects,
  useCreateIntegration,
  useCreateGa4Property,
  useCreateGa4Stream,
  useCreateClarityProject,
} from '@/hooks/use-analytics';

type Step = 'provider' | 'connection' | 'resource' | 'confirm';
type Provider = 'GOOGLE_GA4' | 'MICROSOFT_CLARITY';

export default function AnalyticsSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();

  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [measurementId, setMeasurementId] = useState<string | null>(null);
  const [clarityProjectId, setClarityProjectId] = useState<string | null>(null);
  const [clarityTrackingCode, setClarityTrackingCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // New resource form state
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newStreamName, setNewStreamName] = useState('');
  const [newStreamUri, setNewStreamUri] = useState('');
  const [newClarityName, setNewClarityName] = useState('');
  const [newClarityUrl, setNewClarityUrl] = useState('');

  const { data: connections } = useAnalyticsConnections();
  const { data: accounts } = useGa4Accounts(
    provider === 'GOOGLE_GA4' ? connectionId : null,
  );
  const { data: properties } = useGa4Properties(
    provider === 'GOOGLE_GA4' ? connectionId : null,
    accountId,
  );
  const { data: streams } = useGa4Streams(
    provider === 'GOOGLE_GA4' ? connectionId : null,
    propertyId,
  );
  const { data: clarityProjects } = useClarityProjects(
    provider === 'MICROSOFT_CLARITY' ? connectionId : null,
  );

  const createIntegration = useCreateIntegration();
  const createGa4Property = useCreateGa4Property();
  const createGa4Stream = useCreateGa4Stream();
  const createClarityProject = useCreateClarityProject();

  const filteredConnections = connections?.filter(
    (c: any) => c.provider === provider,
  );

  async function handleConfirm() {
    try {
      if (provider === 'GOOGLE_GA4') {
        await createIntegration.mutateAsync({
          projectId,
          connectionId: connectionId!,
          provider: 'GOOGLE_GA4',
          ga4PropertyId: propertyId!,
          ga4StreamId: streamId || undefined,
          measurementId: measurementId || undefined,
        });
      } else {
        await createIntegration.mutateAsync({
          projectId,
          connectionId: connectionId!,
          provider: 'MICROSOFT_CLARITY',
          clarityProjectId: clarityProjectId!,
          clarityTrackingCode: clarityTrackingCode || undefined,
        });
      }
      toast.success('Integration created');
      router.push(`/projects/${projectId}/analytics`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleCreateGa4Property() {
    if (!newPropertyName || !connectionId || !accountId) return;
    setCreating(true);
    try {
      const result = await createGa4Property.mutateAsync({
        connectionId: connectionId!,
        accountId: accountId!,
        displayName: newPropertyName,
      });
      setPropertyId(result.name);
      setNewPropertyName('');
      toast.success('Property created');
    } catch (err: any) {
      toast.error(err.message);
    }
    setCreating(false);
  }

  async function handleCreateGa4Stream() {
    if (!newStreamName || !newStreamUri || !connectionId || !propertyId) return;
    setCreating(true);
    try {
      const result = await createGa4Stream.mutateAsync({
        connectionId: connectionId!,
        propertyId: propertyId!,
        displayName: newStreamName,
        defaultUri: newStreamUri,
      });
      setStreamId(result.name);
      setMeasurementId(result.measurementId);
      setNewStreamName('');
      setNewStreamUri('');
      toast.success(`Stream created: ${result.measurementId}`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setCreating(false);
  }

  async function handleCreateClarityProject() {
    if (!newClarityName || !newClarityUrl || !connectionId) return;
    setCreating(true);
    try {
      const result = await createClarityProject.mutateAsync({
        connectionId: connectionId!,
        name: newClarityName,
        siteUrl: newClarityUrl,
      });
      setClarityProjectId(result.id);
      setClarityTrackingCode(result.trackingCode);
      setNewClarityName('');
      setNewClarityUrl('');
      toast.success('Clarity project created');
    } catch (err: any) {
      toast.error(err.message);
    }
    setCreating(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Set Up Analytics</h1>

      {/* Step 1: Choose Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose Provider</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            variant={provider === 'GOOGLE_GA4' ? 'default' : 'outline'}
            onClick={() => {
              setProvider('GOOGLE_GA4');
              setStep('connection');
              setConnectionId(null);
              setAccountId(null);
              setPropertyId(null);
            }}
          >
            Google Analytics (GA4)
          </Button>
          <Button
            variant={provider === 'MICROSOFT_CLARITY' ? 'default' : 'outline'}
            onClick={() => {
              setProvider('MICROSOFT_CLARITY');
              setStep('connection');
              setConnectionId(null);
              setClarityProjectId(null);
            }}
          >
            Microsoft Clarity
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Choose Connection */}
      {provider && step !== 'provider' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Choose Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredConnections?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No connected accounts.{' '}
                <a href="/settings/analytics" className="underline">
                  Connect one in Settings
                </a>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filteredConnections?.map((conn: any) => (
                  <Button
                    key={conn.id}
                    variant={connectionId === conn.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setConnectionId(conn.id);
                      setStep('resource');
                    }}
                  >
                    {conn.accountEmail}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Choose or Create Resource */}
      {connectionId && step === 'resource' && provider === 'GOOGLE_GA4' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Choose GA4 Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Account Selection */}
            <div className="space-y-2">
              <Label>Account</Label>
              <div className="flex flex-wrap gap-2">
                {accounts?.map((acc: any) => (
                  <Button
                    key={acc.name}
                    variant={accountId === acc.name ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setAccountId(acc.name);
                      setPropertyId(null);
                      setStreamId(null);
                    }}
                  >
                    {acc.displayName}
                  </Button>
                ))}
              </div>
            </div>

            {/* Property Selection */}
            {accountId && (
              <div className="space-y-2">
                <Label>Property</Label>
                <div className="flex flex-wrap gap-2">
                  {properties?.map((prop: any) => (
                    <Button
                      key={prop.name}
                      variant={propertyId === prop.name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setPropertyId(prop.name);
                        setStreamId(null);
                        setMeasurementId(null);
                      }}
                    >
                      {prop.displayName}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="New property name"
                    value={newPropertyName}
                    onChange={(e) => setNewPropertyName(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newPropertyName || creating}
                    onClick={handleCreateGa4Property}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}

            {/* Stream Selection */}
            {propertyId && (
              <div className="space-y-2">
                <Label>Data Stream</Label>
                <div className="flex flex-wrap gap-2">
                  {streams?.map((s: any) => (
                    <Button
                      key={s.name}
                      variant={streamId === s.name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setStreamId(s.name);
                        setMeasurementId(s.measurementId);
                        setStep('confirm');
                      }}
                    >
                      {s.displayName} ({s.measurementId})
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="Stream name"
                    value={newStreamName}
                    onChange={(e) => setNewStreamName(e.target.value)}
                  />
                  <Input
                    placeholder="https://example.com"
                    value={newStreamUri}
                    onChange={(e) => setNewStreamUri(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newStreamName || !newStreamUri || creating}
                    onClick={handleCreateGa4Stream}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {connectionId && step === 'resource' && provider === 'MICROSOFT_CLARITY' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Choose Clarity Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {clarityProjects?.map((proj: any) => (
                <Button
                  key={proj.id}
                  variant={clarityProjectId === proj.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setClarityProjectId(proj.id);
                    setClarityTrackingCode(proj.trackingCode);
                    setStep('confirm');
                  }}
                >
                  {proj.name}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Project name"
                value={newClarityName}
                onChange={(e) => setNewClarityName(e.target.value)}
              />
              <Input
                placeholder="https://example.com"
                value={newClarityUrl}
                onChange={(e) => setNewClarityUrl(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!newClarityName || !newClarityUrl || creating}
                onClick={handleCreateClarityProject}
              >
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm */}
      {step === 'confirm' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Provider:</span>{' '}
                {provider === 'GOOGLE_GA4' ? 'Google Analytics' : 'Microsoft Clarity'}
              </p>
              {provider === 'GOOGLE_GA4' && (
                <>
                  <p>
                    <span className="text-muted-foreground">Property:</span>{' '}
                    {propertyId}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Measurement ID:</span>{' '}
                    {measurementId || 'N/A'}
                  </p>
                </>
              )}
              {provider === 'MICROSOFT_CLARITY' && (
                <p>
                  <span className="text-muted-foreground">Project ID:</span>{' '}
                  {clarityProjectId}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={createIntegration.isPending}>
                Confirm
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/projects/${projectId}/analytics`)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/
git commit -m "feat(analytics): add analytics setup wizard with provider/account/resource flow"
```

---

### Task 15: Frontend — GA4 Reports Page

**Files:**
- Create: `frontend/src/app/projects/[id]/analytics/reports/page.tsx`

- [ ] **Step 1: Create the reports page**

Create `frontend/src/app/projects/[id]/analytics/reports/page.tsx`:

```tsx
'use client';

import { use, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  useGa4Dimensions,
  useGa4Metrics,
  useRunReport,
} from '@/hooks/use-analytics';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = [
  '#000000', '#666666', '#999999', '#333333',
  '#444444', '#777777', '#aaaaaa', '#555555',
];

function getDateRange(preset: string): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  if (preset === '7d') start.setDate(end.getDate() - 7);
  else if (preset === '30d') start.setDate(end.getDate() - 30);
  else if (preset === '90d') start.setDate(end.getDate() - 90);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function inferChartType(dimensions: string[]): 'line' | 'bar' | 'pie' {
  if (dimensions.includes('date')) return 'line';
  if (dimensions.length === 1) return 'pie';
  return 'bar';
}

export default function Ga4ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);

  const { data: availableDimensions } = useGa4Dimensions();
  const { data: availableMetrics } = useGa4Metrics();
  const runReport = useRunReport();

  const [selectedDimensions, setSelectedDimensions] = useState<string[]>(['date']);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['activeUsers']);
  const [datePreset, setDatePreset] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const reportData = runReport.data;

  function toggleItem(list: string[], item: string, setter: (v: string[]) => void) {
    setter(
      list.includes(item) ? list.filter((i) => i !== item) : [...list, item],
    );
  }

  function handleRunReport() {
    const range =
      datePreset === 'custom'
        ? { startDate: customStart, endDate: customEnd }
        : getDateRange(datePreset);

    runReport.mutate({
      projectId,
      dimensions: selectedDimensions,
      metrics: selectedMetrics,
      ...range,
    });
  }

  // Transform report data for recharts
  function getChartData() {
    if (!reportData?.rows) return [];
    return reportData.rows.map((row: any) => {
      const obj: any = {};
      reportData.dimensionHeaders.forEach((h: string, i: number) => {
        obj[h] = row.dimensions[i];
      });
      reportData.metricHeaders.forEach((h: any, i: number) => {
        obj[h.name] = parseFloat(row.metrics[i]);
      });
      return obj;
    });
  }

  const chartData = getChartData();
  const chartType = inferChartType(selectedDimensions);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">GA4 Reports</h1>

      {/* Query Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range */}
          <div className="space-y-2">
            <Label>Date Range</Label>
            <div className="flex gap-2">
              {['7d', '30d', '90d', 'custom'].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={datePreset === preset ? 'default' : 'outline'}
                  onClick={() => setDatePreset(preset)}
                >
                  {preset === 'custom' ? 'Custom' : preset}
                </Button>
              ))}
            </div>
            {datePreset === 'custom' && (
              <div className="flex gap-2 mt-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Dimensions */}
          <div className="space-y-2">
            <Label>Dimensions</Label>
            <div className="flex flex-wrap gap-1">
              {availableDimensions?.map((d: any) => (
                <Button
                  key={d.name}
                  size="sm"
                  variant={
                    selectedDimensions.includes(d.name) ? 'default' : 'outline'
                  }
                  onClick={() =>
                    toggleItem(selectedDimensions, d.name, setSelectedDimensions)
                  }
                >
                  {d.description}
                </Button>
              ))}
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-2">
            <Label>Metrics</Label>
            <div className="flex flex-wrap gap-1">
              {availableMetrics?.map((m: any) => (
                <Button
                  key={m.name}
                  size="sm"
                  variant={
                    selectedMetrics.includes(m.name) ? 'default' : 'outline'
                  }
                  onClick={() =>
                    toggleItem(selectedMetrics, m.name, setSelectedMetrics)
                  }
                >
                  {m.description}
                </Button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleRunReport}
            disabled={
              runReport.isPending ||
              selectedDimensions.length === 0 ||
              selectedMetrics.length === 0
            }
          >
            {runReport.isPending ? 'Running...' : 'Run Report'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {runReport.isError && (
        <Card>
          <CardContent className="py-4 text-destructive">
            Error: {(runReport.error as Error).message}
          </CardContent>
        </Card>
      )}

      {reportData && (
        <>
          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Chart ({reportData.rowCount} rows)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'line' ? (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={reportData.dimensionHeaders[0]} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {reportData.metricHeaders.map((m: any, i: number) => (
                        <Line
                          key={m.name}
                          type="monotone"
                          dataKey={m.name}
                          stroke={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </LineChart>
                  ) : chartType === 'pie' ? (
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie
                        data={chartData}
                        dataKey={reportData.metricHeaders[0]?.name}
                        nameKey={reportData.dimensionHeaders[0]}
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                      >
                        {chartData.map((_: any, i: number) => (
                          <Cell
                            key={i}
                            fill={COLORS[i % COLORS.length]}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={reportData.dimensionHeaders[0]} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {reportData.metricHeaders.map((m: any, i: number) => (
                        <Bar
                          key={m.name}
                          dataKey={m.name}
                          fill={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Table</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {reportData.dimensionHeaders.map((h: string) => (
                        <th key={h} className="py-2 pr-4 text-left font-medium">
                          {h}
                        </th>
                      ))}
                      {reportData.metricHeaders.map((h: any) => (
                        <th
                          key={h.name}
                          className="py-2 pr-4 text-right font-medium"
                        >
                          {h.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.map((row: any, i: number) => (
                      <tr key={i} className="border-b">
                        {row.dimensions.map((v: string, j: number) => (
                          <td key={j} className="py-2 pr-4">
                            {v}
                          </td>
                        ))}
                        {row.metrics.map((v: string, j: number) => (
                          <td key={j} className="py-2 pr-4 text-right tabular-nums">
                            {parseFloat(v).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/
git commit -m "feat(analytics): add GA4 custom report builder with charts and data table"
```

---

### Task 16: Environment Variables and Configuration

**Files:**
- Modify: `backend/.env.example` (or equivalent)
- Modify: `scripts/deploy.config.example.sh` (if needed)

- [ ] **Step 1: Add env vars to .env.example**

Add these lines to the backend `.env.example`:

```env
# Analytics - Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/analytics/callback/google

# Analytics - Microsoft OAuth
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/analytics/callback/microsoft

# Frontend URL (for OAuth redirect back)
FRONTEND_URL=http://localhost:3000
```

- [ ] **Step 2: Add env vars to actual .env for development**

Update local `.env` with real values (do NOT commit actual secrets).

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "feat(analytics): add Google and Microsoft OAuth env vars to .env.example"
```

---

### Task 17: End-to-End Smoke Test

**Files:** None (manual testing)

- [ ] **Step 1: Start backend**

```bash
cd backend && npm run start:dev
```

Verify: No startup errors, analytics module loaded.

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Verify API endpoints exist**

```bash
curl -s http://localhost:4000/api/analytics/connections -H "Authorization: Bearer <token>" | head
curl -s http://localhost:4000/api/analytics/ga4/dimensions | head
curl -s http://localhost:4000/api/analytics/ga4/metrics | head
```

Expected: JSON responses (may be 401 for auth-required endpoints without token, but routes should exist — not 404).

- [ ] **Step 4: Verify frontend pages render**

Visit:
- `http://localhost:3000/settings/analytics` — should show connections page
- `http://localhost:3000/projects/<id>/analytics` — should show overview with setup CTAs
- `http://localhost:3000/projects/<id>/analytics/reports` — should show report builder

- [ ] **Step 5: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix(analytics): smoke test fixes"
```
