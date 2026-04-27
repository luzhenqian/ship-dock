import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProjectTasksProcessor } from './project-tasks.processor';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ProjectLockService } from '../common/project-lock.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

describe('ProjectTasksProcessor', () => {
  let processor: ProjectTasksProcessor;
  let prisma: any;
  let lock: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      projectTaskRun: { findUnique: jest.fn(), update: jest.fn() },
      project: { findUnique: jest.fn() },
    };
    lock = { withLock: jest.fn().mockImplementation((_id: string, fn: () => any) => fn()) };
    gateway = { emitToTaskRun: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: { decrypt: () => '{}' } },
        { provide: ConfigService, useValue: { get: (_k: string, d?: any) => d } },
        { provide: ProjectLockService, useValue: lock },
        { provide: ProjectTasksGateway, useValue: gateway },
      ],
    }).compile();
    processor = module.get(ProjectTasksProcessor);
  });

  it('marks run CANCELLED when the project no longer exists', async () => {
    prisma.projectTaskRun.findUnique.mockResolvedValue({
      id: 'r1', taskId: 't1', status: 'QUEUED',
      task: { id: 't1', projectId: 'p1', command: 'echo hi', workDir: null },
    });
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.projectTaskRun.update.mockResolvedValue({});
    await processor.process({ data: { taskRunId: 'r1' } } as any);
    expect(prisma.projectTaskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('signalCancel sends SIGTERM to the child process group', () => {
    const child: any = { pid: 12345, killed: false };
    (processor as any).children.set('r1', child);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      processor.signalCancel('r1');
      // Negative PID == process group, so the whole tree dies, not just `sh`.
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      expect((processor as any).cancelRequested.has('r1')).toBe(true);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('signalCancel swallows ESRCH if the group is already gone', () => {
    const child: any = { pid: 12345, killed: false };
    (processor as any).children.set('r1', child);
    const err: any = new Error('no such process');
    err.code = 'ESRCH';
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => { throw err; });
    try {
      expect(() => processor.signalCancel('r1')).not.toThrow();
    } finally {
      killSpy.mockRestore();
    }
  });
});
