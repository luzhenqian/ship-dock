import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../common/prisma.service';
import { ProjectTasksGateway } from './project-tasks.gateway';
import { CreateProjectTaskDto } from './dto/create-task.dto';
import { UpdateProjectTaskDto } from './dto/update-task.dto';

@Injectable()
export class ProjectTasksService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('tasks') private queue: Queue,
    private gateway: ProjectTasksGateway,
    private config: ConfigService,
  ) {}

  private validateWorkDir(dir: string): string {
    const sanitized = dir.replace(/\\/g, '/').trim();
    if (sanitized.includes('..') || sanitized.startsWith('/') || /[;&|`$]/.test(sanitized)) {
      throw new BadRequestException('Invalid workDir');
    }
    return sanitized;
  }

  async create(projectId: string, dto: CreateProjectTaskDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const workDir = dto.workDir ? this.validateWorkDir(dto.workDir) : undefined;
    try {
      return await this.prisma.projectTask.create({
        data: { projectId, name: dto.name, command: dto.command, workDir },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException(`A task named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async list(projectId: string) {
    const tasks = await this.prisma.projectTask.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true, status: true, exitCode: true,
            startedAt: true, finishedAt: true, createdAt: true,
            triggeredBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    return tasks.map((t) => {
      const { runs, ...rest } = t;
      return { ...rest, latestRun: runs[0] ?? null };
    });
  }

  async getOne(projectId: string, taskId: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(projectId: string, taskId: string, dto: UpdateProjectTaskDto) {
    const existing = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!existing) throw new NotFoundException('Task not found');
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.command !== undefined) data.command = dto.command;
    if (dto.workDir !== undefined) data.workDir = dto.workDir ? this.validateWorkDir(dto.workDir) : null;
    try {
      return await this.prisma.projectTask.update({ where: { id: taskId }, data });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException(`A task named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async remove(projectId: string, taskId: string) {
    const existing = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!existing) throw new NotFoundException('Task not found');
    const active = await this.prisma.projectTaskRun.findFirst({
      where: { taskId, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, status: true },
    });
    if (active) throw new ConflictException('Task has a queued or running execution, cancel it first');
    return this.prisma.projectTask.delete({ where: { id: taskId } });
  }

  private resolveProjectDir(project: { slug: string; directory: string | null; workDir: string | null }, taskWorkDir?: string | null) {
    const projectsRoot = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsRoot, project.directory || project.slug);
    const sub = taskWorkDir ?? project.workDir ?? '';
    return sub ? join(repoDir, sub) : repoDir;
  }

  async triggerRun(projectId: string, taskId: string, userId: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new NotFoundException('Task not found');
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, slug: true, directory: true, workDir: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const cwd = this.resolveProjectDir(project, task.workDir);
    if (!existsSync(cwd)) {
      throw new BadRequestException('Project has not been deployed yet');
    }

    const run = await this.prisma.projectTaskRun.create({
      data: { taskId, status: 'QUEUED', triggeredById: userId },
    });
    // jobId = run.id so cancelRun (added in Task 9) can find and remove queued jobs.
    await this.queue.add('run', { taskRunId: run.id }, { jobId: run.id });
    return run;
  }

  async listRuns(projectId: string, taskId: string, cursor?: string, limit = 20) {
    await this.getOne(projectId, taskId); // 404 if not in project
    const where: any = { taskId };
    if (cursor) {
      const c = await this.prisma.projectTaskRun.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (!c) throw new BadRequestException('Invalid cursor');
      where.createdAt = { lt: c.createdAt };
    }
    const items = await this.prisma.projectTaskRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      omit: { logs: true },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return {
      items: items.map((r) => ({
        ...r,
        duration: r.startedAt && r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) : null,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getRun(projectId: string, taskId: string, runId: string) {
    const run = await this.prisma.projectTaskRun.findFirst({
      where: { id: runId, taskId, task: { projectId } },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async recoverStuckRuns() {
    const stuck = await this.prisma.projectTaskRun.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, logs: true },
    });
    const now = new Date();
    for (const r of stuck) {
      const prevLogs = Array.isArray(r.logs) ? (r.logs as any[]) : [];
      const logs = [...prevLogs, { t: now.getTime(), m: '[system] Worker restarted, run aborted' }];
      await this.prisma.projectTaskRun.update({
        where: { id: r.id },
        data: { status: 'FAILED', finishedAt: now, logs },
      });
    }
  }
}
