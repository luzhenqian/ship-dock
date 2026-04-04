import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private tails = new Map<string, ChildProcess>();

  constructor(private prisma: PrismaService) {}

  private getLogPaths(pm2Name: string) {
    const pm2LogDir = join(homedir(), '.pm2', 'logs');
    return {
      stdout: join(pm2LogDir, `${pm2Name}-out.log`),
      stderr: join(pm2LogDir, `${pm2Name}-error.log`),
    };
  }

  async getHistoricalLogs(
    projectId: string,
    options: { type?: 'stdout' | 'stderr'; lines?: number; search?: string },
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const paths = this.getLogPaths(project.pm2Name);
    const type = options.type || 'stdout';
    const filePath = type === 'stderr' ? paths.stderr : paths.stdout;

    if (!existsSync(filePath)) return { lines: [], type };

    const content = await readFile(filePath, 'utf-8');
    let lines = content.split('\n').filter((l) => l.length > 0);

    if (options.search) {
      const search = options.search.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(search));
    }

    const maxLines = options.lines || 200;
    lines = lines.slice(-maxLines);

    return { lines, type };
  }

  async startTail(
    projectId: string,
    onLog: (data: { type: string; line: string }) => void,
  ): Promise<void> {
    if (this.tails.has(projectId)) return;

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const paths = this.getLogPaths(project.pm2Name);

    for (const [type, filePath] of [['stdout', paths.stdout], ['stderr', paths.stderr]] as const) {
      if (!existsSync(filePath)) continue;

      const tail = spawn('tail', ['-f', '-n', '0', filePath]);
      const key = `${projectId}:${type}`;
      this.tails.set(key, tail);

      tail.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.length > 0);
        for (const line of lines) {
          onLog({ type, line });
        }
      });

      tail.on('close', () => {
        this.tails.delete(key);
      });
    }
  }

  stopTail(projectId: string) {
    for (const type of ['stdout', 'stderr']) {
      const key = `${projectId}:${type}`;
      const tail = this.tails.get(key);
      if (tail) {
        tail.kill();
        this.tails.delete(key);
      }
    }
  }
}
