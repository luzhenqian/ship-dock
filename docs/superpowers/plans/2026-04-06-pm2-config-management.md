# PM2 Configuration Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PM2 config visualization and editing page under project management, parallel to the existing Nginx config page.

**Architecture:** New `Pm2Config` Prisma model + NestJS module (controller/service/DTO) following the `NginxConfig` pattern. Extend `Pm2Stage.buildEcosystemConfig()` to support `instances`, `exec_mode`, `max_memory_restart`. Frontend page at `/projects/[id]/pm2` with React Query hooks.

**Tech Stack:** Prisma, NestJS 11, Next.js (App Router), React 19, TanStack React Query, Shiki, Tailwind CSS 4

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/prisma/schema.prisma` | Add `Pm2Config` model, relation on `Project` |
| Create | `backend/src/pm2-config/pm2-config.module.ts` | NestJS module |
| Create | `backend/src/pm2-config/pm2-config.controller.ts` | GET + PATCH endpoints |
| Create | `backend/src/pm2-config/pm2-config.service.ts` | Business logic: get/update config, restart PM2 |
| Create | `backend/src/pm2-config/dto/update-pm2-config.dto.ts` | Validation DTO |
| Modify | `backend/src/app.module.ts` | Register `Pm2ConfigModule` |
| Modify | `backend/src/deploy/stages/pm2.stage.ts` | Extend interface + `buildEcosystemConfig()` for new fields |
| Modify | `backend/src/deploy/deploy.processor.ts` | Pass pm2Config from DB into pm2 stage |
| Modify | `backend/src/projects/projects.service.ts` | Use pm2Config in `restart()` method |
| Create | `frontend/src/hooks/use-pm2-config.ts` | React Query hooks |
| Create | `frontend/src/app/projects/[id]/pm2/page.tsx` | PM2 config page |
| Modify | `frontend/src/components/project-sidebar.tsx` | Add PM2 nav link |

---

### Task 1: Prisma Schema — Add Pm2Config Model

**Files:**
- Modify: `backend/prisma/schema.prisma:105` (add relation to Project)
- Modify: `backend/prisma/schema.prisma:310` (add new model after NginxConfig)

- [ ] **Step 1: Add Pm2Config model and relation**

In `backend/prisma/schema.prisma`, add the relation field on `Project` model after the `nginxConfig` line:

```prisma
  pm2Config     Pm2Config?
```

Add the new model after `NginxConfig` (after line 310):

```prisma
model Pm2Config {
  id               String   @id @default(uuid())
  projectId        String   @unique
  project          Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  script           String?
  instances        Int      @default(1)
  execMode         String   @default("fork")
  maxMemoryRestart String?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add-pm2-config
```

Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add Pm2Config model to schema"
```

---

### Task 2: Extend Pm2Stage for New Config Fields

**Files:**
- Modify: `backend/src/deploy/stages/pm2.stage.ts`
- Modify: `backend/src/deploy/stages/pm2.stage.spec.ts`

- [ ] **Step 1: Write failing test for new config fields**

Add to `backend/src/deploy/stages/pm2.stage.spec.ts`:

```typescript
it('should include instances, exec_mode, and max_memory_restart when provided', () => {
  const stage = new Pm2Stage();
  const config = {
    name: 'test-app',
    script: 'dist/main.js',
    cwd: '/var/www/test-app',
    port: 3001,
    envVars: {},
    instances: 2,
    execMode: 'cluster',
    maxMemoryRestart: '300M',
  };
  const result = stage.buildEcosystemConfig(config);
  expect(result).toContain("instances: 2");
  expect(result).toContain("exec_mode: 'cluster'");
  expect(result).toContain("max_memory_restart: '300M'");
});

it('should omit optional pm2 fields when not provided', () => {
  const stage = new Pm2Stage();
  const config = {
    name: 'test-app',
    script: 'dist/main.js',
    cwd: '/var/www/test-app',
    port: 3001,
    envVars: {},
  };
  const result = stage.buildEcosystemConfig(config);
  expect(result).not.toContain('instances');
  expect(result).not.toContain('exec_mode');
  expect(result).not.toContain('max_memory_restart');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest pm2.stage --verbose`

Expected: First test FAILS (new fields not in output). Second test should pass (fields already absent).

- [ ] **Step 3: Update Pm2Config interface and buildEcosystemConfig**

In `backend/src/deploy/stages/pm2.stage.ts`, update the interface:

```typescript
export interface Pm2Config {
  name: string; script: string; cwd: string; port: number; envVars: Record<string, string>;
  instances?: number;
  execMode?: string;
  maxMemoryRestart?: string;
}
```

Replace `buildEcosystemConfig` method:

```typescript
buildEcosystemConfig(config: Pm2Config, isNpmStart = false): string {
  const envEntries = Object.entries(config.envVars).map(([k, v]) => `      ${k}: '${v}'`).join(',\n');

  const optionalLines: string[] = [];
  if (config.instances !== undefined && config.instances !== 1) {
    optionalLines.push(`    instances: ${config.instances},`);
  }
  if (config.execMode && config.execMode !== 'fork') {
    optionalLines.push(`    exec_mode: '${config.execMode}',`);
  }
  if (config.maxMemoryRestart) {
    optionalLines.push(`    max_memory_restart: '${config.maxMemoryRestart}',`);
  }
  const optionalBlock = optionalLines.length > 0 ? '\n' + optionalLines.join('\n') : '';

  const scriptLine = isNpmStart
    ? `    script: 'npm',\n    args: 'start',`
    : `    script: '${config.script}',`;

  return `module.exports = {
  apps: [{
    name: '${config.name}',
${scriptLine}
    cwd: '${config.cwd}',${optionalBlock}
    env: {
      PORT: ${config.port},
      NODE_ENV: 'production',
${envEntries}
    }
  }]
};`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest pm2.stage --verbose`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/deploy/stages/pm2.stage.ts backend/src/deploy/stages/pm2.stage.spec.ts
git commit -m "feat: extend Pm2Stage with instances, exec_mode, max_memory_restart"
```

---

### Task 3: Backend DTO

**Files:**
- Create: `backend/src/pm2-config/dto/update-pm2-config.dto.ts`

- [ ] **Step 1: Create DTO file**

Create `backend/src/pm2-config/dto/update-pm2-config.dto.ts`:

```typescript
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdatePm2ConfigDto {
  @IsOptional() @IsString()
  script?: string;

  @IsOptional() @IsInt() @Min(1) @Max(16)
  instances?: number;

  @IsOptional() @IsIn(['fork', 'cluster'])
  execMode?: string;

  @IsOptional() @IsString() @Matches(/^\d+[KMG]$/i, { message: 'maxMemoryRestart must be like "300M", "1G", or "512K"' })
  maxMemoryRestart?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/pm2-config/dto/update-pm2-config.dto.ts
git commit -m "feat: add UpdatePm2ConfigDto"
```

---

### Task 4: Backend Service

**Files:**
- Create: `backend/src/pm2-config/pm2-config.service.ts`

- [ ] **Step 1: Create service**

Create `backend/src/pm2-config/pm2-config.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { UpdatePm2ConfigDto } from './dto/update-pm2-config.dto';
import { Pm2Stage } from '../deploy/stages/pm2.stage';

const execFileAsync = promisify(execFile);

@Injectable()
export class Pm2ConfigService {
  private pm2Stage = new Pm2Stage();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
  ) {}

  private extractValues(config: { script: string | null; instances: number; execMode: string; maxMemoryRestart: string | null }) {
    return {
      script: config.script,
      instances: config.instances,
      execMode: config.execMode,
      maxMemoryRestart: config.maxMemoryRestart,
    };
  }

  private getProjectDir(project: { slug: string; directory: string | null; workDir: string | null }): string {
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsDir, project.directory || project.slug);
    return project.workDir ? join(repoDir, project.workDir) : repoDir;
  }

  private detectScript(projectDir: string, startCommand: string | null): { script: string; isNpmStart: boolean } {
    let script = startCommand || 'dist/main.js';
    let isNpmStart = false;
    if (!startCommand) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
        if (pkg.scripts?.start) { script = 'npm'; isNpmStart = true; }
        else if (pkg.main) { script = pkg.main; }
      } catch {}
    }
    return { script, isNpmStart };
  }

  async getConfig(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId } });

    const defaults = { script: null as string | null, instances: 1, execMode: 'fork', maxMemoryRestart: null as string | null };
    const values = pm2Config ? this.extractValues(pm2Config) : defaults;

    const projectDir = this.getProjectDir(project);
    const { script: detectedScript } = this.detectScript(projectDir, project.startCommand);

    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try {
        const parsed = JSON.parse(this.encryption.decrypt(project.envVars));
        envVars = Object.fromEntries(Object.entries(parsed).map(([k]) => [k, '••••••']));
      } catch {}
    }

    const effectiveScript = values.script || detectedScript;
    const isNpmStart = effectiveScript === 'npm';
    const preview = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars: { ...envVars, PORT: String(project.port), NODE_ENV: 'production' },
        instances: values.instances,
        execMode: values.execMode,
        maxMemoryRestart: values.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );

    return {
      config: values,
      info: {
        name: project.pm2Name,
        cwd: projectDir,
        port: project.port,
        detectedScript,
        envVars,
      },
      preview,
    };
  }

  async updateConfig(projectId: string, dto: UpdatePm2ConfigDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.directory) throw new BadRequestException('Project must be deployed before editing PM2 settings');

    const pm2Config = await this.prisma.pm2Config.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });

    // Build and write ecosystem.config.js
    const projectDir = this.getProjectDir(project);
    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const effectiveScript = pm2Config.script || this.detectScript(projectDir, project.startCommand).script;
    const isNpmStart = effectiveScript === 'npm';

    const ecosystemContent = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars,
        instances: pm2Config.instances,
        execMode: pm2Config.execMode,
        maxMemoryRestart: pm2Config.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );
    writeFileSync(join(projectDir, 'ecosystem.config.js'), ecosystemContent);

    // Restart PM2 process
    try {
      await execFileAsync('pm2', ['restart', project.pm2Name]);
    } catch (err: any) {
      throw new BadRequestException(`PM2 restart failed: ${err.message}`);
    }

    // Build preview with masked env vars for response
    const maskedEnvVars = Object.fromEntries(Object.entries(envVars).map(([k]) => [k, '••••••']));
    const preview = this.pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name,
        script: effectiveScript,
        cwd: projectDir,
        port: project.port,
        envVars: { ...maskedEnvVars, PORT: String(project.port), NODE_ENV: 'production' },
        instances: pm2Config.instances,
        execMode: pm2Config.execMode,
        maxMemoryRestart: pm2Config.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );

    return {
      config: this.extractValues(pm2Config),
      info: {
        name: project.pm2Name,
        cwd: projectDir,
        port: project.port,
        detectedScript: this.detectScript(projectDir, project.startCommand).script,
        envVars: maskedEnvVars,
      },
      preview,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/pm2-config/pm2-config.service.ts
git commit -m "feat: add Pm2ConfigService"
```

---

### Task 5: Backend Controller + Module + Register

**Files:**
- Create: `backend/src/pm2-config/pm2-config.controller.ts`
- Create: `backend/src/pm2-config/pm2-config.module.ts`
- Modify: `backend/src/app.module.ts:18,40`

- [ ] **Step 1: Create controller**

Create `backend/src/pm2-config/pm2-config.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { Pm2ConfigService } from './pm2-config.service';
import { UpdatePm2ConfigDto } from './dto/update-pm2-config.dto';

@Controller('projects/:projectId/pm2-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Pm2ConfigController {
  constructor(private pm2ConfigService: Pm2ConfigService) {}

  @Get() @MinRole('VIEWER')
  getConfig(@Param('projectId') projectId: string) {
    return this.pm2ConfigService.getConfig(projectId);
  }

  @Patch() @MinRole('DEVELOPER')
  updateConfig(@Param('projectId') projectId: string, @Body() dto: UpdatePm2ConfigDto) {
    return this.pm2ConfigService.updateConfig(projectId, dto);
  }
}
```

- [ ] **Step 2: Create module**

Create `backend/src/pm2-config/pm2-config.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { Pm2ConfigController } from './pm2-config.controller';
import { Pm2ConfigService } from './pm2-config.service';

@Module({
  controllers: [Pm2ConfigController],
  providers: [Pm2ConfigService],
  exports: [Pm2ConfigService],
})
export class Pm2ConfigModule {}
```

- [ ] **Step 3: Register in AppModule**

In `backend/src/app.module.ts`, add import after the NginxConfigModule import (line 18):

```typescript
import { Pm2ConfigModule } from './pm2-config/pm2-config.module';
```

Add `Pm2ConfigModule` to the `imports` array after `NginxConfigModule` (line 40):

```typescript
    Pm2ConfigModule,
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd backend && npx nest build`

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/pm2-config/ backend/src/app.module.ts
git commit -m "feat: add Pm2Config controller, module, register in AppModule"
```

---

### Task 6: Integrate Pm2Config into Deploy Processor and Restart

**Files:**
- Modify: `backend/src/deploy/deploy.processor.ts:137-157`
- Modify: `backend/src/projects/projects.service.ts:290-330`

- [ ] **Step 1: Update deploy processor pm2 stage**

In `backend/src/deploy/deploy.processor.ts`, replace the `case 'pm2':` block (lines 137-157) with:

```typescript
      case 'pm2': {
        let envVars: Record<string, string> = {};
        if (project.envVars) { try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {} }
        const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId: project.id } });
        // Determine start script: pm2Config.script > user-specified > package.json start > dist/main.js
        let script = pm2Config?.script || project.startCommand || 'dist/main.js';
        if (!pm2Config?.script && !project.startCommand) {
          try {
            const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
            if (pkg.scripts?.start) {
              script = 'npm';
            } else if (pkg.main) {
              script = pkg.main;
            }
          } catch {}
        }
        const isNpmStart = script === 'npm';
        return this.pm2Stage.execute(
          {
            name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars,
            instances: pm2Config?.instances,
            execMode: pm2Config?.execMode,
            maxMemoryRestart: pm2Config?.maxMemoryRestart ?? undefined,
          },
          isFirstDeploy, ctx, isNpmStart,
        );
      }
```

- [ ] **Step 2: Update restart method in ProjectsService**

In `backend/src/projects/projects.service.ts`, update the `restart` method (lines 290-330). Replace the script detection + ecosystem config generation block with:

```typescript
  async restart(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');

    // Regenerate ecosystem.config.js with latest ENV and PM2 config before restarting
    let envVars: Record<string, string> = {};
    if (project.envVars) {
      try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }

    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsDir, project.directory || project.slug);
    const projectDir = project.workDir ? join(repoDir, project.workDir) : repoDir;

    const pm2Config = await this.prisma.pm2Config.findUnique({ where: { projectId: id } });

    let script = pm2Config?.script || project.startCommand || 'dist/main.js';
    let isNpmStart = false;
    if (!pm2Config?.script && !project.startCommand) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(join(projectDir, 'package.json'), 'utf8'));
        if (pkg.scripts?.start) { script = 'npm'; isNpmStart = true; }
        else if (pkg.main) { script = pkg.main; }
      } catch {}
    }
    if (script === 'npm') isNpmStart = true;

    const pm2Stage = new Pm2Stage();
    const ecosystemContent = pm2Stage.buildEcosystemConfig(
      {
        name: project.pm2Name, script, cwd: projectDir, port: project.port, envVars,
        instances: pm2Config?.instances,
        execMode: pm2Config?.execMode,
        maxMemoryRestart: pm2Config?.maxMemoryRestart ?? undefined,
      },
      isNpmStart,
    );
    writeFileSync(join(projectDir, 'ecosystem.config.js'), ecosystemContent);

    try {
      await execFileAsync('pm2', ['restart', project.pm2Name]);
    } catch (err: any) {
      throw new BadRequestException(`Failed to restart process: ${err.message}`);
    }

    return this.prisma.project.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx nest build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add backend/src/deploy/deploy.processor.ts backend/src/projects/projects.service.ts
git commit -m "feat: integrate Pm2Config into deploy processor and restart"
```

---

### Task 7: Frontend Hook

**Files:**
- Create: `frontend/src/hooks/use-pm2-config.ts`

- [ ] **Step 1: Create hook file**

Create `frontend/src/hooks/use-pm2-config.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Pm2ConfigData {
  script: string | null;
  instances: number;
  execMode: string;
  maxMemoryRestart: string | null;
}

export interface Pm2ConfigInfo {
  name: string;
  cwd: string;
  port: number;
  detectedScript: string;
  envVars: Record<string, string>;
}

export interface Pm2ConfigResponse {
  config: Pm2ConfigData;
  info: Pm2ConfigInfo;
  preview: string;
}

export function usePm2Config(projectId: string) {
  return useQuery({
    queryKey: ['pm2-config', projectId],
    queryFn: () => api<Pm2ConfigResponse>(`/projects/${projectId}/pm2-config`),
  });
}

export function useUpdatePm2Config(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pm2ConfigData>) =>
      api<Pm2ConfigResponse>(`/projects/${projectId}/pm2-config`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pm2-config', projectId] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-pm2-config.ts
git commit -m "feat: add usePm2Config hooks"
```

---

### Task 8: Frontend Page

**Files:**
- Create: `frontend/src/app/projects/[id]/pm2/page.tsx`

- [ ] **Step 1: Create PM2 config page**

Create `frontend/src/app/projects/[id]/pm2/page.tsx`:

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { usePm2Config, useUpdatePm2Config, Pm2ConfigData } from '@/hooks/use-pm2-config';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { codeToHtml } from 'shiki';

function useHighlightedCode(code: string, lang: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, { lang, theme: 'github-dark' }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  return html;
}

export default function Pm2ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const { data, isLoading } = usePm2Config(projectId);
  const updateConfig = useUpdatePm2Config(projectId);

  const [form, setForm] = useState<Pm2ConfigData>({
    script: null,
    instances: 1,
    execMode: 'fork',
    maxMemoryRestart: null,
  });

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  function setField<K extends keyof Pm2ConfigData>(key: K, value: Pm2ConfigData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-switch to cluster when instances > 1
      if (key === 'instances' && typeof value === 'number' && value > 1) {
        next.execMode = 'cluster';
      }
      return next;
    });
  }

  async function handleSave() {
    try {
      await updateConfig.mutateAsync(form);
      toast.success('PM2 configuration saved and process restarted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (!project || isLoading) return <p>Loading...</p>;

  if (!project.directory) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Please deploy the project before managing PM2 settings.
        </p>
      </div>
    );
  }

  const preview = data?.preview || '';
  const highlightedPreview = useHighlightedCode(preview, 'javascript');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Process Info</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-xs">Process Name</Label>
              <p className="text-sm font-mono">{data?.info.name}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Working Directory</Label>
              <p className="text-sm font-mono">{data?.info.cwd}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Port</Label>
              <p className="text-sm font-mono">{data?.info.port}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">NODE_ENV</Label>
              <p className="text-sm font-mono">production</p>
            </div>
          </div>
          {data?.info.envVars && Object.keys(data.info.envVars).length > 0 && (
            <details className="pt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Environment Variables ({Object.keys(data.info.envVars).length})
              </summary>
              <div className="mt-2 space-y-1">
                {Object.entries(data.info.envVars).map(([key, val]) => (
                  <div key={key} className="text-xs font-mono">
                    <span className="text-foreground">{key}</span>
                    <span className="text-muted-foreground"> = {val}</span>
                  </div>
                ))}
              </div>
              <a href={`/projects/${projectId}/settings`} className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">
                Edit in Settings
              </a>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Runtime Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Start Script</Label>
            <Input
              value={form.script || ''}
              onChange={(e) => setField('script', e.target.value || null)}
              className="font-mono text-sm"
              placeholder={data?.info.detectedScript || 'dist/main.js'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to auto-detect{data?.info.detectedScript ? ` (${data.info.detectedScript})` : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Instances</Label>
              <Input
                type="number"
                min={1} max={16}
                value={form.instances}
                onChange={(e) => setField('instances', parseInt(e.target.value) || 1)}
                className="w-32"
              />
            </div>
            <div>
              <Label>Exec Mode</Label>
              <select
                value={form.execMode}
                onChange={(e) => setField('execMode', e.target.value)}
                className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="fork">fork</option>
                <option value="cluster">cluster</option>
              </select>
            </div>
          </div>
          {form.instances > 1 && form.execMode === 'cluster' && (
            <p className="text-xs text-muted-foreground">Multiple instances require cluster mode</p>
          )}

          <div>
            <Label>Max Memory Restart</Label>
            <Input
              value={form.maxMemoryRestart || ''}
              onChange={(e) => setField('maxMemoryRestart', e.target.value || null)}
              className="w-32 font-mono"
              placeholder="300M"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Auto-restart when memory exceeds this limit (e.g., 300M, 1G). Leave empty for no limit.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateConfig.isPending}>
        {updateConfig.isPending ? 'Saving...' : 'Save & Restart'}
      </Button>

      <Card>
        <CardHeader><CardTitle>Generated Configuration</CardTitle></CardHeader>
        <CardContent>
          {highlightedPreview ? (
            <div
              className="rounded-md text-xs overflow-x-auto leading-relaxed [&_pre]:p-4 [&_pre]:rounded-md"
              dangerouslySetInnerHTML={{ __html: highlightedPreview }}
            />
          ) : (
            <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
              {preview}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd frontend && npx next build`

Expected: Build succeeds (or at least no TypeScript errors in this file).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/\[id\]/pm2/page.tsx
git commit -m "feat: add PM2 config page"
```

---

### Task 9: Sidebar Navigation

**Files:**
- Modify: `frontend/src/components/project-sidebar.tsx:39`

- [ ] **Step 1: Add PM2 link to Config group**

In `frontend/src/components/project-sidebar.tsx`, in the Config group items array (line 38-42), add `PM2` between `Nginx` and `Webhooks`:

```typescript
    items: [
      { href: 'nginx', label: 'Nginx' },
      { href: 'pm2', label: 'PM2' },
      { href: 'webhooks', label: 'Webhooks' },
      { href: 'settings', label: 'Settings' },
    ],
```

- [ ] **Step 2: Verify it renders**

Run: `cd frontend && npm run dev`

Navigate to any project page and confirm "PM2" appears in sidebar under Config, between Nginx and Webhooks.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project-sidebar.tsx
git commit -m "feat: add PM2 to project sidebar navigation"
```
