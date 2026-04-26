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
    const running = await this.prisma.projectTaskRun.findFirst({
      where: { taskId, status: 'RUNNING' },
      select: { id: true, status: true },
    });
    if (running) throw new ConflictException('Task has a running execution, cancel it first');
    return this.prisma.projectTask.delete({ where: { id: taskId } });
  }
}
