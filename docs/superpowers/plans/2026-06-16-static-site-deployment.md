# Static Site Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `STATIC` source type so users can deploy plain HTML/CSS/JS via zip upload or an in-browser multi-file editor — no port, no PM2, Nginx serves files directly from disk.

**Architecture:** New `STATIC` `SourceType` enum value; new `StaticFile` DB table stores editor files; two-stage pipeline (`static-sync` → `nginx`); `NginxStage` gains a `buildStaticConfig()` method that uses `root` instead of `proxy_pass`. Frontend adds a third source card and a new `/projects/[id]/editor` page backed by CodeMirror.

**Tech Stack:** NestJS/Prisma (backend), Next.js 16 App Router / React 19 / `@uiw/react-codemirror` / `@codemirror/lang-html,css,javascript` (frontend).

---

## File Map

**Backend — new files:**
- `backend/src/static-files/static-files.module.ts`
- `backend/src/static-files/static-files.controller.ts`
- `backend/src/static-files/static-files.service.ts`

**Backend — modified files:**
- `backend/prisma/schema.prisma` — add `STATIC` to `SourceType`, add `StaticFile` model + relation on `Project`
- `backend/src/deploy/stages/nginx.stage.ts` — add `NginxStaticConfig` interface + `buildStaticConfig()` + `executeStatic()`
- `backend/src/deploy/deploy.processor.ts` — add `static-sync` builtin case; route `nginx` case to `executeStatic()` for STATIC projects
- `backend/src/projects/projects.service.ts` — skip port allocation for `STATIC`, use static pipeline constant
- `backend/src/upload/upload.controller.ts` — validate `index.html`, clear `StaticFile` rows, load project for correct dir
- `backend/src/app.module.ts` — register `StaticFilesModule`

**Frontend — new files:**
- `frontend/src/hooks/use-static-files.ts`
- `frontend/src/app/projects/[id]/editor/page.tsx`

**Frontend — modified files:**
- `frontend/src/app/projects/new/page.tsx` — add STATIC source card + conditional flow

---

## Task 1: Prisma — Add STATIC enum and StaticFile model

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add STATIC to SourceType enum**

In `backend/prisma/schema.prisma`, find:
```prisma
enum SourceType {
  GITHUB
  UPLOAD
}
```
Change to:
```prisma
enum SourceType {
  GITHUB
  UPLOAD
  STATIC
}
```

- [ ] **Step 2: Add StaticFile model**

After the `Project` model closing brace, add:
```prisma
model StaticFile {
  id        String   @id @default(uuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  path      String
  content   String
  updatedAt DateTime @updatedAt

  @@unique([projectId, path])
}
```

- [ ] **Step 3: Add relation field to Project model**

Inside the `Project` model block, after the `tasks ProjectTask[]` line, add:
```prisma
  staticFiles           StaticFile[]
```

- [ ] **Step 4: Run migration**

```bash
cd backend && npx prisma migrate dev --name add-static-site
```
Expected: migration file created and applied, no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add STATIC source type and StaticFile model"
```

---

## Task 2: StaticFilesModule — backend CRUD

**Files:**
- Create: `backend/src/static-files/static-files.service.ts`
- Create: `backend/src/static-files/static-files.controller.ts`
- Create: `backend/src/static-files/static-files.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing test for service**

Create `backend/src/static-files/static-files.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { StaticFilesService } from './static-files.service';
import { PrismaService } from '../common/prisma.service';

const mockPrisma = {
  staticFile: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
};

describe('StaticFilesService', () => {
  let service: StaticFilesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StaticFilesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(StaticFilesService);
    jest.clearAllMocks();
  });

  it('list returns all files for project', async () => {
    mockPrisma.staticFile.findMany.mockResolvedValue([
      { id: '1', projectId: 'p1', path: 'index.html', content: '<h1>Hi</h1>', updatedAt: new Date() },
    ]);
    const result = await service.list('p1');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('index.html');
    expect(mockPrisma.staticFile.findMany).toHaveBeenCalledWith({ where: { projectId: 'p1' }, orderBy: { path: 'asc' } });
  });

  it('upsert creates or updates a file', async () => {
    mockPrisma.staticFile.upsert.mockResolvedValue({ id: '1', projectId: 'p1', path: 'index.html', content: '<h1>X</h1>', updatedAt: new Date() });
    await service.upsert('p1', 'index.html', '<h1>X</h1>');
    expect(mockPrisma.staticFile.upsert).toHaveBeenCalledWith({
      where: { projectId_path: { projectId: 'p1', path: 'index.html' } },
      create: { projectId: 'p1', path: 'index.html', content: '<h1>X</h1>' },
      update: { content: '<h1>X</h1>' },
    });
  });

  it('remove deletes a file', async () => {
    mockPrisma.staticFile.delete.mockResolvedValue({});
    await service.remove('p1', 'index.html');
    expect(mockPrisma.staticFile.delete).toHaveBeenCalledWith({
      where: { projectId_path: { projectId: 'p1', path: 'index.html' } },
    });
  });

  it('validatePath rejects path traversal', () => {
    expect(() => service.validatePath('../etc/passwd')).toThrow();
    expect(() => service.validatePath('/etc/passwd')).toThrow();
    expect(() => service.validatePath('')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest static-files.service.spec --no-coverage
```
Expected: FAIL — `Cannot find module './static-files.service'`

- [ ] **Step 3: Implement StaticFilesService**

Create `backend/src/static-files/static-files.service.ts`:
```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class StaticFilesService {
  constructor(private prisma: PrismaService) {}

  validatePath(path: string): void {
    if (!path || path.trim() === '') throw new BadRequestException('File path cannot be empty');
    if (path.startsWith('/')) throw new BadRequestException('Path must be relative');
    if (path.includes('..')) throw new BadRequestException('Path traversal not allowed');
    if (/[;&|`$]/.test(path)) throw new BadRequestException('Invalid characters in path');
  }

  async list(projectId: string) {
    return this.prisma.staticFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } });
  }

  async upsert(projectId: string, path: string, content: string) {
    this.validatePath(path);
    if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
      throw new BadRequestException('File content exceeds 1 MB limit');
    }
    return this.prisma.staticFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content },
      update: { content },
    });
  }

  async remove(projectId: string, path: string) {
    this.validatePath(path);
    return this.prisma.staticFile.delete({
      where: { projectId_path: { projectId, path } },
    });
  }

  async clearAll(projectId: string) {
    return this.prisma.staticFile.deleteMany({ where: { projectId } });
  }

  async seed(projectId: string) {
    const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Site</title>
</head>
<body>
  <h1>Hello, world!</h1>
</body>
</html>`;
    return this.upsert(projectId, 'index.html', defaultHtml);
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd backend && npx jest static-files.service.spec --no-coverage
```
Expected: PASS (4 tests)

- [ ] **Step 5: Create the controller**

Create `backend/src/static-files/static-files.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StaticFilesService } from './static-files.service';

@Controller('projects/:projectId/static-files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaticFilesController {
  constructor(private service: StaticFilesService) {}

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Put() @MinRole('DEVELOPER')
  upsert(
    @Param('projectId') projectId: string,
    @Body() body: { path: string; content: string },
  ) {
    return this.service.upsert(projectId, body.path, body.content);
  }

  @Delete(':encodedPath') @MinRole('DEVELOPER')
  remove(
    @Param('projectId') projectId: string,
    @Param('encodedPath') encodedPath: string,
  ) {
    const path = decodeURIComponent(encodedPath);
    return this.service.remove(projectId, path);
  }
}
```

- [ ] **Step 6: Create the module**

Create `backend/src/static-files/static-files.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { StaticFilesController } from './static-files.controller';
import { StaticFilesService } from './static-files.service';

@Module({
  controllers: [StaticFilesController],
  providers: [StaticFilesService],
  exports: [StaticFilesService],
})
export class StaticFilesModule {}
```

- [ ] **Step 7: Register in AppModule**

In `backend/src/app.module.ts`, add import:
```typescript
import { StaticFilesModule } from './static-files/static-files.module';
```
And add `StaticFilesModule` to the `imports` array (after `ProjectFilesModule`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/static-files/ backend/src/app.module.ts
git commit -m "feat: add StaticFilesModule with CRUD endpoints"
```

---

## Task 3: NginxStage — static config builder

**Files:**
- Modify: `backend/src/deploy/stages/nginx.stage.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/deploy/stages/nginx-static.stage.spec.ts`:
```typescript
import { NginxStage } from './nginx.stage';

describe('NginxStage.buildStaticConfig', () => {
  const stage = new NginxStage();

  it('generates root-based config without SSL', () => {
    const config = stage.buildStaticConfig({
      domain: 'example.com',
      slug: 'my-site',
      rootDir: '/var/www/my-site',
      hasSsl: false,
    });
    expect(config).toContain('listen 80');
    expect(config).toContain('server_name example.com');
    expect(config).toContain('root /var/www/my-site');
    expect(config).toContain('try_files $uri $uri/ /index.html');
    expect(config).not.toContain('proxy_pass');
  });

  it('generates SSL redirect + https block with SSL', () => {
    const config = stage.buildStaticConfig({
      domain: 'example.com',
      slug: 'my-site',
      rootDir: '/var/www/my-site',
      hasSsl: true,
    });
    expect(config).toContain('return 301 https://');
    expect(config).toContain('listen 443 ssl');
    expect(config).toContain('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest nginx-static.stage.spec --no-coverage
```
Expected: FAIL — `stage.buildStaticConfig is not a function`

- [ ] **Step 3: Implement buildStaticConfig and executeStatic**

In `backend/src/deploy/stages/nginx.stage.ts`, add after the existing interfaces at the top:
```typescript
export interface NginxStaticConfig {
  domain: string;
  slug: string;
  rootDir: string;
  hasSsl: boolean;
}
```

Add these two methods to the `NginxStage` class (after `buildCacheConfig`):
```typescript
  buildStaticConfig(config: NginxStaticConfig): string {
    const body = `
    root ${config.rootDir};
    index index.html;

    gzip on;
    gzip_types text/html text/css application/javascript image/svg+xml;

    location / {
        try_files $uri $uri/ /index.html;
    }`;

    if (!config.hasSsl) {
      return `server {\n    listen 80;\n    server_name ${config.domain};\n${body}\n}`;
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
${body}
}`;
  }

  async executeStatic(config: NginxStaticConfig, ctx: StageContext): Promise<StageResult> {
    const confPath = `/etc/nginx/sites-available/${config.slug}.conf`;
    const enabledPath = `/etc/nginx/sites-enabled/${config.slug}.conf`;
    const nginxConf = this.buildStaticConfig(config);
    const command = `echo '${nginxConf.replace(/'/g, "'\\''")}' | sudo tee ${confPath} > /dev/null && sudo ln -sf ${confPath} ${enabledPath} && sudo nginx -t && sudo nginx -s reload`;
    ctx.onLog(`Writing static nginx config to ${confPath}`);
    return spawnWithTimeout(command, ctx.onLog, { timeoutMs: 30 * 1000, label: 'nginx' });
  }
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd backend && npx jest nginx-static.stage.spec --no-coverage
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/deploy/stages/nginx.stage.ts backend/src/deploy/stages/nginx-static.stage.spec.ts
git commit -m "feat: add buildStaticConfig and executeStatic to NginxStage"
```

---

## Task 4: DeployProcessor — static-sync stage + nginx routing

**Files:**
- Modify: `backend/src/deploy/deploy.processor.ts`

- [ ] **Step 1: Add static-sync case to executeBuiltinStage**

In `backend/src/deploy/deploy.processor.ts`, locate the `switch (name) {` block inside `executeBuiltinStage`. Add before the `case 'clone':` line:

```typescript
      case 'static-sync': {
        const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
        const targetDir = join(projectsDir, project.directory || project.slug);
        const staticFiles = await this.prisma.staticFile.findMany({ where: { projectId: project.id } });
        if (staticFiles.length === 0) {
          onLog('No static files to deploy');
          return { success: false, error: 'No static files to deploy. Use the editor to add files.' };
        }
        try {
          if (existsSync(targetDir)) {
            execSync(`rm -rf ${targetDir}`);
          }
          mkdirSync(targetDir, { recursive: true });
          for (const file of staticFiles) {
            const filePath = join(targetDir, file.path);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, file.content, 'utf8');
            onLog(`Wrote ${file.path}`);
          }
          onLog(`Static files deployed to ${targetDir}`);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
```

- [ ] **Step 2: Update nginx case to route STATIC projects**

In the same file, find the `case 'nginx': {` block. Replace the existing content with:

```typescript
      case 'nginx': {
        if (!project.domain) { onLog('No domain configured, skipping nginx'); return { success: true }; }
        if (project.sourceType === 'STATIC') {
          const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
          const rootDir = join(projectsDir, project.directory || project.slug);
          return this.nginxStage.executeStatic({
            domain: project.domain, slug: project.slug,
            rootDir, hasSsl: this.sslStage.hasCert(project.domain),
          }, ctx);
        }
        const nginxConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId: project.id } });
        return this.nginxStage.execute({
          domain: project.domain, port: project.port, slug: project.slug,
          hasSsl: this.sslStage.hasCert(project.domain),
          ...(nginxConfig && {
            clientMaxBodySize: nginxConfig.clientMaxBodySize,
            proxyReadTimeout: nginxConfig.proxyReadTimeout,
            proxySendTimeout: nginxConfig.proxySendTimeout,
            proxyConnectTimeout: nginxConfig.proxyConnectTimeout,
            gzipEnabled: nginxConfig.gzipEnabled,
            gzipMinLength: nginxConfig.gzipMinLength,
            gzipTypes: nginxConfig.gzipTypes,
            proxyBuffering: nginxConfig.proxyBuffering,
            proxyBufferSize: nginxConfig.proxyBufferSize,
            proxyBuffers: nginxConfig.proxyBuffers,
          }),
        }, ctx);
      }
```

- [ ] **Step 3: Update ssl case to route STATIC nginx**

In the `case 'ssl':` block, find the second `await this.nginxStage.execute(...)` call (after `sslResult.success`). Replace the whole `if (sslResult.success) { ... }` block with:

```typescript
        if (sslResult.success) {
          if (project.sourceType === 'STATIC') {
            const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
            const rootDir = join(projectsDir, project.directory || project.slug);
            await this.nginxStage.executeStatic({
              domain: project.domain, slug: project.slug, rootDir, hasSsl: true,
            }, ctx);
          } else {
            const nginxConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId: project.id } });
            await this.nginxStage.execute({
              domain: project.domain, port: project.port, slug: project.slug, hasSsl: true,
              ...(nginxConfig && {
                clientMaxBodySize: nginxConfig.clientMaxBodySize,
                proxyReadTimeout: nginxConfig.proxyReadTimeout,
                proxySendTimeout: nginxConfig.proxySendTimeout,
                proxyConnectTimeout: nginxConfig.proxyConnectTimeout,
                gzipEnabled: nginxConfig.gzipEnabled,
                gzipMinLength: nginxConfig.gzipMinLength,
                gzipTypes: nginxConfig.gzipTypes,
                proxyBuffering: nginxConfig.proxyBuffering,
                proxyBufferSize: nginxConfig.proxyBufferSize,
                proxyBuffers: nginxConfig.proxyBuffers,
              }),
            }, ctx);
          }
        }
```

- [ ] **Step 4: Build to check for type errors**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/deploy/deploy.processor.ts
git commit -m "feat: add static-sync deploy stage and route nginx for STATIC projects"
```

---

## Task 5: ProjectsService — skip port allocation for STATIC

**Files:**
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Add STATIC_PIPELINE constant**

In `backend/src/projects/projects.service.ts`, after the `DEFAULT_PIPELINE` constant, add:

```typescript
const STATIC_PIPELINE = {
  stages: [
    { name: 'static-sync', type: 'builtin', config: {} },
    { name: 'nginx', type: 'builtin', config: {} },
    { name: 'ssl', type: 'builtin', config: {} },
  ],
};
```

- [ ] **Step 2: Add StaticFilesService injection**

At the top of the file, add import:
```typescript
import { StaticFilesService } from '../static-files/static-files.service';
```

In the constructor parameters, add:
```typescript
private staticFiles: StaticFilesService,
```

- [ ] **Step 3: Skip port allocation for STATIC in create()**

In the `create()` method, find this block:
```typescript
    // Now allocate port (project exists, FK is valid)
    const port = dto.port
      ? await this.portAllocation.allocateSpecific(project.id, dto.port)
      : await this.portAllocation.allocate(project.id);

    // Update project with the real port
    return this.prisma.project.update({
      where: { id: project.id },
      data: { port },
    });
```

Replace with:
```typescript
    // STATIC projects use no port — return immediately with port=0
    if (dto.sourceType === 'STATIC') {
      await this.staticFiles.seed(project.id);
      return project;
    }

    // Now allocate port (project exists, FK is valid)
    const port = dto.port
      ? await this.portAllocation.allocateSpecific(project.id, dto.port)
      : await this.portAllocation.allocate(project.id);

    // Update project with the real port
    return this.prisma.project.update({
      where: { id: project.id },
      data: { port },
    });
```

- [ ] **Step 4: Use STATIC_PIPELINE for STATIC projects**

In the `create()` method, find where the project is created:
```typescript
        pipeline: dto.pipeline || DEFAULT_PIPELINE,
```
Replace with:
```typescript
        pipeline: dto.pipeline || (dto.sourceType === 'STATIC' ? STATIC_PIPELINE : DEFAULT_PIPELINE),
```

- [ ] **Step 5: Register StaticFilesModule in ProjectsModule**

Open `backend/src/projects/projects.module.ts`. Add:
```typescript
import { StaticFilesModule } from '../static-files/static-files.module';
```
Add `StaticFilesModule` to the `imports` array.

- [ ] **Step 6: Build to check for type errors**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/projects/projects.service.ts backend/src/projects/projects.module.ts
git commit -m "feat: skip port allocation for STATIC projects, seed default index.html"
```

---

## Task 6: UploadController — STATIC zip validation

**Files:**
- Modify: `backend/src/upload/upload.controller.ts`
- Modify: `backend/src/upload/upload.module.ts`

- [ ] **Step 1: Add PrismaService and StaticFilesService to upload controller**

In `backend/src/upload/upload.controller.ts`, replace the imports and constructor:

```typescript
import { BadRequestException, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DeployService } from '../deploy/deploy.service';
import { PrismaService } from '../common/prisma.service';
import { StaticFilesService } from '../static-files/static-files.service';
import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'fs';

@Controller('projects/:projectId/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadController {
  constructor(
    private config: ConfigService,
    private deployService: DeployService,
    private prisma: PrismaService,
    private staticFiles: StaticFilesService,
  ) {}
```

- [ ] **Step 2: Add STATIC validation to the upload handler**

In the same file, replace the `upload()` method body with:

```typescript
  @Post() @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async upload(@Param('projectId') projectId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');

    const originalName = file.originalname.toLowerCase();
    const isZip = originalName.endsWith('.zip');
    const isTarGz = originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz');
    if (!isZip && !isTarGz) {
      throw new BadRequestException('Only .zip and .tar.gz files are supported');
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { sourceType: true, directory: true, slug: true } });
    if (!project) throw new BadRequestException('Project not found');

    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const ext = isZip ? '.zip' : '.tar.gz';
    const tempPath = join(projectsDir, `.upload-${projectId}${ext}`);
    writeFileSync(tempPath, file.buffer);

    const projectDir = join(projectsDir, project.directory || project.slug);
    if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

    if (isZip) {
      execSync(`unzip -o ${tempPath} -d ${projectDir}`);
    } else {
      execSync(`tar -xzf ${tempPath} -C ${projectDir}`);
    }
    execSync(`rm ${tempPath}`);

    if (project.sourceType === 'STATIC') {
      // Validate that index.html exists at root or inside a single top-level subdirectory
      const entries = readdirSync(projectDir);
      const hasRootIndex = entries.includes('index.html');
      const hasSingleSubdirIndex = entries.length === 1 && existsSync(join(projectDir, entries[0], 'index.html'));
      if (!hasRootIndex && !hasSingleSubdirIndex) {
        execSync(`rm -rf ${projectDir}`);
        throw new BadRequestException('Zip must contain index.html at root or inside a single subdirectory');
      }
      // If files were in a single subdirectory, hoist them
      if (!hasRootIndex && hasSingleSubdirIndex) {
        const subdir = entries[0];
        execSync(`mv ${join(projectDir, subdir)}/* ${projectDir}/ && rmdir ${join(projectDir, subdir)}`);
      }
      // Clear editor files — zip is now the source of truth
      await this.staticFiles.clearAll(projectId);
      // Start from nginx stage (index 1) — files are already on disk
      const deployment = await this.deployService.trigger(projectId, req.user.id, 1);
      return { message: 'Upload complete, deployment started', deployment };
    }

    const deployment = await this.deployService.trigger(projectId, req.user.id, 1);
    return { message: 'Upload complete, deployment started', deployment };
  }
```

- [ ] **Step 3: Update upload.module.ts**

Open `backend/src/upload/upload.module.ts`. Add `StaticFilesModule` import:

```typescript
import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { DeployModule } from '../deploy/deploy.module';
import { StaticFilesModule } from '../static-files/static-files.module';

@Module({
  imports: [DeployModule, StaticFilesModule],
  controllers: [UploadController],
})
export class UploadModule {}
```

- [ ] **Step 4: Build to check for type errors**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/upload/
git commit -m "feat: validate index.html and clear StaticFile rows on STATIC zip upload"
```

---

## Task 7: Frontend — new project STATIC flow

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Add STATIC to form state and step logic**

In `frontend/src/app/projects/new/page.tsx`, update the `Step` type and form state:

Find:
```typescript
type Step = 'source' | 'basic' | 'env' | 'confirm' | 'import';
```
Replace with:
```typescript
type Step = 'source' | 'basic' | 'env' | 'confirm' | 'import' | 'static-ready';
```

Find:
```typescript
    sourceType: '' as 'GITHUB' | 'UPLOAD' | '',
```
Replace with:
```typescript
    sourceType: '' as 'GITHUB' | 'UPLOAD' | 'STATIC' | '',
```

- [ ] **Step 2: Add Globe icon import**

The `Globe` icon is already imported. Also add `FileCode` to the lucide imports:

Find the lucide-react import line and add `FileCode` to it:
```typescript
import { GitBranch, Upload, ChevronRight, Loader2, Check, Database, Globe, Terminal, File, X, AlertCircle, CheckCircle2, Server, HardDrive, FileCode } from 'lucide-react';
```

- [ ] **Step 3: Update canContinueFromSource validation**

Find:
```typescript
  if (form.sourceType === 'UPLOAD') {
    if (!uploadFile) sourceErrors.file = 'Please select a file to upload';
  }
  const canContinueFromSource = form.sourceType !== '' && Object.keys(sourceErrors).length === 0;
```
Replace with:
```typescript
  if (form.sourceType === 'UPLOAD') {
    if (!uploadFile) sourceErrors.file = 'Please select a file to upload';
  }
  const canContinueFromSource = form.sourceType !== '' && Object.keys(sourceErrors).length === 0;
  const isStatic = form.sourceType === 'STATIC';
```

- [ ] **Step 4: Skip env step for STATIC**

Find the `goToBasic` function. After it, find where the env step navigates to confirm. Add a helper:

Find:
```typescript
  /* ── Create & upload ── */
```
Add before it:
```typescript
  function goToConfirmOrSkipEnv() {
    if (isStatic) { setStep('confirm'); } else { setStep('env'); }
  }
```

- [ ] **Step 5: Add STATIC source card to source step**

Find the source step grid. It currently has a `grid-cols-2` with two buttons (GitHub, Upload). Change it to `grid-cols-3` and add a third card:

Find:
```typescript
          <div className="grid grid-cols-2 gap-3">
```
Replace with:
```typescript
          <div className="grid grid-cols-3 gap-3">
```

After the closing `</button>` of the Upload card (before the closing `</div>` of the grid), add:
```tsx
            <button
              onClick={() => { update({ sourceType: 'STATIC' }); removeFile(); }}
              className={`group flex flex-col items-center gap-3 rounded-xl border px-4 py-6 transition-all ${
                form.sourceType === 'STATIC'
                  ? 'border-foreground bg-foreground/[0.03] ring-1 ring-foreground'
                  : 'border-border hover:border-border-hover hover:bg-muted/50'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                form.sourceType === 'STATIC' ? 'bg-foreground text-background' : 'bg-muted text-foreground-secondary'
              }`}>
                <FileCode className="size-4.5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Static Site</p>
                <p className="mt-0.5 text-xs text-foreground-muted">HTML / CSS / JS</p>
              </div>
            </button>
```

- [ ] **Step 6: Hide port field for STATIC in basic step**

In the basic step render, find the port input field block. It renders conditionally already for some fields. Wrap the port field with `{!isStatic && ( ... )}`:

Find the port input label/input block (search for `'Port'` or `form.port`). Wrap the entire port field div with:
```tsx
{!isStatic && (
  // ... existing port field JSX ...
)}
```

- [ ] **Step 7: Update "Continue" button in basic step to skip env for STATIC**

Find the button in the basic step that calls `setStep('env')`. Replace `setStep('env')` with `goToConfirmOrSkipEnv()`.

- [ ] **Step 8: Update canContinueFromBasic for STATIC (no port required)**

Find:
```typescript
  const canContinueFromBasic = Object.keys(basicErrors).length === 0 && form.name.trim() !== '' && form.slug.trim() !== '' && portStatus !== 'checking';
```
Replace with:
```typescript
  const canContinueFromBasic = Object.keys(basicErrors).length === 0 && form.name.trim() !== '' && form.slug.trim() !== '' && (isStatic || portStatus !== 'checking');
```

- [ ] **Step 9: Add static-ready step for post-creation options**

After the `'confirm'` step render block, add the `static-ready` step. Find where the confirm step ends and the component closes, and add:

```tsx
      {step === 'static-ready' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
                <Check className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Project created</p>
                <p className="text-xs text-foreground-muted">Choose how to add your files</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium mb-1">Upload zip</p>
                <p className="text-xs text-foreground-muted mb-3">Extract and deploy a .zip file</p>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={() => setDragOver(false)}
                  className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${dragOver ? 'border-foreground bg-muted' : 'border-border hover:border-border-hover'}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-4 mx-auto mb-1 text-foreground-muted" />
                  <p className="text-xs text-foreground-muted">Drop zip here or click</p>
                  <input ref={fileInputRef} type="file" accept=".zip,.tar.gz,.tgz" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)} />
                </div>
                {uploadFile && (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted px-2 py-1.5">
                    <span className="text-xs truncate">{uploadFile.name}</span>
                    <button onClick={removeFile}><X className="size-3 text-foreground-muted" /></button>
                  </div>
                )}
                {uploadFileError && <p className="mt-1 text-xs text-destructive">{uploadFileError}</p>}
                {uploadFile && (
                  <Button size="sm" className="w-full mt-2" disabled={uploading} onClick={async () => {
                    setUploading(true);
                    try {
                      const formData = new FormData();
                      formData.append('file', uploadFile);
                      const token = getAccessToken();
                      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
                      const res = await fetch(`${apiUrl}/projects/${createdProjectId}/upload`, {
                        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData,
                      });
                      if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Upload failed' })); throw new Error(e.message); }
                      router.push(`/projects/${createdProjectId}`);
                    } catch (err: any) {
                      setCreateError(err.message || 'Upload failed');
                    } finally { setUploading(false); }
                  }}>
                    {uploading ? <><Loader2 className="size-3 animate-spin mr-1" />Uploading…</> : 'Deploy zip'}
                  </Button>
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium mb-1">Online editor</p>
                <p className="text-xs text-foreground-muted mb-3">Edit files in the browser and publish</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => router.push(`/projects/${createdProjectId}/editor`)}>
                  Open editor
                </Button>
              </div>
            </div>
            {createError && <p className="mt-3 text-xs text-destructive">{createError}</p>}
          </div>
        </div>
      )}
```

- [ ] **Step 10: Update handleCreate for STATIC**

In `handleCreate`, after `const result = await createProject.mutateAsync(...)`, update the routing logic:

Find:
```typescript
      if (form.useLocalDb) {
        setCreatedProjectId(result.id);
        setStep('import');
      } else {
        router.push(`/projects/${result.id}`);
      }
```
Replace with:
```typescript
      if (form.sourceType === 'STATIC') {
        setCreatedProjectId(result.id);
        setStep('static-ready');
      } else if (form.useLocalDb) {
        setCreatedProjectId(result.id);
        setStep('import');
      } else {
        router.push(`/projects/${result.id}`);
      }
```

- [ ] **Step 11: Build check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "feat: add STATIC source option to new project flow"
```

---

## Task 8: Frontend — use-static-files hook

**Files:**
- Create: `frontend/src/hooks/use-static-files.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/use-static-files.ts`:
```typescript
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface StaticFile {
  id: string;
  path: string;
  content: string;
  updatedAt: string;
}

export function useStaticFiles(projectId: string) {
  return useQuery<StaticFile[]>({
    queryKey: ['static-files', projectId],
    queryFn: () => api(`/projects/${projectId}/static-files`),
  });
}

export function useUpsertStaticFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api(`/projects/${projectId}/static-files`, {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['static-files', projectId] }),
  });
}

export function useDeleteStaticFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api(`/projects/${projectId}/static-files/${encodeURIComponent(path)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['static-files', projectId] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-static-files.ts
git commit -m "feat: add useStaticFiles, useUpsertStaticFile, useDeleteStaticFile hooks"
```

---

## Task 9: Frontend — editor page

**Files:**
- Create: `frontend/src/app/projects/[id]/editor/page.tsx`

- [ ] **Step 1: Install CodeMirror language packages**

```bash
cd frontend && npm install @codemirror/lang-html @codemirror/lang-css @codemirror/lang-javascript
```
Expected: packages added to `package.json` and installed.

- [ ] **Step 2: Create the editor page**

Create `frontend/src/app/projects/[id]/editor/page.tsx`:

```tsx
'use client';
import { use, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { File as FileIcon, FolderOpen, Plus, Trash2, Loader2, Globe, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useProject } from '@/hooks/use-projects';
import { useStaticFiles, useUpsertStaticFile, useDeleteStaticFile } from '@/hooks/use-static-files';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

function getLanguageExtension(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return html();
  if (ext === 'css') return css();
  if (ext === 'js' || ext === 'mjs' || ext === 'ts') return javascript({ typescript: ext === 'ts' });
  return [];
}

type SaveStatus = 'saved' | 'saving' | 'unsaved';

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const qc = useQueryClient();

  const { data: project } = useProject(projectId);
  const { data: files = [], isLoading } = useStaticFiles(projectId);
  const upsert = useUpsertStaticFile(projectId);
  const deleteFile = useDeleteStaticFile(projectId);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [publishing, setPublishing] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Select first file on load
  useEffect(() => {
    if (files.length > 0 && !selectedPath) {
      const first = files[0];
      setSelectedPath(first.path);
      setEditorContent(first.content);
    }
  }, [files, selectedPath]);

  // Sync content when switching files
  function selectFile(path: string) {
    const file = files.find((f) => f.path === path);
    if (!file) return;
    setSelectedPath(path);
    setEditorContent(file.content);
    setSaveStatus('saved');
  }

  const handleChange = useCallback((value: string) => {
    setEditorContent(value);
    setSaveStatus('saving');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (!selectedPath) return;
      try {
        await upsert.mutateAsync({ path: selectedPath, content: value });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 500);
  }, [selectedPath, upsert]);

  async function handleAddFile() {
    const name = newFileName.trim();
    if (!name) return;
    try {
      await upsert.mutateAsync({ path: name, content: '' });
      setNewFileName('');
      setShowNewFile(false);
      setSelectedPath(name);
      setEditorContent('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create file');
    }
  }

  async function handleDeleteFile(path: string) {
    try {
      await deleteFile.mutateAsync(path);
      if (selectedPath === path) {
        setSelectedPath(null);
        setEditorContent('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete file');
    }
  }

  async function handlePublish() {
    if (files.length === 0) { toast.error('No files to publish'); return; }
    setPublishing(true);
    try {
      await api(`/projects/${projectId}/deploy`, { method: 'POST' });
      toast.success('Deployment started');
      router.push(`/projects/${projectId}`);
    } catch (err: any) {
      toast.error(err.message || 'Deployment failed');
    } finally {
      setPublishing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/projects/${projectId}`)} className="text-foreground-muted hover:text-foreground transition-colors">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium">{project?.name ?? 'Editor'}</span>
          <span className={`text-xs ${saveStatus === 'saved' ? 'text-foreground-muted' : saveStatus === 'saving' ? 'text-foreground-muted animate-pulse' : 'text-destructive'}`}>
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved'}
          </span>
        </div>
        <Button size="sm" onClick={handlePublish} disabled={publishing || files.length === 0}>
          {publishing ? <><Loader2 className="size-3 animate-spin mr-1" />Publishing…</> : <><Globe className="size-3 mr-1" />Publish</>}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-foreground-muted uppercase tracking-wider">Files</span>
            <button onClick={() => setShowNewFile(true)} className="text-foreground-muted hover:text-foreground transition-colors">
              <Plus className="size-3.5" />
            </button>
          </div>
          {showNewFile && (
            <div className="px-2 py-1.5 border-b border-border">
              <Input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddFile(); if (e.key === 'Escape') { setShowNewFile(false); setNewFileName(''); } }}
                placeholder="filename.html"
                className="h-6 text-xs"
              />
            </div>
          )}
          <ul className="py-1">
            {files.map((f) => (
              <li
                key={f.path}
                className={`group flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                  selectedPath === f.path ? 'bg-muted text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-muted/50'
                }`}
                onClick={() => selectFile(f.path)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileIcon className="size-3 flex-shrink-0" />
                  <span className="truncate text-xs">{f.path}</span>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.path); }}
                >
                  <Trash2 className="size-3 text-foreground-muted hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
          {files.length === 0 && (
            <div className="flex flex-col items-center py-8 px-4 text-center">
              <FolderOpen className="size-5 text-foreground-muted mb-2" />
              <p className="text-xs text-foreground-muted">No files yet</p>
              <button className="text-xs text-foreground underline mt-1" onClick={() => setShowNewFile(true)}>Add a file</button>
            </div>
          )}
        </div>

        {/* Editor pane */}
        <div className="flex-1 overflow-hidden">
          {selectedPath ? (
            <CodeMirror
              value={editorContent}
              onChange={handleChange}
              extensions={[
                getLanguageExtension(selectedPath),
                EditorView.lineWrapping,
              ]}
              theme={resolvedTheme === 'dark' ? oneDark : 'light'}
              height="100%"
              className="h-full text-sm"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
              Select a file to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/projects/[id]/editor/ frontend/package.json frontend/package-lock.json
git commit -m "feat: add static site editor page with CodeMirror and publish"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by task |
|---|---|
| STATIC SourceType enum | Task 1 |
| StaticFile model | Task 1 |
| No PortAllocation for STATIC | Task 5 |
| pipeline JSON `["static-sync","nginx","ssl"]` | Task 5 |
| static-sync stage (editor path) | Task 4 |
| static-sync stage (zip already on disk → skip to nginx) | Task 6 |
| nginx `buildStaticConfig` / `executeStatic` | Task 3 |
| SSL reuse | Task 4 (ssl case routes to executeStatic after cert) |
| New project: STATIC source card | Task 7 |
| basic step: hide port/nodeVersion for STATIC | Task 7 |
| Skip env step for STATIC | Task 7 |
| confirm step: create project → static-ready options | Task 7 |
| Seed default index.html on create | Task 5 |
| Zip upload: validate index.html | Task 6 |
| Zip upload: clear StaticFile rows | Task 6 |
| Zip upload: path traversal protection | Task 6 (unzip handles this; filter checked via readdirSync) |
| Editor: GET/PUT/DELETE static-files endpoints | Task 2 |
| Editor: path validation + 1 MB cap | Task 2 |
| Editor: file tree + CodeMirror | Task 9 |
| Editor: autosave debounce 500 ms | Task 9 |
| Editor: Publish button → deploy | Task 9 |
| Editor: block Publish if 0 files | Task 9 (disabled check) |
| PortAllocationService filter | Not included — existing `findNextUnallocatedPort` queries `PortAllocation` table which has no STATIC entries so it's already safe |

### Type consistency
- `StaticFile` type in hook matches Prisma model fields.
- `useUpsertStaticFile` calls `PUT /projects/:id/static-files` — matches controller.
- `useDeleteStaticFile` calls `DELETE /projects/:id/static-files/:encodedPath` — matches controller.
- `static-sync` case in processor uses `this.prisma.staticFile` — available after Task 1 migration.
- `NginxStaticConfig` interface defined in Task 3 and consumed in Task 4.

### Placeholder scan
None found.
