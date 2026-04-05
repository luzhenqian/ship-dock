# Nginx Configuration Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to view and edit Nginx configuration parameters (request limits, compression/caching) per project, with immediate application via nginx reload.

**Architecture:** New `NginxConfig` Prisma model with 1:1 relation to Project. New `nginx-config` NestJS module (controller + service) exposes GET/PATCH endpoints. Frontend adds an Nginx page under project routes with a form + read-only config preview. The existing `NginxStage` is refactored to read from the database and accept the new config fields.

**Tech Stack:** NestJS, Prisma, class-validator, Next.js 16, React Hook Form, Zod, React Query, sonner (toasts)

---

## File Structure

### Backend (new files)
- `backend/src/nginx-config/nginx-config.module.ts` — NestJS module
- `backend/src/nginx-config/nginx-config.controller.ts` — GET/PATCH endpoints
- `backend/src/nginx-config/nginx-config.service.ts` — business logic + nginx reload
- `backend/src/nginx-config/dto/update-nginx-config.dto.ts` — validation DTO

### Backend (modified files)
- `backend/prisma/schema.prisma` — add NginxConfig model + relation on Project
- `backend/src/deploy/stages/nginx.stage.ts` — refactor buildConfig to accept NginxConfig fields
- `backend/src/app.module.ts` — register NginxConfigModule

### Frontend (new files)
- `frontend/src/app/projects/[id]/nginx/page.tsx` — Nginx config page
- `frontend/src/hooks/use-nginx-config.ts` — React Query hooks

### Frontend (modified files)
- `frontend/src/components/project-sidebar.tsx` — add Nginx link to sidebar

---

### Task 1: Database Schema — Add NginxConfig Model

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add NginxConfig model to schema**

Add at the end of `backend/prisma/schema.prisma`:

```prisma
model NginxConfig {
  id                  String  @id @default(uuid())
  projectId           String  @unique
  project             Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  clientMaxBodySize   Int     @default(10)
  proxyReadTimeout    Int     @default(60)
  proxySendTimeout    Int     @default(60)
  proxyConnectTimeout Int     @default(60)

  gzipEnabled         Boolean @default(true)
  gzipMinLength       Int     @default(1024)
  gzipTypes           String  @default("text/plain text/css application/json application/javascript text/xml")
  proxyBuffering      Boolean @default(true)
  proxyBufferSize     String  @default("4k")
  proxyBuffers        String  @default("8 4k")

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

- [ ] **Step 2: Add relation on Project model**

In the Project model, add after the `dataMigrations DataMigration[]` line:

```prisma
  nginxConfig    NginxConfig?
```

- [ ] **Step 3: Generate and run migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add-nginx-config
```

Expected: Migration created and applied, Prisma client regenerated.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add NginxConfig model with project relation"
```

---

### Task 2: Refactor NginxStage to Accept Config Fields

**Files:**
- Modify: `backend/src/deploy/stages/nginx.stage.ts`

- [ ] **Step 1: Update NginxConfig interface and buildConfig**

Replace the entire content of `backend/src/deploy/stages/nginx.stage.ts`:

```typescript
import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface NginxStageConfig {
  domain: string;
  port: number;
  slug: string;
  hasSsl: boolean;
  clientMaxBodySize?: number;
  proxyReadTimeout?: number;
  proxySendTimeout?: number;
  proxyConnectTimeout?: number;
  gzipEnabled?: boolean;
  gzipMinLength?: number;
  gzipTypes?: string;
  proxyBuffering?: boolean;
  proxyBufferSize?: string;
  proxyBuffers?: string;
}

const DEFAULTS = {
  clientMaxBodySize: 10,
  proxyReadTimeout: 60,
  proxySendTimeout: 60,
  proxyConnectTimeout: 60,
  gzipEnabled: true,
  gzipMinLength: 1024,
  gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
  proxyBuffering: true,
  proxyBufferSize: '4k',
  proxyBuffers: '8 4k',
};

export class NginxStage {
  buildConfig(config: NginxStageConfig): string {
    const c = { ...DEFAULTS, ...config };

    const gzipBlock = c.gzipEnabled
      ? `
    gzip on;
    gzip_min_length ${c.gzipMinLength};
    gzip_types ${c.gzipTypes};`
      : `
    gzip off;`;

    const locationBlock = `
    location / {
        proxy_pass http://127.0.0.1:${c.port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout ${c.proxyReadTimeout}s;
        proxy_send_timeout ${c.proxySendTimeout}s;
        proxy_connect_timeout ${c.proxyConnectTimeout}s;
        proxy_buffering ${c.proxyBuffering ? 'on' : 'off'};${c.proxyBuffering ? `
        proxy_buffer_size ${c.proxyBufferSize};
        proxy_buffers ${c.proxyBuffers};` : ''}
    }`;

    const serverBlock = `
    client_max_body_size ${c.clientMaxBodySize}m;
${gzipBlock}
${locationBlock}`;

    if (!config.hasSsl) {
      return `server {\n    listen 80;\n    server_name ${config.domain};\n${serverBlock}\n}`;
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
${serverBlock}
}`;
  }

  async execute(config: NginxStageConfig, ctx: StageContext): Promise<StageResult> {
    const confPath = `/etc/nginx/sites-available/${config.slug}.conf`;
    const enabledPath = `/etc/nginx/sites-enabled/${config.slug}.conf`;
    const nginxConf = this.buildConfig(config);
    const command = `echo '${nginxConf.replace(/'/g, "'\\''")}' | sudo tee ${confPath} > /dev/null && sudo ln -sf ${confPath} ${enabledPath} && sudo nginx -t && sudo nginx -s reload`;
    ctx.onLog(`Writing nginx config to ${confPath}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => { const c = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m'; ctx.onLog(`${c}${line}\x1b[0m`); }); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `nginx config failed (code ${code})` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
```

- [ ] **Step 2: Update any NginxStage callers in the deploy pipeline**

Find where NginxStage is called (in the deploy processor) and ensure it passes NginxConfig fields from the database. Search for `NginxStage` usage in `backend/src/deploy/` and update the call to include config fields from the project's `nginxConfig` relation.

The caller should do:
```typescript
const nginxConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId: project.id } });
const stageConfig: NginxStageConfig = {
  domain: project.domain,
  port: project.port,
  slug: project.slug,
  hasSsl: /* existing logic */,
  ...nginxConfig ? {
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
  } : {},
};
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/deploy/
git commit -m "refactor: NginxStage accepts configurable params with defaults"
```

---

### Task 3: Backend — NginxConfig DTO

**Files:**
- Create: `backend/src/nginx-config/dto/update-nginx-config.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateNginxConfigDto {
  @IsOptional() @IsInt() @Min(1) @Max(1024)
  clientMaxBodySize?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxyReadTimeout?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxySendTimeout?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxyConnectTimeout?: number;

  @IsOptional() @IsBoolean()
  gzipEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1048576)
  gzipMinLength?: number;

  @IsOptional() @IsString()
  gzipTypes?: string;

  @IsOptional() @IsBoolean()
  proxyBuffering?: boolean;

  @IsOptional() @IsString()
  proxyBufferSize?: string;

  @IsOptional() @IsString()
  proxyBuffers?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/nginx-config/
git commit -m "feat: add UpdateNginxConfigDto with validation"
```

---

### Task 4: Backend — NginxConfig Service

**Files:**
- Create: `backend/src/nginx-config/nginx-config.service.ts`

- [ ] **Step 1: Create the service**

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateNginxConfigDto } from './dto/update-nginx-config.dto';
import { NginxStage, NginxStageConfig } from '../deploy/stages/nginx.stage';
import { spawn } from 'child_process';

@Injectable()
export class NginxConfigService {
  private nginxStage = new NginxStage();

  constructor(private prisma: PrismaService) {}

  async getConfig(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const config = await this.prisma.nginxConfig.findUnique({ where: { projectId } });

    const defaults = {
      clientMaxBodySize: 10,
      proxyReadTimeout: 60,
      proxySendTimeout: 60,
      proxyConnectTimeout: 60,
      gzipEnabled: true,
      gzipMinLength: 1024,
      gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
      proxyBuffering: true,
      proxyBufferSize: '4k',
      proxyBuffers: '8 4k',
    };

    const values = config
      ? {
          clientMaxBodySize: config.clientMaxBodySize,
          proxyReadTimeout: config.proxyReadTimeout,
          proxySendTimeout: config.proxySendTimeout,
          proxyConnectTimeout: config.proxyConnectTimeout,
          gzipEnabled: config.gzipEnabled,
          gzipMinLength: config.gzipMinLength,
          gzipTypes: config.gzipTypes,
          proxyBuffering: config.proxyBuffering,
          proxyBufferSize: config.proxyBufferSize,
          proxyBuffers: config.proxyBuffers,
        }
      : defaults;

    const preview = project.domain
      ? this.nginxStage.buildConfig({
          domain: project.domain,
          port: project.port,
          slug: project.slug,
          hasSsl: true,
          ...values,
        })
      : null;

    return { config: values, preview };
  }

  async updateConfig(projectId: string, dto: UpdateNginxConfigDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.domain) throw new BadRequestException('Project must have a domain configured before editing Nginx settings');

    const config = await this.prisma.nginxConfig.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });

    const stageConfig: NginxStageConfig = {
      domain: project.domain,
      port: project.port,
      slug: project.slug,
      hasSsl: true,
      clientMaxBodySize: config.clientMaxBodySize,
      proxyReadTimeout: config.proxyReadTimeout,
      proxySendTimeout: config.proxySendTimeout,
      proxyConnectTimeout: config.proxyConnectTimeout,
      gzipEnabled: config.gzipEnabled,
      gzipMinLength: config.gzipMinLength,
      gzipTypes: config.gzipTypes,
      proxyBuffering: config.proxyBuffering,
      proxyBufferSize: config.proxyBufferSize,
      proxyBuffers: config.proxyBuffers,
    };

    const confPath = `/etc/nginx/sites-available/${project.slug}.conf`;
    const nginxConf = this.nginxStage.buildConfig(stageConfig);

    // Write config and reload nginx
    const result = await this.execCommand(
      `echo '${nginxConf.replace(/'/g, "'\\''")}' | sudo tee ${confPath} > /dev/null && sudo nginx -t 2>&1`,
    );

    if (!result.success) {
      // Rollback database change
      if (dto) {
        await this.prisma.nginxConfig.delete({ where: { projectId } }).catch(() => {});
      }
      throw new BadRequestException(`Nginx config validation failed: ${result.output}`);
    }

    // Config is valid, reload
    await this.execCommand('sudo nginx -s reload');

    const preview = this.nginxStage.buildConfig(stageConfig);
    return {
      config: {
        clientMaxBodySize: config.clientMaxBodySize,
        proxyReadTimeout: config.proxyReadTimeout,
        proxySendTimeout: config.proxySendTimeout,
        proxyConnectTimeout: config.proxyConnectTimeout,
        gzipEnabled: config.gzipEnabled,
        gzipMinLength: config.gzipMinLength,
        gzipTypes: config.gzipTypes,
        proxyBuffering: config.proxyBuffering,
        proxyBufferSize: config.proxyBufferSize,
        proxyBuffers: config.proxyBuffers,
      },
      preview,
    };
  }

  private execCommand(command: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });
      child.on('close', (code) => resolve({ success: code === 0, output }));
      child.on('error', (err) => resolve({ success: false, output: err.message }));
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/nginx-config/
git commit -m "feat: add NginxConfigService with get/update and nginx reload"
```

---

### Task 5: Backend — NginxConfig Controller & Module

**Files:**
- Create: `backend/src/nginx-config/nginx-config.controller.ts`
- Create: `backend/src/nginx-config/nginx-config.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create the controller**

```typescript
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { NginxConfigService } from './nginx-config.service';
import { UpdateNginxConfigDto } from './dto/update-nginx-config.dto';

@Controller('projects/:projectId/nginx-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NginxConfigController {
  constructor(private nginxConfigService: NginxConfigService) {}

  @Get() @MinRole('VIEWER')
  getConfig(@Param('projectId') projectId: string) {
    return this.nginxConfigService.getConfig(projectId);
  }

  @Patch() @MinRole('DEVELOPER')
  updateConfig(@Param('projectId') projectId: string, @Body() dto: UpdateNginxConfigDto) {
    return this.nginxConfigService.updateConfig(projectId, dto);
  }
}
```

- [ ] **Step 2: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { NginxConfigController } from './nginx-config.controller';
import { NginxConfigService } from './nginx-config.service';

@Module({
  controllers: [NginxConfigController],
  providers: [NginxConfigService],
  exports: [NginxConfigService],
})
export class NginxConfigModule {}
```

- [ ] **Step 3: Register module in app.module.ts**

In `backend/src/app.module.ts`, add the import:

```typescript
import { NginxConfigModule } from './nginx-config/nginx-config.module';
```

And add `NginxConfigModule` to the `imports` array, after `DataMigrationModule`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/nginx-config/ backend/src/app.module.ts
git commit -m "feat: add NginxConfig controller and module"
```

---

### Task 6: Frontend — React Query Hooks

**Files:**
- Create: `frontend/src/hooks/use-nginx-config.ts`

- [ ] **Step 1: Create the hooks file**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface NginxConfigData {
  clientMaxBodySize: number;
  proxyReadTimeout: number;
  proxySendTimeout: number;
  proxyConnectTimeout: number;
  gzipEnabled: boolean;
  gzipMinLength: number;
  gzipTypes: string;
  proxyBuffering: boolean;
  proxyBufferSize: string;
  proxyBuffers: string;
}

export interface NginxConfigResponse {
  config: NginxConfigData;
  preview: string | null;
}

export function useNginxConfig(projectId: string) {
  return useQuery({
    queryKey: ['nginx-config', projectId],
    queryFn: () => api<NginxConfigResponse>(`/projects/${projectId}/nginx-config`),
  });
}

export function useUpdateNginxConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NginxConfigData>) =>
      api<NginxConfigResponse>(`/projects/${projectId}/nginx-config`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nginx-config', projectId] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-nginx-config.ts
git commit -m "feat: add useNginxConfig and useUpdateNginxConfig hooks"
```

---

### Task 7: Frontend — Nginx Config Page

**Files:**
- Create: `frontend/src/app/projects/[id]/nginx/page.tsx`

- [ ] **Step 1: Create the Nginx config page**

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { useNginxConfig, useUpdateNginxConfig, NginxConfigData } from '@/hooks/use-nginx-config';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function buildPreview(
  domain: string,
  port: number,
  config: NginxConfigData,
): string {
  const gzipBlock = config.gzipEnabled
    ? `\n    gzip on;\n    gzip_min_length ${config.gzipMinLength};\n    gzip_types ${config.gzipTypes};`
    : '\n    gzip off;';

  const bufferLines = config.proxyBuffering
    ? `\n        proxy_buffer_size ${config.proxyBufferSize};\n        proxy_buffers ${config.proxyBuffers};`
    : '';

  return `server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    client_max_body_size ${config.clientMaxBodySize}m;
${gzipBlock}

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout ${config.proxyReadTimeout}s;
        proxy_send_timeout ${config.proxySendTimeout}s;
        proxy_connect_timeout ${config.proxyConnectTimeout}s;
        proxy_buffering ${config.proxyBuffering ? 'on' : 'off'};${bufferLines}
    }
}`;
}

export default function NginxConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const { data, isLoading } = useNginxConfig(projectId);
  const updateConfig = useUpdateNginxConfig(projectId);

  const [form, setForm] = useState<NginxConfigData>({
    clientMaxBodySize: 10,
    proxyReadTimeout: 60,
    proxySendTimeout: 60,
    proxyConnectTimeout: 60,
    gzipEnabled: true,
    gzipMinLength: 1024,
    gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
    proxyBuffering: true,
    proxyBufferSize: '4k',
    proxyBuffers: '8 4k',
  });

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  function setField<K extends keyof NginxConfigData>(key: K, value: NginxConfigData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await updateConfig.mutateAsync(form);
      toast.success('Nginx configuration saved and applied');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (!project || isLoading) return <p>Loading...</p>;

  if (!project.domain) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Please deploy the project and configure a domain before managing Nginx settings.
        </p>
      </div>
    );
  }

  const preview = buildPreview(project.domain, project.port, form);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Request Limits</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Max Upload Size</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1} max={1024}
                value={form.clientMaxBodySize}
                onChange={(e) => setField('clientMaxBodySize', parseInt(e.target.value) || 1)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">MB</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Read Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxyReadTimeout}
                  onChange={(e) => setField('proxyReadTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
            <div>
              <Label>Send Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxySendTimeout}
                  onChange={(e) => setField('proxySendTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
            <div>
              <Label>Connect Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxyConnectTimeout}
                  onChange={(e) => setField('proxyConnectTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Compression & Caching</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.gzipEnabled}
                onChange={(e) => setField('gzipEnabled', e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm font-medium">Enable Gzip Compression</span>
            </label>
          </div>
          {form.gzipEnabled && (
            <div className="space-y-4 pl-6">
              <div>
                <Label>Min Length (bytes)</Label>
                <Input
                  type="number"
                  min={0} max={1048576}
                  value={form.gzipMinLength}
                  onChange={(e) => setField('gzipMinLength', parseInt(e.target.value) || 0)}
                  className="w-48"
                />
              </div>
              <div>
                <Label>MIME Types</Label>
                <Input
                  value={form.gzipTypes}
                  onChange={(e) => setField('gzipTypes', e.target.value)}
                  className="font-mono text-sm"
                  placeholder="text/plain text/css application/json"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.proxyBuffering}
                onChange={(e) => setField('proxyBuffering', e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm font-medium">Enable Proxy Buffering</span>
            </label>
          </div>
          {form.proxyBuffering && (
            <div className="space-y-4 pl-6">
              <div>
                <Label>Buffer Size</Label>
                <Input
                  value={form.proxyBufferSize}
                  onChange={(e) => setField('proxyBufferSize', e.target.value)}
                  className="w-32 font-mono"
                  placeholder="4k"
                />
              </div>
              <div>
                <Label>Buffers</Label>
                <Input
                  value={form.proxyBuffers}
                  onChange={(e) => setField('proxyBuffers', e.target.value)}
                  className="w-32 font-mono"
                  placeholder="8 4k"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateConfig.isPending}>
        {updateConfig.isPending ? 'Saving...' : 'Save & Apply'}
      </Button>

      <Card>
        <CardHeader><CardTitle>Generated Configuration</CardTitle></CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {preview}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/\[id\]/nginx/
git commit -m "feat: add Nginx configuration page with form and preview"
```

---

### Task 8: Frontend — Add Nginx to Sidebar

**Files:**
- Modify: `frontend/src/components/project-sidebar.tsx`

- [ ] **Step 1: Add Nginx link to the Config group**

In `frontend/src/components/project-sidebar.tsx`, update the `Config` group in the `groups` array. Change:

```typescript
  {
    label: 'Config',
    items: [
      { href: 'webhooks', label: 'Webhooks' },
      { href: 'settings', label: 'Settings' },
    ],
  },
```

To:

```typescript
  {
    label: 'Config',
    items: [
      { href: 'nginx', label: 'Nginx' },
      { href: 'webhooks', label: 'Webhooks' },
      { href: 'settings', label: 'Settings' },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/project-sidebar.tsx
git commit -m "feat: add Nginx link to project sidebar"
```

---

### Task 9: Integration Verification

- [ ] **Step 1: Start backend and verify API**

Run:
```bash
cd backend && npm run start:dev
```

Test GET endpoint (should return defaults):
```bash
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/projects/<project-id>/nginx-config
```

Expected: `{"config":{"clientMaxBodySize":10,...},"preview":null}` (null preview if no domain)

- [ ] **Step 2: Start frontend and verify UI**

Run:
```bash
cd frontend && npm run dev
```

Navigate to a project's Nginx page via the sidebar. Verify:
- Form loads with default values
- Preview updates as form changes
- Projects without domain show the "configure domain first" message

- [ ] **Step 3: Test save flow (on a project with domain)**

Change `clientMaxBodySize` to 50, click "Save & Apply". Verify:
- Toast shows success
- Config persists after page refresh
- On the server, check `/etc/nginx/sites-available/<slug>.conf` contains `client_max_body_size 50m`

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for nginx config management"
```
