import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ProjectLockService } from '../common/project-lock.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

const MAX_LOG_LINES = 50_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

interface LogEntry { t: number; m: string }

@Processor('tasks')
export class ProjectTasksProcessor extends WorkerHost {
  private readonly logger = new Logger(ProjectTasksProcessor.name);
  private readonly children = new Map<string, ChildProcess>();
  private readonly cancelRequested = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private projectLock: ProjectLockService,
    private gateway: ProjectTasksGateway,
  ) { super(); }

  async process(job: Job<{ taskRunId: string }>) {
    const { taskRunId } = job.data;
    const run = await this.prisma.projectTaskRun.findUnique({
      where: { id: taskRunId },
      include: { task: true },
    });
    if (!run) return;

    const projectId = run.task.projectId;

    return this.projectLock.withLock(projectId, async () => {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, slug: true, directory: true, workDir: true, envVars: true, nodeVersion: true },
      });
      if (!project) {
        await this.prisma.projectTaskRun.update({
          where: { id: taskRunId },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        return;
      }

      const projectsRoot = this.config.get<string>('PROJECTS_DIR', '/var/www');
      const repoDir = join(projectsRoot, project.directory || project.slug);
      const cwd = run.task.workDir
        ? join(repoDir, run.task.workDir)
        : project.workDir
        ? join(repoDir, project.workDir)
        : repoDir;

      if (!existsSync(cwd)) {
        const log: LogEntry = { t: Date.now(), m: `\x1b[31m[error] Working directory ${cwd} does not exist\x1b[0m` };
        await this.prisma.projectTaskRun.update({
          where: { id: taskRunId },
          data: { status: 'FAILED', finishedAt: new Date(), logs: [log] as any },
        });
        this.gateway.emitToTaskRun(taskRunId, 'log', log);
        this.gateway.emitToTaskRun(taskRunId, 'status', { status: 'FAILED' });
        return;
      }

      // Decrypt project env
      let envVars: Record<string, string> = {};
      if (project.envVars) {
        try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
      }
      // Optional Node version on PATH (mirrors deploy.processor logic)
      if (project.nodeVersion) {
        try {
          const { readdirSync } = require('fs');
          const versions: string[] = readdirSync('/usr/local/n/versions/node/');
          const match = versions.find((v: string) => v.startsWith(project.nodeVersion + '.'));
          if (match) envVars.PATH = `/usr/local/n/versions/node/${match}/bin:${process.env.PATH || ''}`;
        } catch {}
      }

      await this.prisma.projectTaskRun.update({
        where: { id: taskRunId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      this.gateway.emitToTaskRun(taskRunId, 'status', { status: 'RUNNING' });

      // Cancellation is signalled by ProjectTasksService.cancelRun calling
      // this.signalCancel(taskRunId), which kills the child and flips cancelRequested.

      const logs: LogEntry[] = [];
      let bytes = 0;
      let truncated = false;
      const onLog = (line: string) => {
        const entry = { t: Date.now(), m: line };
        if (!truncated) {
          if (logs.length >= MAX_LOG_LINES || bytes + line.length > MAX_LOG_BYTES) {
            truncated = true;
            const summary = { t: Date.now(), m: `[truncated, ${logs.length}+ lines suppressed]` };
            logs.push(summary);
            this.gateway.emitToTaskRun(taskRunId, 'log', summary);
          } else {
            logs.push(entry);
            bytes += line.length;
            this.gateway.emitToTaskRun(taskRunId, 'log', entry);
          }
        }
      };

      const result = await this.runShell(taskRunId, run.task.command, cwd, envVars, onLog);

      const finalStatus = result.cancelled ? 'CANCELLED' : (result.exitCode === 0 ? 'SUCCESS' : 'FAILED');
      await this.prisma.projectTaskRun.update({
        where: { id: taskRunId },
        data: {
          status: finalStatus,
          exitCode: result.exitCode,
          finishedAt: new Date(),
          logs: logs as any,
        },
      });
      this.gateway.emitToTaskRun(taskRunId, 'status', { status: finalStatus, exitCode: result.exitCode });

      this.children.delete(taskRunId);
      this.cancelRequested.delete(taskRunId);
    });
  }

  /** Called by ProjectTasksService.cancelRun for RUNNING runs. */
  signalCancel(taskRunId: string) {
    this.cancelRequested.add(taskRunId);
    const child = this.children.get(taskRunId);
    if (child && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000).unref();
    }
  }

  private runShell(
    taskRunId: string,
    command: string,
    cwd: string,
    envVars: Record<string, string>,
    onLog: (line: string) => void,
  ): Promise<{ exitCode: number | null; cancelled: boolean }> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], {
        cwd,
        env: { ...process.env, ...envVars },
      });
      this.children.set(taskRunId, child);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach(onLog);
      });
      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => {
          const color = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m';
          onLog(`${color}[stderr] ${line}\x1b[0m`);
        });
      });

      child.on('close', (code) => {
        const cancelled = this.cancelRequested.has(taskRunId);
        resolve({ exitCode: cancelled ? null : code, cancelled });
      });
      child.on('error', (err) => {
        onLog(`\x1b[31m[error] ${err.message}\x1b[0m`);
        resolve({ exitCode: null, cancelled: false });
      });
    });
  }
}
