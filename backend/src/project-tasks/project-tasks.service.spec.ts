import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { existsSync } from 'fs';
import { ProjectTasksService } from './project-tasks.service';
import { PrismaService } from '../common/prisma.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

jest.mock('fs', () => ({ existsSync: jest.fn() }));

describe('ProjectTasksService', () => {
  let service: ProjectTasksService;
  let prisma: any;
  let queue: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      projectTask: {
        create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(),
      },
      projectTaskRun: {
        create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
      },
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };
    gateway = { emitToTaskRun: jest.fn(), server: { sockets: { adapter: { rooms: new Map() } } } };

    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('tasks'), useValue: queue },
        { provide: ProjectTasksGateway, useValue: gateway },
        { provide: ConfigService, useValue: { get: (_k: string, d?: any) => d ?? '/var/www' } },
      ],
    }).compile();
    service = module.get(ProjectTasksService);
    (existsSync as jest.Mock).mockReturnValue(true);
  });

  describe('create', () => {
    it('creates a task', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.projectTask.create.mockResolvedValue({ id: 't1', name: 'seed' });
      const result = await service.create('p1', { name: 'seed', command: 'npm run seed' });
      expect(prisma.projectTask.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', name: 'seed', command: 'npm run seed', workDir: undefined },
      });
      expect(result).toEqual({ id: 't1', name: 'seed' });
    });

    it('rejects when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(
        service.create('missing', { name: 'seed', command: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates Prisma unique-violation into ConflictException', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1' });
      const err: any = new Error('unique');
      err.code = 'P2002';
      prisma.projectTask.create.mockRejectedValue(err);
      await expect(
        service.create('p1', { name: 'seed', command: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('returns tasks with latestRun summary', async () => {
      prisma.projectTask.findMany.mockResolvedValue([
        {
          id: 't1', name: 'seed', command: 'npm run seed', workDir: null, projectId: 'p1',
          createdAt: new Date(), updatedAt: new Date(),
          runs: [{ id: 'r1', status: 'SUCCESS', startedAt: new Date(), finishedAt: new Date(), createdAt: new Date(), exitCode: 0, triggeredBy: { id: 'u1', name: 'alice' } }],
        },
      ]);
      const result = await service.list('p1');
      expect(result[0].latestRun?.status).toBe('SUCCESS');
      // logs must not leak in list responses
      expect(result[0].latestRun).not.toHaveProperty('logs');
    });
  });

  describe('update', () => {
    it('updates an existing task', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTask.update.mockResolvedValue({ id: 't1', name: 'seed-v2' });
      const result = await service.update('p1', 't1', { name: 'seed-v2' });
      expect(result.name).toBe('seed-v2');
    });

    it('404s when task is not in this project', async () => {
      prisma.projectTask.findFirst.mockResolvedValue(null);
      await expect(service.update('p1', 't1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to delete while a run is RUNNING', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTaskRun.findFirst.mockResolvedValue({ id: 'r1', status: 'RUNNING' });
      await expect(service.remove('p1', 't1')).rejects.toThrow(ConflictException);
    });

    it('refuses to delete while a run is QUEUED', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTaskRun.findFirst.mockResolvedValue({ id: 'r1', status: 'QUEUED' });
      await expect(service.remove('p1', 't1')).rejects.toThrow(ConflictException);
    });

    it('deletes when no run is RUNNING', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTaskRun.findFirst.mockResolvedValue(null);
      prisma.projectTask.delete.mockResolvedValue({ id: 't1' });
      const result = await service.remove('p1', 't1');
      expect(result).toEqual({ id: 't1' });
    });
  });

  describe('triggerRun', () => {
    it('rejects when project never deployed (workDir missing on disk)', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1', command: 'x', workDir: null });
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', slug: 'app', workDir: null, directory: 'app' });
      (existsSync as jest.Mock).mockReturnValue(false);
      await expect(service.triggerRun('p1', 't1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('creates a QUEUED run and enqueues a job (jobId = runId)', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1', command: 'x', workDir: null });
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', slug: 'app', workDir: null, directory: 'app' });
      (existsSync as jest.Mock).mockReturnValue(true);
      prisma.projectTaskRun.create.mockResolvedValue({ id: 'r1', status: 'QUEUED' });
      const run = await service.triggerRun('p1', 't1', 'u1');
      expect(prisma.projectTaskRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taskId: 't1', triggeredById: 'u1', status: 'QUEUED' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('run', { taskRunId: 'r1' }, { jobId: 'r1' });
      expect(run.id).toBe('r1');
    });
  });

  describe('listRuns', () => {
    it('omits logs and returns duration when finished', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      const start = new Date('2026-04-27T10:00:00Z');
      const end = new Date('2026-04-27T10:00:05Z');
      prisma.projectTaskRun.findMany.mockResolvedValue([
        { id: 'r1', startedAt: start, finishedAt: end, createdAt: end, status: 'SUCCESS', triggeredBy: { id: 'u1', name: 'a' } },
      ]);
      const result = await service.listRuns('p1', 't1');
      expect(result.items[0].duration).toBe(5);
      expect(result.items[0]).not.toHaveProperty('logs');
    });
  });

  describe('crash recovery', () => {
    it('marks RUNNING runs as FAILED on init', async () => {
      prisma.projectTaskRun.findMany.mockResolvedValue([{ id: 'r1', logs: [] }, { id: 'r2', logs: [{ t: 1, m: 'hello' }] }]);
      prisma.projectTaskRun.update.mockResolvedValue({});
      await service.recoverStuckRuns();
      expect(prisma.projectTaskRun.update).toHaveBeenCalledTimes(2);
      const firstCallData = prisma.projectTaskRun.update.mock.calls[0][0].data;
      expect(firstCallData.status).toBe('FAILED');
      expect(firstCallData.finishedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(firstCallData.logs)).toContain('Worker restarted');
    });
  });
});
