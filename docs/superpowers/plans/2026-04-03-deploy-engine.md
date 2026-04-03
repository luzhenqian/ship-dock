# Ship Dock Deploy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployment dashboard backend (NestJS) and frontend (Next.js) that deploys Node.js projects to an EC2 instance via a customizable pipeline (PM2 + Nginx + SSL), with auth, RBAC, realtime logs, domain management, and file upload.

**Architecture:** NestJS API runs on EC2 as a PM2 process. BullMQ (Redis) queues deployment jobs. Workers execute pipeline stages (git clone, npm install, prisma migrate, build, pm2, nginx, certbot) via child_process. Socket.io streams logs to the Next.js frontend on Vercel. PostgreSQL (Prisma ORM) stores all data.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, BullMQ, Socket.io, Next.js, shadcn/ui, TanStack Query, React Hook Form, Zod, dnd-kit

---

## File Structure

### Backend (`backend/`)

```
backend/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── prisma/
│   └── schema.prisma
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── encryption.service.ts
│   │   ├── encryption.service.spec.ts
│   │   ├── decorators/
│   │   │   └── roles.decorator.ts
│   │   └── guards/
│   │       ├── jwt-auth.guard.ts
│   │       └── roles.guard.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── auth.service.spec.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.controller.spec.ts
│   │   ├── jwt.strategy.ts
│   │   └── dto/
│   │       ├── login.dto.ts
│   │       ├── setup.dto.ts
│   │       └── invite.dto.ts
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.service.ts
│   │   ├── users.service.spec.ts
│   │   ├── users.controller.ts
│   │   └── users.controller.spec.ts
│   ├── projects/
│   │   ├── projects.module.ts
│   │   ├── projects.service.ts
│   │   ├── projects.service.spec.ts
│   │   ├── projects.controller.ts
│   │   ├── projects.controller.spec.ts
│   │   ├── port-allocation.service.ts
│   │   ├── port-allocation.service.spec.ts
│   │   └── dto/
│   │       ├── create-project.dto.ts
│   │       └── update-project.dto.ts
│   ├── deploy/
│   │   ├── deploy.module.ts
│   │   ├── deploy.service.ts
│   │   ├── deploy.service.spec.ts
│   │   ├── deploy.controller.ts
│   │   ├── deploy.controller.spec.ts
│   │   ├── deploy.processor.ts
│   │   ├── deploy.processor.spec.ts
│   │   ├── deploy.gateway.ts
│   │   ├── deploy.gateway.spec.ts
│   │   └── stages/
│   │       ├── stage-executor.ts
│   │       ├── stage-executor.spec.ts
│   │       ├── clone.stage.ts
│   │       ├── clone.stage.spec.ts
│   │       ├── command.stage.ts
│   │       ├── command.stage.spec.ts
│   │       ├── pm2.stage.ts
│   │       ├── pm2.stage.spec.ts
│   │       ├── nginx.stage.ts
│   │       ├── nginx.stage.spec.ts
│   │       ├── ssl.stage.ts
│   │       └── ssl.stage.spec.ts
│   ├── domains/
│   │   ├── domains.module.ts
│   │   ├── domains.service.ts
│   │   ├── domains.service.spec.ts
│   │   ├── domains.controller.ts
│   │   ├── domains.controller.spec.ts
│   │   ├── providers/
│   │   │   ├── dns-provider.interface.ts
│   │   │   ├── namecheap.provider.ts
│   │   │   ├── namecheap.provider.spec.ts
│   │   │   ├── godaddy.provider.ts
│   │   │   └── godaddy.provider.spec.ts
│   │   └── dto/
│   │       ├── create-provider.dto.ts
│   │       └── dns-record.dto.ts
│   └── upload/
│       ├── upload.module.ts
│       ├── upload.controller.ts
│       └── upload.controller.spec.ts
```

### Frontend (`frontend/`)

```
frontend/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── setup/page.tsx
│   │   ├── invite/[token]/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── projects/
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── deployments/
│   │   │       │   ├── page.tsx
│   │   │       │   └── [did]/page.tsx
│   │   │       ├── settings/page.tsx
│   │   │       └── pipeline/page.tsx
│   │   ├── domains/page.tsx
│   │   ├── team/page.tsx
│   │   └── settings/page.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   ├── auth.ts
│   │   ├── socket.ts
│   │   └── utils.ts
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-projects.ts
│   │   ├── use-deployments.ts
│   │   └── use-deploy-logs.ts
│   └── components/
│       ├── providers.tsx
│       ├── app-sidebar.tsx
│       ├── project-card.tsx
│       ├── deploy-log-viewer.tsx
│       ├── stage-progress.tsx
│       ├── pipeline-editor.tsx
│       ├── env-var-editor.tsx
│       └── new-project-wizard.tsx
```

---

## Task 1: Backend Scaffolding + Prisma Schema

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/nest-cli.json`
- Create: `backend/src/main.ts`, `backend/src/app.module.ts`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/.env.example`

- [ ] **Step 1: Scaffold NestJS project**

```bash
cd /Users/noah/Work/idea/ship-dock
npx @nestjs/cli new backend --package-manager npm --skip-git
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npm install @prisma/client @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt bullmq @nestjs/bullmq @nestjs/platform-socket.io @nestjs/websockets socket.io class-validator class-transformer multer
npm install -D prisma @types/passport-jwt @types/bcrypt @types/multer
```

- [ ] **Step 3: Write Prisma schema**

Create `backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  OWNER
  ADMIN
  DEVELOPER
  VIEWER
}

enum SourceType {
  GITHUB
  UPLOAD
}

enum ProjectStatus {
  ACTIVE
  STOPPED
  ERROR
}

enum DeploymentStatus {
  QUEUED
  RUNNING
  SUCCESS
  FAILED
  CANCELLED
}

enum DnsProvider {
  NAMECHEAP
  GODADDY
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  avatar    String?
  role      Role     @default(VIEWER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  projects    Project[]
  deployments Deployment[]
  providers   DomainProvider[]
  invites     Invite[]
}

model Project {
  id         String        @id @default(uuid())
  name       String
  slug       String        @unique
  repoUrl    String?
  branch     String        @default("main")
  sourceType SourceType
  domain     String?
  port       Int
  envVars    String        @default("")
  pipeline   Json
  pm2Name    String
  status     ProjectStatus @default(ACTIVE)

  createdBy   User   @relation(fields: [createdById], references: [id])
  createdById String

  deployments    Deployment[]
  portAllocation PortAllocation?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Deployment {
  id          String           @id @default(uuid())
  version     Int
  commitHash  String?
  status      DeploymentStatus @default(QUEUED)
  stages      Json             @default("[]")
  startedAt   DateTime?
  finishedAt  DateTime?

  project     Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String

  triggeredBy   User   @relation(fields: [triggeredById], references: [id])
  triggeredById String

  createdAt DateTime @default(now())

  @@index([projectId, version])
}

model DomainProvider {
  id        String      @id @default(uuid())
  provider  DnsProvider
  apiKey    String
  apiSecret String

  createdBy   User   @relation(fields: [createdById], references: [id])
  createdById String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model PortAllocation {
  id          String   @id @default(uuid())
  port        Int      @unique
  project     Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  projectId   String?  @unique
  allocatedAt DateTime?
}

model Invite {
  id        String   @id @default(uuid())
  token     String   @unique @default(uuid())
  email     String?
  role      Role     @default(DEVELOPER)
  usedAt    DateTime?
  expiresAt DateTime

  createdBy   User   @relation(fields: [createdById], references: [id])
  createdById String

  createdAt DateTime @default(now())
}
```

- [ ] **Step 4: Create .env.example**

Create `backend/.env.example`:

```
DATABASE_URL="postgresql://user:password@localhost:5432/ship_dock"
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=change-me-to-a-random-string
JWT_REFRESH_SECRET=change-me-to-another-random-string
ENCRYPTION_KEY=32-byte-hex-string-for-aes-256
PORT=4000
PROJECTS_DIR=/var/www
```

- [ ] **Step 5: Configure AppModule with ConfigModule and BullMQ**

Replace `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Configure main.ts with validation pipe and CORS**

Replace `backend/src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT || 4000);
}
bootstrap();
```

- [ ] **Step 7: Generate Prisma client and run migration**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx prisma generate
npx prisma migrate dev --name init
```

- [ ] **Step 8: Verify the app starts**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npm run start:dev
```

Expected: NestJS app starts on port 4000 with no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: scaffold NestJS backend with Prisma schema"
```

---

## Task 2: Encryption Service

**Files:**
- Create: `backend/src/common/encryption.service.ts`
- Create: `backend/src/common/encryption.service.spec.ts`
- Create: `backend/src/common/common.module.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/common/encryption.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'a'.repeat(64), // 32 bytes hex
          },
        },
      ],
    }).compile();
    service = module.get(EncryptionService);
  });

  it('encrypts and decrypts a string', () => {
    const plaintext = '{"DB_HOST":"localhost","DB_PASS":"secret123"}';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'hello';
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('masks a string showing last 4 chars', () => {
    expect(service.mask('abcdefgh1234')).toBe('****1234');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=encryption.service.spec --no-cache
```

Expected: FAIL — cannot find module `./encryption.service`.

- [ ] **Step 3: Implement EncryptionService**

Create `backend/src/common/encryption.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private config: ConfigService) {
    this.key = Buffer.from(this.config.getOrThrow<string>('ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  decrypt(ciphertext: string): string {
    const [ivHex, encHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  mask(value: string): string {
    if (value.length <= 4) return '****';
    return '****' + value.slice(-4);
  }
}
```

- [ ] **Step 4: Create CommonModule**

Create `backend/src/common/common.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CommonModule {}
```

Add `CommonModule` to `AppModule` imports.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=encryption.service.spec --no-cache
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/
git commit -m "feat: add AES-256 encryption service"
```

---

## Task 3: Auth Module — JWT + Login + Setup

**Files:**
- Create: `backend/src/auth/auth.module.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/jwt.strategy.ts`
- Create: `backend/src/auth/dto/login.dto.ts`, `backend/src/auth/dto/setup.dto.ts`
- Create: `backend/src/auth/auth.service.spec.ts`, `backend/src/auth/auth.controller.spec.ts`
- Create: `backend/src/common/prisma.service.ts`

- [ ] **Step 1: Create PrismaService**

Create `backend/src/common/prisma.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

Add `PrismaService` to `CommonModule` providers and exports.

- [ ] **Step 2: Create DTOs**

Create `backend/src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

Create `backend/src/auth/dto/setup.dto.ts`:

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SetupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;
}
```

- [ ] **Step 3: Write failing auth service test**

Create `backend/src/auth/auth.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock } };
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('mock-token') };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const map: Record<string, string> = {
                JWT_SECRET: 'test-secret',
                JWT_REFRESH_SECRET: 'test-refresh-secret',
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('setup', () => {
    it('creates the first OWNER user when no users exist', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({
        id: '1',
        email: 'admin@test.com',
        name: 'Admin',
        role: 'OWNER',
      });

      const result = await service.setup({
        email: 'admin@test.com',
        password: 'password123',
        name: 'Admin',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'admin@test.com',
            role: 'OWNER',
          }),
        }),
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('throws if users already exist', async () => {
      prisma.user.count.mockResolvedValue(1);
      await expect(
        service.setup({ email: 'a@b.com', password: '12345678', name: 'X' }),
      ).rejects.toThrow('Setup already completed');
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'admin@test.com',
        password: hash,
        role: 'OWNER',
      });

      const result = await service.login({
        email: 'admin@test.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'admin@test.com',
        password: hash,
        role: 'OWNER',
      });

      await expect(
        service.login({ email: 'admin@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'no@one.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=auth.service.spec --no-cache
```

Expected: FAIL — cannot find `./auth.service`.

- [ ] **Step 5: Implement AuthService**

Create `backend/src/auth/auth.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { LoginDto } from './dto/login.dto';
import { SetupDto } from './dto/setup.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async setup(dto: SetupDto) {
    const count = await this.prisma.user.count();
    if (count > 0) throw new BadRequestException('Setup already completed');

    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hash,
        name: dto.name,
        role: 'OWNER',
      },
    });

    return this.generateTokens(user.id, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user.id, user.role);
  }

  async refreshTokens(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.generateTokens(user.id, user.role);
  }

  async needsSetup(): Promise<boolean> {
    const count = await this.prisma.user.count();
    return count === 0;
  }

  private async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=auth.service.spec --no-cache
```

Expected: 5 tests PASS.

- [ ] **Step 7: Create JWT strategy**

Create `backend/src/auth/jwt.strategy.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  validate(payload: { sub: string; role: string }) {
    return { id: payload.sub, role: payload.role };
  }
}
```

- [ ] **Step 8: Create AuthController**

Create `backend/src/auth/auth.controller.ts`:

```typescript
import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SetupDto } from './dto/setup.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('status')
  async status() {
    const needsSetup = await this.authService.needsSetup();
    return { needsSetup };
  }

  @Post('setup')
  async setup(@Body() dto: SetupDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.setup(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
```

- [ ] **Step 9: Create AuthModule**

Create `backend/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule` imports.

- [ ] **Step 10: Commit**

```bash
git add backend/src/auth/ backend/src/common/prisma.service.ts backend/src/common/common.module.ts backend/src/app.module.ts
git commit -m "feat: add auth module with JWT, login, and setup wizard"
```

---

## Task 4: RBAC Guards + Roles Decorator

**Files:**
- Create: `backend/src/common/decorators/roles.decorator.ts`
- Create: `backend/src/common/guards/jwt-auth.guard.ts`
- Create: `backend/src/common/guards/roles.guard.ts`
- Create: `backend/src/common/guards/roles.guard.spec.ts`

- [ ] **Step 1: Create Roles decorator**

Create `backend/src/common/decorators/roles.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const MinRole = (role: string) => SetMetadata(ROLES_KEY, role);
```

- [ ] **Step 2: Create JwtAuthGuard**

Create `backend/src/common/guards/jwt-auth.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 3: Write failing test for RolesGuard**

Create `backend/src/common/guards/roles.guard.spec.ts`:

```typescript
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

const ROLE_HIERARCHY = ['VIEWER', 'DEVELOPER', 'ADMIN', 'OWNER'];

function mockContext(userRole: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: '1', role: userRole } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no role is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mockContext('VIEWER'))).toBe(true);
  });

  it('allows OWNER when ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('ADMIN');
    expect(guard.canActivate(mockContext('OWNER'))).toBe(true);
  });

  it('denies VIEWER when DEVELOPER is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('DEVELOPER');
    expect(guard.canActivate(mockContext('VIEWER'))).toBe(false);
  });

  it('allows exact role match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('DEVELOPER');
    expect(guard.canActivate(mockContext('DEVELOPER'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=roles.guard.spec --no-cache
```

Expected: FAIL — cannot find `./roles.guard`.

- [ ] **Step 5: Implement RolesGuard**

Create `backend/src/common/guards/roles.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

const ROLE_HIERARCHY = ['VIEWER', 'DEVELOPER', 'ADMIN', 'OWNER'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<string>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRole) return true;

    const { user } = context.switchToHttp().getRequest();
    const userLevel = ROLE_HIERARCHY.indexOf(user.role);
    const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
    return userLevel >= requiredLevel;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=roles.guard.spec --no-cache
```

Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/common/decorators/ backend/src/common/guards/
git commit -m "feat: add RBAC guards with linear role hierarchy"
```

---

## Task 5: User Invitation System

**Files:**
- Create: `backend/src/users/users.module.ts`, `backend/src/users/users.service.ts`, `backend/src/users/users.controller.ts`
- Create: `backend/src/users/users.service.spec.ts`
- Create: `backend/src/auth/dto/invite.dto.ts`

- [ ] **Step 1: Create invite DTO**

Create `backend/src/auth/dto/invite.dto.ts`:

```typescript
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInviteDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(['ADMIN', 'DEVELOPER', 'VIEWER'])
  role: string;
}

export class AcceptInviteDto {
  @IsString()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;
}
```

- [ ] **Step 2: Write failing test for UsersService**

Create `backend/src/users/users.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../common/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      invite: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('createInvite', () => {
    it('creates an invite with 48h expiry', async () => {
      prisma.invite.create.mockResolvedValue({
        id: '1',
        token: 'abc',
        role: 'DEVELOPER',
        expiresAt: new Date(),
      });

      const result = await service.createInvite('user-1', {
        role: 'DEVELOPER',
      });

      expect(prisma.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'DEVELOPER',
            createdById: 'user-1',
          }),
        }),
      );
      expect(result).toHaveProperty('token');
    });
  });

  describe('acceptInvite', () => {
    it('throws if invite token not found', async () => {
      prisma.invite.findUnique.mockResolvedValue(null);
      await expect(
        service.acceptInvite({
          token: 'bad',
          email: 'a@b.com',
          password: '12345678',
          name: 'Test',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if invite is expired', async () => {
      prisma.invite.findUnique.mockResolvedValue({
        id: '1',
        token: 'abc',
        role: 'DEVELOPER',
        usedAt: null,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(
        service.acceptInvite({
          token: 'abc',
          email: 'a@b.com',
          password: '12345678',
          name: 'Test',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listUsers', () => {
    it('returns all users without passwords', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: '1', email: 'a@b.com', name: 'A', role: 'OWNER', password: 'hash' },
      ]);

      const result = await service.listUsers();
      expect(result[0]).not.toHaveProperty('password');
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=users.service.spec --no-cache
```

Expected: FAIL — cannot find `./users.service`.

- [ ] **Step 4: Implement UsersService**

Create `backend/src/users/users.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { CreateInviteDto, AcceptInviteDto } from '../auth/dto/invite.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        createdAt: true,
      },
    });
    return users;
  }

  async updateRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: role as any },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.delete({ where: { id: userId } });
  }

  async createInvite(createdById: string, dto: CreateInviteDto) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    return this.prisma.invite.create({
      data: {
        email: dto.email,
        role: dto.role as any,
        expiresAt,
        createdById,
      },
    });
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.prisma.invite.findUnique({
      where: { token: dto.token },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.usedAt) throw new BadRequestException('Invite already used');
    if (invite.expiresAt < new Date())
      throw new BadRequestException('Invite expired');

    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hash,
        name: dto.name,
        role: invite.role,
      },
    });

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=users.service.spec --no-cache
```

Expected: 4 tests PASS.

- [ ] **Step 6: Create UsersController**

Create `backend/src/users/users.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateInviteDto, AcceptInviteDto } from '../auth/dto/invite.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  listUsers() {
    return this.usersService.listUsers();
  }

  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  updateRole(@Param('id') id: string, @Body('role') role: string) {
    return this.usersService.updateRole(id, role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  createInvite(@Req() req: any, @Body() dto: CreateInviteDto) {
    return this.usersService.createInvite(req.user.id, dto);
  }

  @Post('invite/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.usersService.acceptInvite(dto);
  }
}
```

- [ ] **Step 7: Create UsersModule and register in AppModule**

Create `backend/src/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Add `UsersModule` to `AppModule` imports.

- [ ] **Step 8: Commit**

```bash
git add backend/src/users/ backend/src/auth/dto/invite.dto.ts backend/src/app.module.ts
git commit -m "feat: add user invitation system with RBAC-protected endpoints"
```

---

## Task 6: Port Allocation Service

**Files:**
- Create: `backend/src/projects/port-allocation.service.ts`
- Create: `backend/src/projects/port-allocation.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/projects/port-allocation.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PortAllocationService } from './port-allocation.service';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('PortAllocationService', () => {
  let service: PortAllocationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      portAllocation: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        PortAllocationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: any) => def,
          },
        },
      ],
    }).compile();
    service = module.get(PortAllocationService);
  });

  describe('allocate', () => {
    it('assigns the first available port', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue({
        id: '1',
        port: 3001,
        projectId: null,
      });
      prisma.portAllocation.update.mockResolvedValue({
        id: '1',
        port: 3001,
        projectId: 'proj-1',
      });

      const port = await service.allocate('proj-1');
      expect(port).toBe(3001);
    });

    it('creates a new allocation if none exist', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue(null);
      prisma.portAllocation.create.mockResolvedValue({
        id: '2',
        port: 3001,
        projectId: 'proj-1',
      });

      const port = await service.allocate('proj-1');
      expect(port).toBe(3001);
    });
  });

  describe('allocateSpecific', () => {
    it('assigns a specific port if available', async () => {
      prisma.portAllocation.findUnique.mockResolvedValue(null);
      prisma.portAllocation.create.mockResolvedValue({
        id: '3',
        port: 3050,
        projectId: 'proj-2',
      });

      const port = await service.allocateSpecific('proj-2', 3050);
      expect(port).toBe(3050);
    });

    it('throws if port is already taken', async () => {
      prisma.portAllocation.findUnique.mockResolvedValue({
        id: '3',
        port: 3050,
        projectId: 'proj-other',
      });

      await expect(
        service.allocateSpecific('proj-2', 3050),
      ).rejects.toThrow('Port 3050 is already allocated');
    });
  });

  describe('release', () => {
    it('releases a port by projectId', async () => {
      prisma.portAllocation.findFirst.mockResolvedValue({
        id: '1',
        port: 3001,
        projectId: 'proj-1',
      });
      prisma.portAllocation.update.mockResolvedValue({
        id: '1',
        port: 3001,
        projectId: null,
      });

      await service.release('proj-1');
      expect(prisma.portAllocation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { projectId: null, allocatedAt: null },
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=port-allocation.service.spec --no-cache
```

Expected: FAIL — cannot find `./port-allocation.service`.

- [ ] **Step 3: Implement PortAllocationService**

Create `backend/src/projects/port-allocation.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PortAllocationService {
  private readonly minPort: number;
  private readonly maxPort: number;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.minPort = this.config.get('PORT_RANGE_MIN', 3001);
    this.maxPort = this.config.get('PORT_RANGE_MAX', 3999);
  }

  async allocate(projectId: string): Promise<number> {
    const available = await this.prisma.portAllocation.findFirst({
      where: { projectId: null },
      orderBy: { port: 'asc' },
    });

    if (available) {
      const updated = await this.prisma.portAllocation.update({
        where: { id: available.id },
        data: { projectId, allocatedAt: new Date() },
      });
      return updated.port;
    }

    const nextPort = await this.findNextUnallocatedPort();
    const created = await this.prisma.portAllocation.create({
      data: { port: nextPort, projectId, allocatedAt: new Date() },
    });
    return created.port;
  }

  async allocateSpecific(projectId: string, port: number): Promise<number> {
    if (port < this.minPort || port > this.maxPort) {
      throw new BadRequestException(
        `Port must be between ${this.minPort} and ${this.maxPort}`,
      );
    }

    const existing = await this.prisma.portAllocation.findUnique({
      where: { port },
    });

    if (existing && existing.projectId) {
      throw new BadRequestException(`Port ${port} is already allocated`);
    }

    if (existing) {
      await this.prisma.portAllocation.update({
        where: { id: existing.id },
        data: { projectId, allocatedAt: new Date() },
      });
      return port;
    }

    await this.prisma.portAllocation.create({
      data: { port, projectId, allocatedAt: new Date() },
    });
    return port;
  }

  async release(projectId: string): Promise<void> {
    const allocation = await this.prisma.portAllocation.findFirst({
      where: { projectId },
    });
    if (!allocation) return;

    await this.prisma.portAllocation.update({
      where: { id: allocation.id },
      data: { projectId: null, allocatedAt: null },
    });
  }

  private async findNextUnallocatedPort(): Promise<number> {
    const last = await this.prisma.portAllocation.findFirst({
      orderBy: { port: 'desc' },
    });
    const next = last ? last.port + 1 : this.minPort;
    if (next > this.maxPort) {
      throw new BadRequestException('No available ports in range');
    }
    return next;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=port-allocation.service.spec --no-cache
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/projects/
git commit -m "feat: add port allocation service with auto-assign and manual override"
```

---

## Task 7: Project CRUD Module

**Files:**
- Create: `backend/src/projects/projects.module.ts`, `backend/src/projects/projects.service.ts`, `backend/src/projects/projects.controller.ts`
- Create: `backend/src/projects/projects.service.spec.ts`
- Create: `backend/src/projects/dto/create-project.dto.ts`, `backend/src/projects/dto/update-project.dto.ts`

- [ ] **Step 1: Create DTOs**

Create `backend/src/projects/dto/create-project.dto.ts`:

```typescript
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsEnum(['GITHUB', 'UPLOAD'])
  sourceType: string;

  @IsUrl()
  @IsOptional()
  repoUrl?: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsInt()
  @Min(3001)
  @Max(3999)
  @IsOptional()
  port?: number;

  @IsObject()
  @IsOptional()
  envVars?: Record<string, string>;

  @IsObject()
  @IsOptional()
  pipeline?: { stages: any[] };
}
```

Create `backend/src/projects/dto/update-project.dto.ts`:

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
```

- [ ] **Step 2: Write failing test**

Create `backend/src/projects/projects.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { PortAllocationService } from './port-allocation.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: any;
  let encryption: any;
  let portAllocation: any;

  const defaultPipeline = {
    stages: [
      { name: 'clone', type: 'builtin', config: {} },
      { name: 'install', type: 'command', command: 'npm install' },
      { name: 'migrate', type: 'command', command: 'npx prisma migrate deploy' },
      { name: 'build', type: 'command', command: 'npm run build' },
      { name: 'pm2', type: 'builtin', config: {} },
      { name: 'nginx', type: 'builtin', config: {} },
      { name: 'ssl', type: 'builtin', config: {} },
    ],
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      deployment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    encryption = {
      encrypt: jest.fn((v: string) => 'enc:' + v),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    };
    portAllocation = {
      allocate: jest.fn().mockResolvedValue(3001),
      allocateSpecific: jest.fn().mockResolvedValue(3050),
      release: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: PortAllocationService, useValue: portAllocation },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  describe('create', () => {
    it('creates a project with auto-assigned port and default pipeline', async () => {
      prisma.project.create.mockResolvedValue({
        id: '1',
        name: 'My App',
        slug: 'my-app',
        port: 3001,
        pipeline: defaultPipeline,
      });

      const result = await service.create('user-1', {
        name: 'My App',
        slug: 'my-app',
        sourceType: 'GITHUB',
        repoUrl: 'https://github.com/user/repo',
      });

      expect(portAllocation.allocate).toHaveBeenCalled();
      expect(result.port).toBe(3001);
    });

    it('uses specific port when provided', async () => {
      prisma.project.create.mockResolvedValue({
        id: '1',
        name: 'My App',
        slug: 'my-app',
        port: 3050,
      });

      await service.create('user-1', {
        name: 'My App',
        slug: 'my-app',
        sourceType: 'GITHUB',
        port: 3050,
      });

      expect(portAllocation.allocateSpecific).toHaveBeenCalledWith(
        expect.any(String),
        3050,
      );
    });

    it('encrypts env vars before storing', async () => {
      prisma.project.create.mockImplementation(({ data }: any) => ({
        id: '1',
        ...data,
      }));

      await service.create('user-1', {
        name: 'My App',
        slug: 'my-app',
        sourceType: 'GITHUB',
        envVars: { DB_HOST: 'localhost' },
      });

      expect(encryption.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ DB_HOST: 'localhost' }),
      );
    });
  });

  describe('findAll', () => {
    it('returns all projects with last deployment', async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: '1', name: 'App', deployments: [{ version: 3, status: 'SUCCESS' }] },
      ]);

      const result = await service.findAll();
      expect(prisma.project.findMany).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('releases port and deletes project', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: '1', slug: 'my-app' });
      prisma.project.delete.mockResolvedValue({ id: '1' });

      await service.delete('1');

      expect(portAllocation.release).toHaveBeenCalledWith('1');
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=projects.service.spec --no-cache
```

Expected: FAIL — cannot find `./projects.service`.

- [ ] **Step 4: Implement ProjectsService**

Create `backend/src/projects/projects.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { PortAllocationService } from './port-allocation.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const DEFAULT_PIPELINE = {
  stages: [
    { name: 'clone', type: 'builtin', config: {} },
    { name: 'install', type: 'command', command: 'npm install' },
    { name: 'migrate', type: 'command', command: 'npx prisma migrate deploy' },
    { name: 'build', type: 'command', command: 'npm run build' },
    { name: 'pm2', type: 'builtin', config: {} },
    { name: 'nginx', type: 'builtin', config: {} },
    { name: 'ssl', type: 'builtin', config: {} },
  ],
};

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private portAllocation: PortAllocationService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    const projectId = crypto.randomUUID();
    const port = dto.port
      ? await this.portAllocation.allocateSpecific(projectId, dto.port)
      : await this.portAllocation.allocate(projectId);

    const envVars = dto.envVars
      ? this.encryption.encrypt(JSON.stringify(dto.envVars))
      : '';

    return this.prisma.project.create({
      data: {
        id: projectId,
        name: dto.name,
        slug: dto.slug,
        sourceType: dto.sourceType as any,
        repoUrl: dto.repoUrl,
        branch: dto.branch || 'main',
        domain: dto.domain,
        port,
        envVars,
        pipeline: dto.pipeline || DEFAULT_PIPELINE,
        pm2Name: dto.slug,
        createdById: userId,
      },
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      include: {
        deployments: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, status: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        deployments: {
          orderBy: { version: 'desc' },
          take: 5,
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const data: any = { ...dto };
    if (dto.envVars) {
      data.envVars = this.encryption.encrypt(JSON.stringify(dto.envVars));
      delete data.envVars;
      data.envVars = this.encryption.encrypt(JSON.stringify(dto.envVars));
    }
    delete data.port; // port changes not supported via update
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.portAllocation.release(id);
    return this.prisma.project.delete({ where: { id } });
  }

  async getDecryptedEnvVars(id: string): Promise<Record<string, string>> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.envVars) return {};
    return JSON.parse(this.encryption.decrypt(project.envVars));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=projects.service.spec --no-cache
```

Expected: 5 tests PASS.

- [ ] **Step 6: Create ProjectsController**

Create `backend/src/projects/projects.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  @MinRole('ADMIN')
  create(@Req() req: any, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(req.user.id, dto);
  }

  @Get()
  @MinRole('VIEWER')
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  @MinRole('VIEWER')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @MinRole('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  delete(@Param('id') id: string) {
    return this.projectsService.delete(id);
  }

  @Patch(':id/pipeline')
  @MinRole('DEVELOPER')
  updatePipeline(@Param('id') id: string, @Body() pipeline: any) {
    return this.projectsService.update(id, { pipeline });
  }
}
```

- [ ] **Step 7: Create ProjectsModule and register in AppModule**

Create `backend/src/projects/projects.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PortAllocationService } from './port-allocation.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, PortAllocationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

Add `ProjectsModule` to `AppModule` imports.

- [ ] **Step 8: Commit**

```bash
git add backend/src/projects/ backend/src/app.module.ts
git commit -m "feat: add project CRUD with encrypted env vars and port allocation"
```

---

## Task 8: Stage Executor + Command Stage

**Files:**
- Create: `backend/src/deploy/stages/stage-executor.ts`
- Create: `backend/src/deploy/stages/stage-executor.spec.ts`
- Create: `backend/src/deploy/stages/command.stage.ts`
- Create: `backend/src/deploy/stages/command.stage.spec.ts`

- [ ] **Step 1: Write failing test for CommandStage**

Create `backend/src/deploy/stages/command.stage.spec.ts`:

```typescript
import { CommandStage } from './command.stage';

describe('CommandStage', () => {
  it('executes a shell command in the given directory and captures output', async () => {
    const stage = new CommandStage();
    const logs: string[] = [];

    const result = await stage.execute(
      { name: 'test', type: 'command', command: 'echo "hello world"' },
      { projectDir: '/tmp', onLog: (line) => logs.push(line) },
    );

    expect(result.success).toBe(true);
    expect(logs.some((l) => l.includes('hello world'))).toBe(true);
  });

  it('returns failure for a bad command', async () => {
    const stage = new CommandStage();
    const logs: string[] = [];

    const result = await stage.execute(
      { name: 'test', type: 'command', command: 'exit 1' },
      { projectDir: '/tmp', onLog: (line) => logs.push(line) },
    );

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=command.stage.spec --no-cache
```

Expected: FAIL — cannot find `./command.stage`.

- [ ] **Step 3: Implement CommandStage**

Create `backend/src/deploy/stages/command.stage.ts`:

```typescript
import { spawn } from 'child_process';

export interface StageConfig {
  name: string;
  type: string;
  command?: string;
  config?: Record<string, any>;
}

export interface StageContext {
  projectDir: string;
  onLog: (line: string) => void;
}

export interface StageResult {
  success: boolean;
  error?: string;
}

export class CommandStage {
  execute(stageConfig: StageConfig, ctx: StageContext): Promise<StageResult> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', stageConfig.command!], {
        cwd: ctx.projectDir,
        env: { ...process.env },
      });

      child.stdout.on('data', (data) => {
        data
          .toString()
          .split('\n')
          .filter((l: string) => l)
          .forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data
          .toString()
          .split('\n')
          .filter((l: string) => l)
          .forEach((line: string) => ctx.onLog(`[stderr] ${line}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `Command exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}
```

- [ ] **Step 4: Write failing test for StageExecutor**

Create `backend/src/deploy/stages/stage-executor.spec.ts`:

```typescript
import { StageExecutor } from './stage-executor';

describe('StageExecutor', () => {
  let executor: StageExecutor;

  beforeEach(() => {
    executor = new StageExecutor();
  });

  it('runs stages sequentially and returns all results', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "one"' },
      { name: 'step2', type: 'command', command: 'echo "two"' },
    ];
    const allLogs: string[] = [];

    const results = await executor.executeAll(stages, {
      projectDir: '/tmp',
      onLog: (line) => allLogs.push(line),
      onStageStart: () => {},
      onStageEnd: () => {},
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('stops on first failure and marks remaining as skipped', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "ok"' },
      { name: 'step2', type: 'command', command: 'exit 1' },
      { name: 'step3', type: 'command', command: 'echo "never"' },
    ];

    const results = await executor.executeAll(stages, {
      projectDir: '/tmp',
      onLog: () => {},
      onStageStart: () => {},
      onStageEnd: () => {},
    });

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].skipped).toBe(true);
  });

  it('can resume from a specific stage index', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "skip me"' },
      { name: 'step2', type: 'command', command: 'echo "run me"' },
    ];
    const logs: string[] = [];

    const results = await executor.executeAll(stages, {
      projectDir: '/tmp',
      onLog: (line) => logs.push(line),
      onStageStart: () => {},
      onStageEnd: () => {},
      resumeFromIndex: 1,
    });

    expect(results[0].skipped).toBe(true);
    expect(results[1].success).toBe(true);
    expect(logs.some((l) => l.includes('run me'))).toBe(true);
    expect(logs.some((l) => l.includes('skip me'))).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=stage-executor.spec --no-cache
```

Expected: FAIL — cannot find `./stage-executor`.

- [ ] **Step 6: Implement StageExecutor**

Create `backend/src/deploy/stages/stage-executor.ts`:

```typescript
import { CommandStage, StageConfig, StageResult } from './command.stage';

export interface ExecutorContext {
  projectDir: string;
  onLog: (line: string) => void;
  onStageStart: (index: number, stage: StageConfig) => void;
  onStageEnd: (index: number, stage: StageConfig, result: StageResult & { skipped?: boolean }) => void;
  resumeFromIndex?: number;
}

export interface ExecutorStageResult extends StageResult {
  skipped?: boolean;
  stageName: string;
}

export class StageExecutor {
  private commandStage = new CommandStage();

  async executeAll(
    stages: StageConfig[],
    ctx: ExecutorContext,
  ): Promise<ExecutorStageResult[]> {
    const results: ExecutorStageResult[] = [];
    let failed = false;
    const resumeFrom = ctx.resumeFromIndex ?? 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      if (i < resumeFrom || failed) {
        results.push({ success: false, skipped: true, stageName: stage.name });
        continue;
      }

      ctx.onStageStart(i, stage);

      const result = await this.executeStage(stage, {
        projectDir: ctx.projectDir,
        onLog: ctx.onLog,
      });

      const fullResult = { ...result, stageName: stage.name };
      results.push(fullResult);
      ctx.onStageEnd(i, stage, fullResult);

      if (!result.success) {
        failed = true;
      }
    }

    return results;
  }

  private async executeStage(
    stage: StageConfig,
    ctx: { projectDir: string; onLog: (line: string) => void },
  ): Promise<StageResult> {
    if (stage.type === 'command') {
      return this.commandStage.execute(stage, ctx);
    }

    // Builtin stages will be handled by specific stage classes registered later.
    // For now, treat unknown types as no-ops that succeed.
    ctx.onLog(`[builtin] Executing ${stage.name} stage`);
    return { success: true };
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern="(command|stage-executor).stage" --no-cache
```

Expected: 5 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/deploy/
git commit -m "feat: add stage executor with command stage and resume support"
```

---

## Task 9: Builtin Stages — Clone, PM2, Nginx, SSL

**Files:**
- Create: `backend/src/deploy/stages/clone.stage.ts`, `backend/src/deploy/stages/clone.stage.spec.ts`
- Create: `backend/src/deploy/stages/pm2.stage.ts`, `backend/src/deploy/stages/pm2.stage.spec.ts`
- Create: `backend/src/deploy/stages/nginx.stage.ts`, `backend/src/deploy/stages/nginx.stage.spec.ts`
- Create: `backend/src/deploy/stages/ssl.stage.ts`, `backend/src/deploy/stages/ssl.stage.spec.ts`

- [ ] **Step 1: Write failing test for CloneStage**

Create `backend/src/deploy/stages/clone.stage.spec.ts`:

```typescript
import { CloneStage } from './clone.stage';
import { existsSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('CloneStage', () => {
  let stage: CloneStage;
  let tempDir: string;

  beforeEach(() => {
    stage = new CloneStage();
    tempDir = mkdtempSync(join(tmpdir(), 'clone-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates a git clone command for first deploy', () => {
    const cmd = stage.buildCommand({
      repoUrl: 'https://github.com/user/repo.git',
      branch: 'main',
      projectDir: '/var/www/my-app',
      isFirstDeploy: true,
    });

    expect(cmd).toContain('git clone');
    expect(cmd).toContain('--branch main');
    expect(cmd).toContain('https://github.com/user/repo.git');
  });

  it('generates a git pull command for subsequent deploys', () => {
    const cmd = stage.buildCommand({
      repoUrl: 'https://github.com/user/repo.git',
      branch: 'main',
      projectDir: '/var/www/my-app',
      isFirstDeploy: false,
    });

    expect(cmd).toContain('git fetch');
    expect(cmd).toContain('git reset --hard origin/main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=clone.stage.spec --no-cache
```

Expected: FAIL.

- [ ] **Step 3: Implement CloneStage**

Create `backend/src/deploy/stages/clone.stage.ts`:

```typescript
import { StageConfig, StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  projectDir: string;
  isFirstDeploy: boolean;
}

export class CloneStage {
  buildCommand(opts: CloneOptions): string {
    if (opts.isFirstDeploy) {
      return `git clone --branch ${opts.branch} --single-branch ${opts.repoUrl} ${opts.projectDir}`;
    }
    return `cd ${opts.projectDir} && git fetch origin && git reset --hard origin/${opts.branch}`;
  }

  execute(opts: CloneOptions, ctx: StageContext): Promise<StageResult> {
    const command = this.buildCommand(opts);
    ctx.onLog(`$ ${command}`);

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], {
        env: { ...process.env },
      });

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `git exited with code ${code}` });
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=clone.stage.spec --no-cache
```

Expected: 2 tests PASS.

- [ ] **Step 5: Write PM2 stage test and implementation**

Create `backend/src/deploy/stages/pm2.stage.spec.ts`:

```typescript
import { Pm2Stage } from './pm2.stage';

describe('Pm2Stage', () => {
  let stage: Pm2Stage;

  beforeEach(() => {
    stage = new Pm2Stage();
  });

  it('generates ecosystem config content', () => {
    const config = stage.buildEcosystemConfig({
      name: 'my-app',
      script: 'dist/main.js',
      cwd: '/var/www/my-app',
      port: 3001,
      envVars: { NODE_ENV: 'production', DB_HOST: 'localhost' },
    });

    expect(config).toContain("name: 'my-app'");
    expect(config).toContain("script: 'dist/main.js'");
    expect(config).toContain('PORT: 3001');
    expect(config).toContain("DB_HOST: 'localhost'");
  });

  it('generates pm2 start command for first deploy', () => {
    const cmd = stage.buildCommand('/var/www/my-app', true);
    expect(cmd).toContain('pm2 start ecosystem.config.js');
  });

  it('generates pm2 restart command for subsequent deploys', () => {
    const cmd = stage.buildCommand('/var/www/my-app', false);
    expect(cmd).toContain('pm2 restart ecosystem.config.js');
  });
});
```

Create `backend/src/deploy/stages/pm2.stage.ts`:

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface Pm2Config {
  name: string;
  script: string;
  cwd: string;
  port: number;
  envVars: Record<string, string>;
}

export class Pm2Stage {
  buildEcosystemConfig(config: Pm2Config): string {
    const envEntries = Object.entries(config.envVars)
      .map(([k, v]) => `      ${k}: '${v}'`)
      .join(',\n');

    return `module.exports = {
  apps: [{
    name: '${config.name}',
    script: '${config.script}',
    cwd: '${config.cwd}',
    env: {
      PORT: ${config.port},
      NODE_ENV: 'production',
${envEntries}
    }
  }]
};`;
  }

  buildCommand(projectDir: string, isFirstDeploy: boolean): string {
    if (isFirstDeploy) {
      return `cd ${projectDir} && pm2 start ecosystem.config.js`;
    }
    return `cd ${projectDir} && pm2 restart ecosystem.config.js`;
  }

  async execute(
    config: Pm2Config,
    isFirstDeploy: boolean,
    ctx: StageContext,
  ): Promise<StageResult> {
    const ecosystemPath = join(config.cwd, 'ecosystem.config.js');
    const content = this.buildEcosystemConfig(config);
    writeFileSync(ecosystemPath, content);
    ctx.onLog(`Wrote ecosystem.config.js`);

    const command = this.buildCommand(config.cwd, isFirstDeploy);
    ctx.onLog(`$ ${command}`);

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `pm2 exited with code ${code}` });
      });

      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
```

- [ ] **Step 6: Write Nginx stage test and implementation**

Create `backend/src/deploy/stages/nginx.stage.spec.ts`:

```typescript
import { NginxStage } from './nginx.stage';

describe('NginxStage', () => {
  let stage: NginxStage;

  beforeEach(() => {
    stage = new NginxStage();
  });

  it('generates nginx config with SSL when domain has cert', () => {
    const config = stage.buildConfig({
      domain: 'app.example.com',
      port: 3001,
      slug: 'my-app',
      hasSsl: true,
    });

    expect(config).toContain('server_name app.example.com');
    expect(config).toContain('proxy_pass http://127.0.0.1:3001');
    expect(config).toContain('listen 443 ssl');
    expect(config).toContain('/etc/letsencrypt/live/app.example.com/');
  });

  it('generates nginx config without SSL block', () => {
    const config = stage.buildConfig({
      domain: 'app.example.com',
      port: 3001,
      slug: 'my-app',
      hasSsl: false,
    });

    expect(config).toContain('listen 80');
    expect(config).not.toContain('listen 443');
  });
});
```

Create `backend/src/deploy/stages/nginx.stage.ts`:

```typescript
import { StageContext, StageResult } from './command.stage';
import { writeFileSync } from 'fs';
import { spawn } from 'child_process';

export interface NginxConfig {
  domain: string;
  port: number;
  slug: string;
  hasSsl: boolean;
}

export class NginxStage {
  buildConfig(config: NginxConfig): string {
    const proxyBlock = `
    location / {
        proxy_pass http://127.0.0.1:${config.port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }`;

    if (!config.hasSsl) {
      return `server {
    listen 80;
    server_name ${config.domain};
${proxyBlock}
}`;
    }

    return `server {
    listen 80;
    server_name ${config.domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name ${config.domain};

    ssl_certificate /etc/letsencrypt/live/${config.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.domain}/privkey.pem;
${proxyBlock}
}`;
  }

  async execute(config: NginxConfig, ctx: StageContext): Promise<StageResult> {
    const confPath = `/etc/nginx/sites-available/${config.slug}.conf`;
    const enabledPath = `/etc/nginx/sites-enabled/${config.slug}.conf`;

    const content = this.buildConfig(config);
    try {
      writeFileSync(confPath, content);
      ctx.onLog(`Wrote nginx config to ${confPath}`);
    } catch (err: any) {
      return { success: false, error: `Failed to write nginx config: ${err.message}` };
    }

    const command = `ln -sf ${confPath} ${enabledPath} && nginx -t && nginx -s reload`;
    ctx.onLog(`$ ${command}`);

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `nginx config failed (code ${code})` });
      });

      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
```

- [ ] **Step 7: Write SSL stage test and implementation**

Create `backend/src/deploy/stages/ssl.stage.spec.ts`:

```typescript
import { SslStage } from './ssl.stage';

describe('SslStage', () => {
  let stage: SslStage;

  beforeEach(() => {
    stage = new SslStage();
  });

  it('builds certbot command for a domain', () => {
    const cmd = stage.buildCommand('app.example.com');
    expect(cmd).toContain('certbot certonly');
    expect(cmd).toContain('--nginx');
    expect(cmd).toContain('-d app.example.com');
    expect(cmd).toContain('--non-interactive');
    expect(cmd).toContain('--agree-tos');
  });
});
```

Create `backend/src/deploy/stages/ssl.stage.ts`:

```typescript
import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

export class SslStage {
  buildCommand(domain: string): string {
    return `certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email`;
  }

  hasCert(domain: string): boolean {
    return existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
  }

  async execute(domain: string, ctx: StageContext): Promise<StageResult> {
    if (this.hasCert(domain)) {
      ctx.onLog(`SSL certificate already exists for ${domain}, skipping`);
      return { success: true };
    }

    const command = this.buildCommand(domain);
    ctx.onLog(`$ ${command}`);

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line));
      });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `certbot failed (code ${code})` });
      });

      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
```

- [ ] **Step 8: Run all stage tests**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern="stages/" --no-cache
```

Expected: All stage tests PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/deploy/stages/
git commit -m "feat: add builtin stages — clone, pm2, nginx, ssl"
```

---

## Task 10: Deploy Service + BullMQ Processor

**Files:**
- Create: `backend/src/deploy/deploy.module.ts`, `backend/src/deploy/deploy.service.ts`, `backend/src/deploy/deploy.controller.ts`
- Create: `backend/src/deploy/deploy.processor.ts`
- Create: `backend/src/deploy/deploy.service.spec.ts`, `backend/src/deploy/deploy.processor.spec.ts`

- [ ] **Step 1: Write failing test for DeployService**

Create `backend/src/deploy/deploy.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DeployService } from './deploy.service';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

describe('DeployService', () => {
  let service: DeployService;
  let prisma: any;
  let queue: any;
  let projectsService: any;

  beforeEach(async () => {
    prisma = {
      deployment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'proj-1',
        slug: 'my-app',
        pipeline: { stages: [] },
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('deploy'), useValue: queue },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  describe('trigger', () => {
    it('creates a deployment and adds job to queue', async () => {
      prisma.deployment.count.mockResolvedValue(2);
      prisma.deployment.create.mockResolvedValue({
        id: 'dep-1',
        version: 3,
        status: 'QUEUED',
      });

      const result = await service.trigger('proj-1', 'user-1');

      expect(prisma.deployment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'proj-1',
            triggeredById: 'user-1',
            version: 3,
            status: 'QUEUED',
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('deploy', expect.objectContaining({
        deploymentId: 'dep-1',
      }));
    });
  });

  describe('cancel', () => {
    it('marks a running deployment as cancelled', async () => {
      prisma.deployment.findUnique.mockResolvedValue({
        id: 'dep-1',
        status: 'RUNNING',
      });
      prisma.deployment.update.mockResolvedValue({
        id: 'dep-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('dep-1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('getHistory', () => {
    it('returns deployments for a project', async () => {
      prisma.deployment.findMany.mockResolvedValue([
        { id: 'dep-1', version: 1 },
        { id: 'dep-2', version: 2 },
      ]);

      const result = await service.getHistory('proj-1');
      expect(result).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=deploy.service.spec --no-cache
```

Expected: FAIL.

- [ ] **Step 3: Implement DeployService**

Create `backend/src/deploy/deploy.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class DeployService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    @InjectQueue('deploy') private deployQueue: Queue,
  ) {}

  async trigger(projectId: string, userId: string, resumeFromStage?: number) {
    const project = await this.projectsService.findOne(projectId);
    const version = (await this.prisma.deployment.count({ where: { projectId } })) + 1;

    const stages = (project.pipeline as any).stages.map((s: any) => ({
      ...s,
      status: 'PENDING',
      logs: [],
    }));

    const deployment = await this.prisma.deployment.create({
      data: {
        projectId,
        triggeredById: userId,
        version,
        status: 'QUEUED',
        stages,
      },
    });

    await this.deployQueue.add('deploy', {
      deploymentId: deployment.id,
      projectId,
      resumeFromStage,
    });

    return deployment;
  }

  async cancel(deploymentId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'RUNNING' && deployment.status !== 'QUEUED') {
      throw new BadRequestException('Can only cancel queued or running deployments');
    }

    return this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  async retry(deploymentId: string, userId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'FAILED') {
      throw new BadRequestException('Can only retry failed deployments');
    }

    const stages = deployment.stages as any[];
    const failedIndex = stages.findIndex((s) => s.status === 'FAILED');

    return this.trigger(deployment.projectId, userId, failedIndex);
  }

  async rollback(projectId: string, userId: string) {
    const lastSuccess = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'SUCCESS' },
      orderBy: { version: 'desc' },
    });
    if (!lastSuccess) throw new BadRequestException('No successful deployment to rollback to');

    return this.trigger(projectId, userId);
  }

  async getHistory(projectId: string) {
    return this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
  }

  async getOne(deploymentId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: {
        triggeredBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');
    return deployment;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=deploy.service.spec --no-cache
```

Expected: 3 tests PASS.

- [ ] **Step 5: Implement DeployProcessor (BullMQ worker)**

Create `backend/src/deploy/deploy.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { StageExecutor } from './stages/stage-executor';
import { CloneStage } from './stages/clone.stage';
import { Pm2Stage } from './stages/pm2.stage';
import { NginxStage } from './stages/nginx.stage';
import { SslStage } from './stages/ssl.stage';
import { DeployGateway } from './deploy.gateway';
import { existsSync } from 'fs';
import { join } from 'path';

@Processor('deploy')
export class DeployProcessor extends WorkerHost {
  private stageExecutor = new StageExecutor();
  private cloneStage = new CloneStage();
  private pm2Stage = new Pm2Stage();
  private nginxStage = new NginxStage();
  private sslStage = new SslStage();

  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private gateway: DeployGateway,
  ) {
    super();
  }

  async process(job: Job<{ deploymentId: string; projectId: string; resumeFromStage?: number }>) {
    const { deploymentId, projectId, resumeFromStage } = job.data;

    const project = await this.projectsService.findOne(projectId);
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const projectDir = join(projectsDir, project.slug);
    const isFirstDeploy = !existsSync(projectDir);

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    this.gateway.emitToDeployment(deploymentId, 'status', { status: 'RUNNING' });

    const stages = (project.pipeline as any).stages;
    let allSuccess = true;

    for (let i = 0; i < stages.length; i++) {
      if (resumeFromStage !== undefined && i < resumeFromStage) continue;

      const stage = stages[i];
      this.gateway.emitToDeployment(deploymentId, 'stage-start', { index: i, name: stage.name });

      await this.updateStageStatus(deploymentId, i, 'RUNNING');

      let result: { success: boolean; error?: string };

      if (stage.type === 'builtin') {
        result = await this.executeBuiltinStage(stage.name, project, projectDir, isFirstDeploy && i === 0, deploymentId);
      } else {
        const { CommandStage } = await import('./stages/command.stage');
        const cmdStage = new CommandStage();
        result = await cmdStage.execute(stage, {
          projectDir,
          onLog: (line) => this.gateway.emitToDeployment(deploymentId, 'log', { index: i, line }),
        });
      }

      await this.updateStageStatus(deploymentId, i, result.success ? 'SUCCESS' : 'FAILED', result.error);
      this.gateway.emitToDeployment(deploymentId, 'stage-end', { index: i, success: result.success });

      if (!result.success) {
        allSuccess = false;
        break;
      }
    }

    const finalStatus = allSuccess ? 'SUCCESS' : 'FAILED';
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: finalStatus, finishedAt: new Date() },
    });

    if (allSuccess) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'ACTIVE' },
      });
    }

    this.gateway.emitToDeployment(deploymentId, 'status', { status: finalStatus });
    this.gateway.emitToDashboard('project-status', { projectId, status: allSuccess ? 'ACTIVE' : 'ERROR' });
  }

  private async executeBuiltinStage(
    name: string,
    project: any,
    projectDir: string,
    isFirstDeploy: boolean,
    deploymentId: string,
  ) {
    const logFn = (line: string) => this.gateway.emitToDeployment(deploymentId, 'log', { stage: name, line });
    const ctx = { projectDir, onLog: logFn };

    switch (name) {
      case 'clone':
        return this.cloneStage.execute(
          { repoUrl: project.repoUrl!, branch: project.branch, projectDir, isFirstDeploy },
          ctx,
        );

      case 'pm2': {
        let envVars: Record<string, string> = {};
        if (project.envVars) {
          try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
        }
        return this.pm2Stage.execute(
          { name: project.pm2Name, script: 'dist/main.js', cwd: projectDir, port: project.port, envVars },
          isFirstDeploy,
          ctx,
        );
      }

      case 'nginx':
        if (!project.domain) {
          logFn('No domain configured, skipping nginx');
          return { success: true };
        }
        return this.nginxStage.execute(
          { domain: project.domain, port: project.port, slug: project.slug, hasSsl: this.sslStage.hasCert(project.domain) },
          ctx,
        );

      case 'ssl':
        if (!project.domain) {
          logFn('No domain configured, skipping SSL');
          return { success: true };
        }
        const sslResult = await this.sslStage.execute(project.domain, ctx);
        if (sslResult.success && !this.sslStage.hasCert(project.domain)) {
          // Re-run nginx with SSL after cert is obtained
          await this.nginxStage.execute(
            { domain: project.domain, port: project.port, slug: project.slug, hasSsl: true },
            ctx,
          );
        }
        return sslResult;

      default:
        logFn(`Unknown builtin stage: ${name}`);
        return { success: false, error: `Unknown builtin stage: ${name}` };
    }
  }

  private async updateStageStatus(deploymentId: string, index: number, status: string, error?: string) {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    const stages = deployment!.stages as any[];
    stages[index] = { ...stages[index], status, error };
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { stages },
    });
  }
}
```

- [ ] **Step 6: Create DeployController**

Create `backend/src/deploy/deploy.controller.ts`:

```typescript
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DeployService } from './deploy.service';

@Controller('projects/:projectId/deployments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeployController {
  constructor(private deployService: DeployService) {}

  @Post()
  @MinRole('DEVELOPER')
  trigger(@Param('projectId') projectId: string, @Req() req: any) {
    return this.deployService.trigger(projectId, req.user.id);
  }

  @Get()
  @MinRole('VIEWER')
  getHistory(@Param('projectId') projectId: string) {
    return this.deployService.getHistory(projectId);
  }

  @Get(':id')
  @MinRole('VIEWER')
  getOne(@Param('id') id: string) {
    return this.deployService.getOne(id);
  }

  @Post(':id/cancel')
  @MinRole('DEVELOPER')
  cancel(@Param('id') id: string) {
    return this.deployService.cancel(id);
  }

  @Post(':id/retry')
  @MinRole('DEVELOPER')
  retry(@Param('id') id: string, @Req() req: any) {
    return this.deployService.retry(id, req.user.id);
  }

  @Post('rollback')
  @MinRole('DEVELOPER')
  rollback(@Param('projectId') projectId: string, @Req() req: any) {
    return this.deployService.rollback(projectId, req.user.id);
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/deploy/
git commit -m "feat: add deploy service with BullMQ processor and REST controller"
```

---

## Task 11: WebSocket Gateway

**Files:**
- Create: `backend/src/deploy/deploy.gateway.ts`
- Create: `backend/src/deploy/deploy.gateway.spec.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/deploy/deploy.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { DeployGateway } from './deploy.gateway';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('DeployGateway', () => {
  let gateway: DeployGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DeployGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', role: 'ADMIN' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'secret' },
        },
      ],
    }).compile();
    gateway = module.get(DeployGateway);
  });

  it('is defined', () => {
    expect(gateway).toBeDefined();
  });

  it('has emitToDeployment method', () => {
    expect(typeof gateway.emitToDeployment).toBe('function');
  });

  it('has emitToDashboard method', () => {
    expect(typeof gateway.emitToDashboard).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=deploy.gateway.spec --no-cache
```

Expected: FAIL.

- [ ] **Step 3: Implement DeployGateway**

Create `backend/src/deploy/deploy.gateway.ts`:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class DeployGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Cleanup handled by socket.io room management
  }

  @SubscribeMessage('join-deployment')
  handleJoinDeployment(client: Socket, deploymentId: string) {
    client.join(`deployment:${deploymentId}`);
  }

  @SubscribeMessage('leave-deployment')
  handleLeaveDeployment(client: Socket, deploymentId: string) {
    client.leave(`deployment:${deploymentId}`);
  }

  @SubscribeMessage('join-dashboard')
  handleJoinDashboard(client: Socket) {
    client.join('dashboard');
  }

  emitToDeployment(deploymentId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`deployment:${deploymentId}`).emit(event, data);
    }
  }

  emitToDashboard(event: string, data: any) {
    if (this.server) {
      this.server.to('dashboard').emit(event, data);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=deploy.gateway.spec --no-cache
```

Expected: 3 tests PASS.

- [ ] **Step 5: Create DeployModule and register everything in AppModule**

Create `backend/src/deploy/deploy.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { DeployService } from './deploy.service';
import { DeployController } from './deploy.controller';
import { DeployProcessor } from './deploy.processor';
import { DeployGateway } from './deploy.gateway';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'deploy' }),
    JwtModule.register({}),
    ProjectsModule,
  ],
  controllers: [DeployController],
  providers: [DeployService, DeployProcessor, DeployGateway],
  exports: [DeployGateway],
})
export class DeployModule {}
```

Add `DeployModule` to `AppModule` imports.

- [ ] **Step 6: Commit**

```bash
git add backend/src/deploy/ backend/src/app.module.ts
git commit -m "feat: add WebSocket gateway and wire up deploy module"
```

---

## Task 12: Domain Provider Module

**Files:**
- Create: `backend/src/domains/domains.module.ts`, `backend/src/domains/domains.service.ts`, `backend/src/domains/domains.controller.ts`
- Create: `backend/src/domains/domains.service.spec.ts`
- Create: `backend/src/domains/providers/dns-provider.interface.ts`
- Create: `backend/src/domains/providers/namecheap.provider.ts`, `backend/src/domains/providers/godaddy.provider.ts`
- Create: `backend/src/domains/dto/create-provider.dto.ts`, `backend/src/domains/dto/dns-record.dto.ts`

- [ ] **Step 1: Create DTOs and interface**

Create `backend/src/domains/dto/create-provider.dto.ts`:

```typescript
import { IsEnum, IsString } from 'class-validator';

export class CreateProviderDto {
  @IsEnum(['NAMECHEAP', 'GODADDY'])
  provider: string;

  @IsString()
  apiKey: string;

  @IsString()
  apiSecret: string;
}
```

Create `backend/src/domains/dto/dns-record.dto.ts`:

```typescript
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateDnsRecordDto {
  @IsString()
  name: string;

  @IsEnum(['A', 'CNAME', 'TXT', 'MX'])
  type: string;

  @IsString()
  value: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  ttl?: number;
}
```

Create `backend/src/domains/providers/dns-provider.interface.ts`:

```typescript
export interface DnsRecord {
  name: string;
  type: string;
  value: string;
  ttl: number;
}

export interface DnsProviderInterface {
  listDomains(): Promise<string[]>;
  getRecords(domain: string): Promise<DnsRecord[]>;
  addRecord(domain: string, record: DnsRecord): Promise<void>;
  deleteRecord(domain: string, record: { name: string; type: string }): Promise<void>;
}
```

- [ ] **Step 2: Write failing test for DomainsService**

Create `backend/src/domains/domains.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { DomainsService } from './domains.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';

describe('DomainsService', () => {
  let service: DomainsService;
  let prisma: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      domainProvider: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    encryption = {
      encrypt: jest.fn((v: string) => 'enc:' + v),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
      mask: jest.fn((v: string) => '****' + v.slice(-4)),
    };

    const module = await Test.createTestingModule({
      providers: [
        DomainsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();
    service = module.get(DomainsService);
  });

  describe('createProvider', () => {
    it('encrypts API credentials before storing', async () => {
      prisma.domainProvider.create.mockResolvedValue({
        id: '1',
        provider: 'NAMECHEAP',
        apiKey: 'enc:key123',
        apiSecret: 'enc:secret123',
      });

      await service.createProvider('user-1', {
        provider: 'NAMECHEAP',
        apiKey: 'key123',
        apiSecret: 'secret123',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('key123');
      expect(encryption.encrypt).toHaveBeenCalledWith('secret123');
    });
  });

  describe('listProviders', () => {
    it('returns providers with masked credentials', async () => {
      prisma.domainProvider.findMany.mockResolvedValue([
        { id: '1', provider: 'NAMECHEAP', apiKey: 'enc:key123', apiSecret: 'enc:secret123' },
      ]);

      const result = await service.listProviders();

      expect(result[0].apiKey).toContain('****');
      expect(result[0].apiSecret).toContain('****');
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=domains.service.spec --no-cache
```

Expected: FAIL.

- [ ] **Step 4: Implement DomainsService**

Create `backend/src/domains/domains.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { NamecheapProvider } from './providers/namecheap.provider';
import { GodaddyProvider } from './providers/godaddy.provider';
import { DnsProviderInterface, DnsRecord } from './providers/dns-provider.interface';

@Injectable()
export class DomainsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async createProvider(userId: string, dto: CreateProviderDto) {
    return this.prisma.domainProvider.create({
      data: {
        provider: dto.provider as any,
        apiKey: this.encryption.encrypt(dto.apiKey),
        apiSecret: this.encryption.encrypt(dto.apiSecret),
        createdById: userId,
      },
    });
  }

  async listProviders() {
    const providers = await this.prisma.domainProvider.findMany();
    return providers.map((p) => ({
      ...p,
      apiKey: this.encryption.mask(this.encryption.decrypt(p.apiKey)),
      apiSecret: this.encryption.mask(this.encryption.decrypt(p.apiSecret)),
    }));
  }

  async deleteProvider(id: string) {
    return this.prisma.domainProvider.delete({ where: { id } });
  }

  async getProviderClient(providerId: string): Promise<DnsProviderInterface> {
    const provider = await this.prisma.domainProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    const apiKey = this.encryption.decrypt(provider.apiKey);
    const apiSecret = this.encryption.decrypt(provider.apiSecret);

    if (provider.provider === 'NAMECHEAP') {
      return new NamecheapProvider(apiKey, apiSecret);
    }
    return new GodaddyProvider(apiKey, apiSecret);
  }

  async listDomains(providerId: string) {
    const client = await this.getProviderClient(providerId);
    return client.listDomains();
  }

  async getRecords(providerId: string, domain: string) {
    const client = await this.getProviderClient(providerId);
    return client.getRecords(domain);
  }

  async addRecord(providerId: string, domain: string, record: DnsRecord) {
    const client = await this.getProviderClient(providerId);
    return client.addRecord(domain, record);
  }

  async deleteRecord(providerId: string, domain: string, record: { name: string; type: string }) {
    const client = await this.getProviderClient(providerId);
    return client.deleteRecord(domain, record);
  }
}
```

- [ ] **Step 5: Implement provider stubs**

Create `backend/src/domains/providers/namecheap.provider.ts`:

```typescript
import { DnsProviderInterface, DnsRecord } from './dns-provider.interface';

export class NamecheapProvider implements DnsProviderInterface {
  private baseUrl = 'https://api.namecheap.com/xml.response';

  constructor(
    private apiUser: string,
    private apiKey: string,
  ) {}

  async listDomains(): Promise<string[]> {
    const params = new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      UserName: this.apiUser,
      Command: 'namecheap.domains.getList',
      ClientIp: '0.0.0.0',
    });

    const res = await fetch(`${this.baseUrl}?${params}`);
    const text = await res.text();
    // Parse XML response — extract domain names
    const matches = [...text.matchAll(/Name="([^"]+)"/g)];
    return matches.map((m) => m[1]);
  }

  async getRecords(domain: string): Promise<DnsRecord[]> {
    const [sld, tld] = this.splitDomain(domain);
    const params = new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      UserName: this.apiUser,
      Command: 'namecheap.domains.dns.getHosts',
      ClientIp: '0.0.0.0',
      SLD: sld,
      TLD: tld,
    });

    const res = await fetch(`${this.baseUrl}?${params}`);
    const text = await res.text();
    const records: DnsRecord[] = [];
    const hostMatches = [...text.matchAll(/HostId="[^"]*"\s+Name="([^"]*)"\s+Type="([^"]*)"\s+Address="([^"]*)"\s+.*?TTL="(\d+)"/g)];
    for (const m of hostMatches) {
      records.push({ name: m[1], type: m[2], value: m[3], ttl: parseInt(m[4]) });
    }
    return records;
  }

  async addRecord(domain: string, record: DnsRecord): Promise<void> {
    const existing = await this.getRecords(domain);
    existing.push(record);
    await this.setHosts(domain, existing);
  }

  async deleteRecord(domain: string, target: { name: string; type: string }): Promise<void> {
    const existing = await this.getRecords(domain);
    const filtered = existing.filter((r) => !(r.name === target.name && r.type === target.type));
    await this.setHosts(domain, filtered);
  }

  private async setHosts(domain: string, records: DnsRecord[]): Promise<void> {
    const [sld, tld] = this.splitDomain(domain);
    const params = new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      UserName: this.apiUser,
      Command: 'namecheap.domains.dns.setHosts',
      ClientIp: '0.0.0.0',
      SLD: sld,
      TLD: tld,
    });

    records.forEach((r, i) => {
      params.set(`HostName${i + 1}`, r.name);
      params.set(`RecordType${i + 1}`, r.type);
      params.set(`Address${i + 1}`, r.value);
      params.set(`TTL${i + 1}`, String(r.ttl || 1800));
    });

    await fetch(`${this.baseUrl}?${params}`);
  }

  private splitDomain(domain: string): [string, string] {
    const parts = domain.split('.');
    const tld = parts.pop()!;
    const sld = parts.pop()!;
    return [sld, tld];
  }
}
```

Create `backend/src/domains/providers/godaddy.provider.ts`:

```typescript
import { DnsProviderInterface, DnsRecord } from './dns-provider.interface';

export class GodaddyProvider implements DnsProviderInterface {
  private baseUrl = 'https://api.godaddy.com/v1';

  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  private get headers() {
    return {
      Authorization: `sso-key ${this.apiKey}:${this.apiSecret}`,
      'Content-Type': 'application/json',
    };
  }

  async listDomains(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/domains`, { headers: this.headers });
    const data = await res.json();
    return (data as any[]).map((d) => d.domain);
  }

  async getRecords(domain: string): Promise<DnsRecord[]> {
    const res = await fetch(`${this.baseUrl}/domains/${domain}/records`, { headers: this.headers });
    const data = await res.json();
    return (data as any[]).map((r) => ({
      name: r.name,
      type: r.type,
      value: r.data,
      ttl: r.ttl,
    }));
  }

  async addRecord(domain: string, record: DnsRecord): Promise<void> {
    await fetch(`${this.baseUrl}/domains/${domain}/records`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify([
        { name: record.name, type: record.type, data: record.value, ttl: record.ttl || 600 },
      ]),
    });
  }

  async deleteRecord(domain: string, target: { name: string; type: string }): Promise<void> {
    await fetch(`${this.baseUrl}/domains/${domain}/records/${target.type}/${target.name}`, {
      method: 'DELETE',
      headers: this.headers,
    });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=domains.service.spec --no-cache
```

Expected: 2 tests PASS.

- [ ] **Step 7: Create DomainsController and DomainsModule**

Create `backend/src/domains/domains.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DomainsService } from './domains.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateDnsRecordDto } from './dto/dns-record.dto';

@Controller('domains')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DomainsController {
  constructor(private domainsService: DomainsService) {}

  @Post('providers')
  @MinRole('ADMIN')
  createProvider(@Req() req: any, @Body() dto: CreateProviderDto) {
    return this.domainsService.createProvider(req.user.id, dto);
  }

  @Get('providers')
  @MinRole('ADMIN')
  listProviders() {
    return this.domainsService.listProviders();
  }

  @Delete('providers/:id')
  @MinRole('ADMIN')
  deleteProvider(@Param('id') id: string) {
    return this.domainsService.deleteProvider(id);
  }

  @Get('providers/:id/domains')
  @MinRole('ADMIN')
  listDomains(@Param('id') providerId: string) {
    return this.domainsService.listDomains(providerId);
  }

  @Get('providers/:id/domains/:domain/records')
  @MinRole('ADMIN')
  getRecords(@Param('id') providerId: string, @Param('domain') domain: string) {
    return this.domainsService.getRecords(providerId, domain);
  }

  @Post('providers/:id/domains/:domain/records')
  @MinRole('ADMIN')
  addRecord(
    @Param('id') providerId: string,
    @Param('domain') domain: string,
    @Body() dto: CreateDnsRecordDto,
  ) {
    return this.domainsService.addRecord(providerId, domain, { ...dto, ttl: dto.ttl || 600 });
  }

  @Delete('providers/:id/domains/:domain/records/:type/:name')
  @MinRole('ADMIN')
  deleteRecord(
    @Param('id') providerId: string,
    @Param('domain') domain: string,
    @Param('type') type: string,
    @Param('name') name: string,
  ) {
    return this.domainsService.deleteRecord(providerId, domain, { name, type });
  }
}
```

Create `backend/src/domains/domains.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { DomainsController } from './domains.controller';

@Module({
  controllers: [DomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
```

Add `DomainsModule` to `AppModule` imports.

- [ ] **Step 8: Commit**

```bash
git add backend/src/domains/ backend/src/app.module.ts
git commit -m "feat: add domain provider module with Namecheap and GoDaddy integration"
```

---

## Task 13: File Upload Module

**Files:**
- Create: `backend/src/upload/upload.module.ts`, `backend/src/upload/upload.controller.ts`
- Create: `backend/src/upload/upload.controller.spec.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/upload/upload.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { UploadController } from './upload.controller';
import { ConfigService } from '@nestjs/config';
import { DeployService } from '../deploy/deploy.service';

describe('UploadController', () => {
  let controller: UploadController;
  let deployService: any;

  beforeEach(async () => {
    deployService = { trigger: jest.fn().mockResolvedValue({ id: 'dep-1' }) };

    const module = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: ConfigService, useValue: { get: () => '/tmp/test-projects' } },
        { provide: DeployService, useValue: deployService },
      ],
    }).compile();
    controller = module.get(UploadController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=upload.controller.spec --no-cache
```

Expected: FAIL.

- [ ] **Step 3: Implement UploadController**

Create `backend/src/upload/upload.controller.ts`:

```typescript
import {
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DeployService } from '../deploy/deploy.service';
import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

@Controller('projects/:projectId/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadController {
  constructor(
    private config: ConfigService,
    private deployService: DeployService,
  ) {}

  @Post()
  @MinRole('DEVELOPER')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
    }),
  )
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    // The project slug needs to be resolved — for now use projectId
    // The deploy processor will handle extraction
    const tempPath = join(projectsDir, `.upload-${projectId}.tar.gz`);

    const { writeFileSync } = await import('fs');
    writeFileSync(tempPath, file.buffer);

    // Extract to project directory
    const projectDir = join(projectsDir, projectId);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
    execSync(`tar -xzf ${tempPath} -C ${projectDir}`);
    execSync(`rm ${tempPath}`);

    // Trigger deploy, skipping clone stage (resumeFromStage=1)
    const deployment = await this.deployService.trigger(projectId, req.user.id, 1);

    return { message: 'Upload complete, deployment started', deployment };
  }
}
```

- [ ] **Step 4: Create UploadModule**

Create `backend/src/upload/upload.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { DeployModule } from '../deploy/deploy.module';

@Module({
  imports: [DeployModule],
  controllers: [UploadController],
})
export class UploadModule {}
```

Add `UploadModule` to `AppModule` imports.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --testPathPattern=upload.controller.spec --no-cache
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/upload/ backend/src/app.module.ts
git commit -m "feat: add file upload with tar.gz extraction and auto-deploy"
```

---

## Task 14: Frontend Scaffolding + Auth Pages

**Files:**
- Create: `frontend/` (Next.js project)
- Create: `frontend/src/lib/api.ts`, `frontend/src/lib/auth.ts`
- Create: `frontend/src/app/login/page.tsx`, `frontend/src/app/setup/page.tsx`
- Create: `frontend/src/components/providers.tsx`
- Create: `frontend/src/hooks/use-auth.ts`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd /Users/noah/Work/idea/ship-dock
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/noah/Work/idea/ship-dock/frontend
npm install @tanstack/react-query socket.io-client react-hook-form @hookform/resolvers zod fflate @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npx shadcn@latest init -d
npx shadcn@latest add button card input label form toast tabs badge dialog dropdown-menu separator avatar scroll-area
```

- [ ] **Step 3: Create API client**

Create `frontend/src/lib/api.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Try refresh
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      const data = await refreshRes.json();
      setAccessToken(data.accessToken);
      headers.Authorization = `Bearer ${data.accessToken}`;
      const retryRes = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
      if (!retryRes.ok) throw new Error(`API error: ${retryRes.status}`);
      return retryRes.json();
    }

    setAccessToken(null);
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `API error: ${res.status}`);
  }

  return res.json();
}
```

- [ ] **Step 4: Create auth hook**

Create `frontend/src/hooks/use-auth.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken, getAccessToken } from '@/lib/auth';

export function useAuth({ required = true } = {}) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function check() {
      try {
        if (!getAccessToken()) {
          if (required) {
            router.push('/login');
            return;
          }
        }
        const data = await api('/auth/me');
        setUser(data);
      } catch {
        if (required) router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    check();
  }, [required, router]);

  return { user, loading };
}
```

Create `frontend/src/lib/auth.ts`:

```typescript
export { api, setAccessToken, getAccessToken } from './api';
```

- [ ] **Step 5: Create Providers wrapper**

Create `frontend/src/components/providers.tsx`:

```typescript
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30 * 1000, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

Update `frontend/src/app/layout.tsx` to wrap with `<Providers>`.

- [ ] **Step 6: Create login page**

Create `frontend/src/app/login/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    api('/auth/status').then((data) => {
      if (data.needsSetup) router.push('/setup');
    });
  }, [router]);

  async function onSubmit(data: LoginForm) {
    try {
      setError('');
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setAccessToken(res.accessToken);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Ship Dock</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" {...register('password')} />
              {errors.password && <p className="text-sm text-red-500 mt-1">{errors.password.message}</p>}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Create setup page**

Create `frontend/src/app/setup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

type SetupForm = z.infer<typeof setupSchema>;

export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
  });

  async function onSubmit(data: SetupForm) {
    try {
      setError('');
      const res = await api('/auth/setup', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setAccessToken(res.accessToken);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Welcome to Ship Dock</CardTitle>
          <CardDescription className="text-center">Create your admin account to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register('name')} />
              {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" {...register('password')} />
              {errors.password && <p className="text-sm text-red-500 mt-1">{errors.password.message}</p>}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Setting up...' : 'Create Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Next.js frontend with auth pages"
```

---

## Task 15: Dashboard + Project List Page

**Files:**
- Create: `frontend/src/app/dashboard/layout.tsx`, `frontend/src/app/dashboard/page.tsx`
- Create: `frontend/src/components/app-sidebar.tsx`
- Create: `frontend/src/components/project-card.tsx`
- Create: `frontend/src/hooks/use-projects.ts`
- Create: `frontend/src/lib/socket.ts`

- [ ] **Step 1: Create socket client**

Create `frontend/src/lib/socket.ts`:

```typescript
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: { token: getAccessToken() },
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getAccessToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
```

- [ ] **Step 2: Create projects hook**

Create `frontend/src/hooks/use-projects.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api('/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => api(`/projects/${id}`),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api('/projects', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}
```

- [ ] **Step 3: Create ProjectCard component**

Create `frontend/src/components/project-card.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-500',
  STOPPED: 'bg-gray-400',
  ERROR: 'bg-red-500',
};

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    slug: string;
    domain?: string;
    status: string;
    deployments: Array<{ version: number; status: string; createdAt: string }>;
  };
}

export function ProjectCard({ project }: ProjectCardProps) {
  const lastDeploy = project.deployments[0];

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-medium">{project.name}</CardTitle>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[project.status] || 'bg-gray-400'}`} />
            <span className="text-sm text-muted-foreground">{project.status}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-muted-foreground">
            {project.domain && <p>{project.domain}</p>}
            {lastDeploy && (
              <p>
                Deploy #{lastDeploy.version}{' '}
                <Badge variant={lastDeploy.status === 'SUCCESS' ? 'default' : 'destructive'} className="text-xs">
                  {lastDeploy.status}
                </Badge>{' '}
                {new Date(lastDeploy.createdAt).toLocaleDateString()}
              </p>
            )}
            {!lastDeploy && <p>No deployments yet</p>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 4: Create app sidebar**

Create `frontend/src/components/app-sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '~' },
  { href: '/domains', label: 'Domains', icon: '@' },
  { href: '/team', label: 'Team', icon: '#' },
  { href: '/settings', label: 'Settings', icon: '*' },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-gray-50/50 min-h-screen p-4">
      <Link href="/dashboard" className="text-xl font-bold mb-8 block">
        Ship Dock
      </Link>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-gray-100'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Create dashboard layout and page**

Create `frontend/src/app/dashboard/layout.tsx`:

```tsx
import { AppSidebar } from '@/components/app-sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

Create `frontend/src/app/dashboard/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useProjects } from '@/hooks/use-projects';
import { ProjectCard } from '@/components/project-card';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { data: projects, isLoading } = useProjects();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link href="/projects/new">
          <Button>New Project</Button>
        </Link>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading...</p>}

      {projects && projects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No projects yet</p>
          <Link href="/projects/new">
            <Button>Create your first project</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map((project: any) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: add dashboard page with project cards and sidebar navigation"
```

---

## Task 16: New Project Wizard

**Files:**
- Create: `frontend/src/app/projects/new/page.tsx`
- Create: `frontend/src/components/new-project-wizard.tsx`
- Create: `frontend/src/components/env-var-editor.tsx`

- [ ] **Step 1: Create EnvVarEditor component**

Create `frontend/src/components/env-var-editor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EnvVarEditorProps {
  value: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
}

export function EnvVarEditor({ value, onChange }: EnvVarEditorProps) {
  const entries = Object.entries(value);

  function addVar() {
    onChange({ ...value, '': '' });
  }

  function updateKey(oldKey: string, newKey: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      updated[k === oldKey ? newKey : k] = v;
    }
    onChange(updated);
  }

  function updateValue(key: string, newValue: string) {
    onChange({ ...value, [key]: newValue });
  }

  function removeVar(key: string) {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, val], i) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder="KEY"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            className="font-mono"
          />
          <Input
            placeholder="value"
            value={val}
            onChange={(e) => updateValue(key, e.target.value)}
            className="font-mono"
          />
          <Button variant="ghost" size="sm" onClick={() => removeVar(key)}>
            X
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addVar}>
        + Add Variable
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create new project wizard page**

Create `frontend/src/app/projects/new/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProject } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnvVarEditor } from '@/components/env-var-editor';

type Step = 'source' | 'basic' | 'env' | 'confirm';

export default function NewProjectPage() {
  const router = useRouter();
  const createProject = useCreateProject();
  const [step, setStep] = useState<Step>('source');
  const [form, setForm] = useState({
    sourceType: '' as 'GITHUB' | 'UPLOAD',
    repoUrl: '',
    branch: 'main',
    name: '',
    slug: '',
    domain: '',
    port: '',
    envVars: {} as Record<string, string>,
  });

  function update(partial: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function handleCreate() {
    await createProject.mutateAsync({
      name: form.name,
      slug: form.slug,
      sourceType: form.sourceType,
      repoUrl: form.sourceType === 'GITHUB' ? form.repoUrl : undefined,
      branch: form.branch,
      domain: form.domain || undefined,
      port: form.port ? parseInt(form.port) : undefined,
      envVars: Object.keys(form.envVars).length > 0 ? form.envVars : undefined,
    });
    router.push('/dashboard');
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>

      {step === 'source' && (
        <Card>
          <CardHeader><CardTitle>Step 1: Source</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant={form.sourceType === 'GITHUB' ? 'default' : 'outline'}
                className="h-24"
                onClick={() => { update({ sourceType: 'GITHUB' }); }}
              >
                GitHub Repository
              </Button>
              <Button
                variant={form.sourceType === 'UPLOAD' ? 'default' : 'outline'}
                className="h-24"
                onClick={() => { update({ sourceType: 'UPLOAD' }); }}
              >
                Upload Files
              </Button>
            </div>
            {form.sourceType === 'GITHUB' && (
              <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input
                  placeholder="https://github.com/user/repo"
                  value={form.repoUrl}
                  onChange={(e) => update({ repoUrl: e.target.value })}
                />
                <Label>Branch</Label>
                <Input
                  value={form.branch}
                  onChange={(e) => update({ branch: e.target.value })}
                />
              </div>
            )}
            <Button onClick={() => setStep('basic')} disabled={!form.sourceType}>
              Next
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'basic' && (
        <Card>
          <CardHeader><CardTitle>Step 2: Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Project Name</Label>
              <Input
                value={form.name}
                onChange={(e) => update({ name: e.target.value, slug: autoSlug(e.target.value) })}
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => update({ slug: e.target.value })}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">Used for directory name and PM2 process</p>
            </div>
            <div>
              <Label>Domain (optional)</Label>
              <Input
                placeholder="app.example.com"
                value={form.domain}
                onChange={(e) => update({ domain: e.target.value })}
              />
            </div>
            <div>
              <Label>Port (optional, auto-assigned if empty)</Label>
              <Input
                type="number"
                placeholder="3001-3999"
                value={form.port}
                onChange={(e) => update({ port: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('source')}>Back</Button>
              <Button onClick={() => setStep('env')} disabled={!form.name || !form.slug}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'env' && (
        <Card>
          <CardHeader><CardTitle>Step 3: Environment Variables</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <EnvVarEditor value={form.envVars} onChange={(envVars) => update({ envVars })} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('basic')}>Back</Button>
              <Button onClick={() => setStep('confirm')}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'confirm' && (
        <Card>
          <CardHeader><CardTitle>Step 4: Confirm</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <p><strong>Source:</strong> {form.sourceType} {form.repoUrl && `(${form.repoUrl})`}</p>
              <p><strong>Name:</strong> {form.name}</p>
              <p><strong>Slug:</strong> {form.slug}</p>
              {form.domain && <p><strong>Domain:</strong> {form.domain}</p>}
              {form.port && <p><strong>Port:</strong> {form.port}</p>}
              {Object.keys(form.envVars).length > 0 && (
                <p><strong>Env vars:</strong> {Object.keys(form.envVars).length} variables</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('env')}>Back</Button>
              <Button onClick={handleCreate} disabled={createProject.isPending}>
                {createProject.isPending ? 'Creating...' : 'Create & Deploy'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/ frontend/src/components/env-var-editor.tsx
git commit -m "feat: add new project wizard with step-by-step form"
```

---

## Task 17: Deployment Detail Page with Realtime Logs

**Files:**
- Create: `frontend/src/app/projects/[id]/deployments/[did]/page.tsx`
- Create: `frontend/src/app/projects/[id]/deployments/page.tsx`
- Create: `frontend/src/components/deploy-log-viewer.tsx`
- Create: `frontend/src/components/stage-progress.tsx`
- Create: `frontend/src/hooks/use-deployments.ts`
- Create: `frontend/src/hooks/use-deploy-logs.ts`

- [ ] **Step 1: Create deployments hooks**

Create `frontend/src/hooks/use-deployments.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDeployments(projectId: string) {
  return useQuery({
    queryKey: ['deployments', projectId],
    queryFn: () => api(`/projects/${projectId}/deployments`),
  });
}

export function useDeployment(deploymentId: string) {
  return useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: () => api(`/projects/_/deployments/${deploymentId}`),
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return data?.status === 'RUNNING' || data?.status === 'QUEUED' ? 3000 : false;
    },
  });
}

export function useTriggerDeploy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${projectId}/deployments`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deployments', projectId] }),
  });
}

export function useCancelDeploy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) =>
      api(`/projects/_/deployments/${deploymentId}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deployments'] }),
  });
}
```

- [ ] **Step 2: Create deploy logs hook**

Create `frontend/src/hooks/use-deploy-logs.ts`:

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '@/lib/socket';

export function useDeployLogs(deploymentId: string) {
  const [logs, setLogs] = useState<Array<{ stage: string; line: string }>>([]);
  const [stageStatuses, setStageStatuses] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());

  useEffect(() => {
    const socket = socketRef.current;
    socket.emit('join-deployment', deploymentId);

    socket.on('log', (data: { index?: number; stage?: string; line: string }) => {
      setLogs((prev) => [...prev, { stage: data.stage || `stage-${data.index}`, line: data.line }]);
    });

    socket.on('stage-start', (data: { index: number; name: string }) => {
      setStageStatuses((prev) => ({ ...prev, [data.index]: 'RUNNING' }));
    });

    socket.on('stage-end', (data: { index: number; success: boolean }) => {
      setStageStatuses((prev) => ({
        ...prev,
        [data.index]: data.success ? 'SUCCESS' : 'FAILED',
      }));
    });

    socket.on('status', (data: { status: string }) => {
      setStatus(data.status);
    });

    return () => {
      socket.emit('leave-deployment', deploymentId);
      socket.off('log');
      socket.off('stage-start');
      socket.off('stage-end');
      socket.off('status');
    };
  }, [deploymentId]);

  return { logs, stageStatuses, status };
}
```

- [ ] **Step 3: Create StageProgress component**

Create `frontend/src/components/stage-progress.tsx`:

```tsx
'use client';

const statusIcons: Record<string, string> = {
  PENDING: 'o',
  RUNNING: '...',
  SUCCESS: 'v',
  FAILED: 'x',
};

const statusColors: Record<string, string> = {
  PENDING: 'text-muted-foreground',
  RUNNING: 'text-yellow-500',
  SUCCESS: 'text-green-500',
  FAILED: 'text-red-500',
};

interface StageProgressProps {
  stages: Array<{ name: string; status: string }>;
  activeIndex?: number;
  onStageClick?: (index: number) => void;
}

export function StageProgress({ stages, activeIndex, onStageClick }: StageProgressProps) {
  return (
    <div className="space-y-1">
      {stages.map((stage, i) => (
        <button
          key={i}
          onClick={() => onStageClick?.(i)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
            i === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'
          }`}
        >
          <span className={`font-mono ${statusColors[stage.status] || 'text-muted-foreground'}`}>
            [{statusIcons[stage.status] || '?'}]
          </span>
          <span>{stage.name}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create DeployLogViewer component**

Create `frontend/src/components/deploy-log-viewer.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DeployLogViewerProps {
  logs: Array<{ stage: string; line: string }>;
}

export function DeployLogViewer({ logs }: DeployLogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <ScrollArea className="h-[600px] rounded-md border bg-gray-950 p-4">
      <pre className="text-sm font-mono text-green-400 whitespace-pre-wrap">
        {logs.map((log, i) => (
          <div key={i}>
            <span className="text-gray-500">[{log.stage}]</span> {log.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </pre>
    </ScrollArea>
  );
}
```

- [ ] **Step 5: Create deployment detail page**

Create `frontend/src/app/projects/[id]/deployments/[did]/page.tsx`:

```tsx
'use client';

import { use } from 'react';
import { useDeployment, useCancelDeploy } from '@/hooks/use-deployments';
import { useDeployLogs } from '@/hooks/use-deploy-logs';
import { StageProgress } from '@/components/stage-progress';
import { DeployLogViewer } from '@/components/deploy-log-viewer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';

export default function DeploymentDetailPage({
  params,
}: {
  params: Promise<{ id: string; did: string }>;
}) {
  const { id: projectId, did: deploymentId } = use(params);
  const { data: deployment } = useDeployment(deploymentId);
  const { logs, stageStatuses } = useDeployLogs(deploymentId);
  const cancelDeploy = useCancelDeploy();
  const [activeStage, setActiveStage] = useState(0);

  if (!deployment) return <p>Loading...</p>;

  const stages = (deployment.stages as any[]).map((s: any, i: number) => ({
    ...s,
    status: stageStatuses[i] || s.status,
  }));

  const isRunning = deployment.status === 'RUNNING' || deployment.status === 'QUEUED';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            Deploy #{deployment.version}
          </h1>
          <Badge
            variant={
              deployment.status === 'SUCCESS'
                ? 'default'
                : deployment.status === 'FAILED'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {deployment.status}
          </Badge>
        </div>
        {isRunning && (
          <Button
            variant="destructive"
            onClick={() => cancelDeploy.mutate(deploymentId)}
          >
            Cancel
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[250px_1fr] gap-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Stages</h3>
          <StageProgress
            stages={stages}
            activeIndex={activeStage}
            onStageClick={setActiveStage}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Output</h3>
          <DeployLogViewer logs={logs} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create deployment history page**

Create `frontend/src/app/projects/[id]/deployments/page.tsx`:

```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import { useDeployments, useTriggerDeploy } from '@/hooks/use-deployments';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function DeploymentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { data: deployments, isLoading } = useDeployments(projectId);
  const triggerDeploy = useTriggerDeploy(projectId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Deployments</h2>
        <Button onClick={() => triggerDeploy.mutate()} disabled={triggerDeploy.isPending}>
          {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
        </Button>
      </div>

      {isLoading && <p>Loading...</p>}

      <div className="space-y-2">
        {deployments?.map((d: any) => (
          <Link
            key={d.id}
            href={`/projects/${projectId}/deployments/${d.id}`}
            className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-medium">#{d.version}</span>
              <Badge
                variant={
                  d.status === 'SUCCESS'
                    ? 'default'
                    : d.status === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {d.status}
              </Badge>
              {d.triggeredBy && (
                <span className="text-sm text-muted-foreground">
                  by {d.triggeredBy.name}
                </span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              {new Date(d.createdAt).toLocaleString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat: add deployment detail page with realtime log streaming"
```

---

## Task 18: Pipeline Editor Page

**Files:**
- Create: `frontend/src/app/projects/[id]/pipeline/page.tsx`
- Create: `frontend/src/components/pipeline-editor.tsx`

- [ ] **Step 1: Create PipelineEditor component**

Create `frontend/src/components/pipeline-editor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface Stage {
  name: string;
  type: 'builtin' | 'command';
  command?: string;
  config?: Record<string, any>;
}

interface PipelineEditorProps {
  stages: Stage[];
  onChange: (stages: Stage[]) => void;
}

function SortableStage({
  stage,
  index,
  onUpdate,
  onRemove,
}: {
  stage: Stage;
  index: number;
  onUpdate: (index: number, stage: Stage) => void;
  onRemove: (index: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `stage-${index}`,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 mb-2">
      <div {...attributes} {...listeners} className="cursor-grab px-2 text-muted-foreground">
        ::
      </div>
      <Card className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <Input
            value={stage.name}
            onChange={(e) => onUpdate(index, { ...stage, name: e.target.value })}
            className="w-32 font-mono text-sm"
            placeholder="name"
          />
          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
            {stage.type}
          </span>
          {stage.type === 'command' && (
            <Input
              value={stage.command || ''}
              onChange={(e) => onUpdate(index, { ...stage, command: e.target.value })}
              className="flex-1 font-mono text-sm"
              placeholder="command"
            />
          )}
          {stage.type === 'builtin' && (
            <span className="text-sm text-muted-foreground flex-1">System managed</span>
          )}
          {stage.type === 'command' && (
            <Button variant="ghost" size="sm" onClick={() => onRemove(index)}>
              X
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export function PipelineEditor({ stages, onChange }: PipelineEditorProps) {
  const sensors = useSensors(useSensor(PointerSensor));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = parseInt((active.id as string).replace('stage-', ''));
    const newIndex = parseInt((over.id as string).replace('stage-', ''));
    onChange(arrayMove(stages, oldIndex, newIndex));
  }

  function addStage() {
    onChange([...stages, { name: '', type: 'command', command: '' }]);
  }

  function updateStage(index: number, stage: Stage) {
    const updated = [...stages];
    updated[index] = stage;
    onChange(updated);
  }

  function removeStage(index: number) {
    onChange(stages.filter((_, i) => i !== index));
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={stages.map((_, i) => `stage-${i}`)}
          strategy={verticalListSortingStrategy}
        >
          {stages.map((stage, i) => (
            <SortableStage
              key={`stage-${i}`}
              stage={stage}
              index={i}
              onUpdate={updateStage}
              onRemove={removeStage}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button variant="outline" onClick={addStage} className="mt-2">
        + Add Stage
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create pipeline page**

Create `frontend/src/app/projects/[id]/pipeline/page.tsx`:

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
import { PipelineEditor } from '@/components/pipeline-editor';
import { Button } from '@/components/ui/button';

export default function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const [stages, setStages] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project?.pipeline) {
      setStages((project.pipeline as any).stages || []);
    }
  }, [project]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await api(`/projects/${projectId}/pipeline`, {
      method: 'PATCH',
      body: JSON.stringify({ stages }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!project) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Pipeline</h2>
        <div className="flex items-center gap-2">
          {saved && <span className="text-sm text-green-500">Saved!</span>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Pipeline'}
          </Button>
        </div>
      </div>
      <PipelineEditor stages={stages} onChange={setStages} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/\[id\]/pipeline/ frontend/src/components/pipeline-editor.tsx
git commit -m "feat: add pipeline editor with drag-and-drop stage ordering"
```

---

## Task 19: Project Detail, Settings, Domains, Team, and Settings Pages

**Files:**
- Create: `frontend/src/app/projects/[id]/page.tsx`
- Create: `frontend/src/app/projects/[id]/settings/page.tsx`
- Create: `frontend/src/app/domains/page.tsx`
- Create: `frontend/src/app/team/page.tsx`
- Create: `frontend/src/app/settings/page.tsx`
- Create: `frontend/src/app/invite/[token]/page.tsx`

- [ ] **Step 1: Create project detail page (redirects to deployments)**

Create `frontend/src/app/projects/[id]/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/deployments`);
}
```

- [ ] **Step 2: Create project settings page**

Create `frontend/src/app/projects/[id]/settings/page.tsx`:

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProject, useDeleteProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnvVarEditor } from '@/components/env-var-editor';

export default function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const deleteProject = useDeleteProject();
  const [domain, setDomain] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setDomain(project.domain || '');
    }
  }, [project]);

  async function handleSave() {
    setSaving(true);
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        domain: domain || undefined,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      }),
    });
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm('Are you sure? This will stop the PM2 process and remove nginx config.')) return;
    await deleteProject.mutateAsync(projectId);
    router.push('/dashboard');
  }

  if (!project) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Project Settings</h2>

      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={project.name} disabled />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={project.slug} disabled className="font-mono" />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={project.port} disabled />
          </div>
          <div>
            <Label>Domain</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Environment Variables</CardTitle></CardHeader>
        <CardContent>
          <EnvVarEditor value={envVars} onChange={setEnvVars} />
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="destructive" onClick={handleDelete}>
          Delete Project
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create domains management page**

Create `frontend/src/app/domains/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DomainsPage() {
  const queryClient = useQueryClient();
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api('/domains/providers'),
  });

  const [form, setForm] = useState({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' });

  const addProvider = useMutation({
    mutationFn: (data: any) =>
      api('/domains/providers', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setForm({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' });
    },
  });

  const deleteProvider = useMutation({
    mutationFn: (id: string) => api(`/domains/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Domain Providers</h1>

      <Card className="mb-6">
        <CardHeader><CardTitle>Add Provider</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={form.provider === 'NAMECHEAP' ? 'default' : 'outline'}
              onClick={() => setForm((f) => ({ ...f, provider: 'NAMECHEAP' }))}
            >
              Namecheap
            </Button>
            <Button
              variant={form.provider === 'GODADDY' ? 'default' : 'outline'}
              onClick={() => setForm((f) => ({ ...f, provider: 'GODADDY' }))}
            >
              GoDaddy
            </Button>
          </div>
          <div>
            <Label>API Key</Label>
            <Input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
          </div>
          <div>
            <Label>API Secret</Label>
            <Input type="password" value={form.apiSecret} onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} />
          </div>
          <Button onClick={() => addProvider.mutate(form)} disabled={addProvider.isPending}>
            Add Provider
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {providers?.map((p: any) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{p.provider}</p>
                <p className="text-sm text-muted-foreground font-mono">Key: {p.apiKey} | Secret: {p.apiSecret}</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => deleteProvider.mutate(p.id)}>
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create team management page**

Create `frontend/src/app/team/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function TeamPage() {
  const queryClient = useQueryClient();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const [inviteRole, setInviteRole] = useState('DEVELOPER');
  const [inviteLink, setInviteLink] = useState('');

  const createInvite = useMutation({
    mutationFn: (role: string) =>
      api('/users/invite', { method: 'POST', body: JSON.stringify({ role }) }),
    onSuccess: (data: any) => {
      setInviteLink(`${window.location.origin}/invite/${data.token}`);
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Team</h1>

      <Card className="mb-6">
        <CardHeader><CardTitle>Invite Member</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {['ADMIN', 'DEVELOPER', 'VIEWER'].map((role) => (
              <Button
                key={role}
                variant={inviteRole === role ? 'default' : 'outline'}
                size="sm"
                onClick={() => setInviteRole(role)}
              >
                {role}
              </Button>
            ))}
          </div>
          <Button onClick={() => createInvite.mutate(inviteRole)} disabled={createInvite.isPending}>
            Generate Invite Link
          </Button>
          {inviteLink && (
            <div className="p-3 bg-muted rounded">
              <p className="text-sm font-mono break-all">{inviteLink}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => navigator.clipboard.writeText(inviteLink)}
              >
                Copy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {users?.map((user: any) => (
          <Card key={user.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Badge>{user.role}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create invite accept page**

Create `frontend/src/app/invite/[token]/page.tsx`:

```tsx
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: any) {
    try {
      setError('');
      await api('/users/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ ...data, token }),
      });
      router.push('/login');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Join Ship Dock</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-sm text-red-500">{(errors.name as any).message}</p>}
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-red-500">{(errors.email as any).message}</p>}
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" {...register('password')} />
              {errors.password && <p className="text-sm text-red-500">{(errors.password as any).message}</p>}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Joining...' : 'Create Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Create system settings page (placeholder)**

Create `frontend/src/app/settings/page.tsx`:

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">System Settings</h1>

      <Card>
        <CardHeader><CardTitle>Server Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Projects Directory</Label>
            <Input value="/var/www" disabled />
          </div>
          <div>
            <Label>Port Range</Label>
            <Input value="3001 - 3999" disabled />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat: add project settings, domains, team, invite, and system settings pages"
```

---

## Task 20: Integration Wiring + Final Verification

**Files:**
- Modify: `backend/src/app.module.ts` (ensure all modules imported)
- Modify: `frontend/src/app/layout.tsx` (ensure providers wrapped)

- [ ] **Step 1: Verify backend AppModule has all imports**

Read `backend/src/app.module.ts` and ensure it imports: `ConfigModule`, `BullModule`, `CommonModule`, `AuthModule`, `UsersModule`, `ProjectsModule`, `DeployModule`, `DomainsModule`, `UploadModule`.

- [ ] **Step 2: Verify frontend layout wraps with Providers**

Read `frontend/src/app/layout.tsx` and ensure it wraps children with `<Providers>`.

- [ ] **Step 3: Run all backend tests**

```bash
cd /Users/noah/Work/idea/ship-dock/backend
npx jest --no-cache
```

Expected: All tests PASS.

- [ ] **Step 4: Run frontend build check**

```bash
cd /Users/noah/Work/idea/ship-dock/frontend
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire up all modules and verify build"
```
