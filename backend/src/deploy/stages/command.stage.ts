import { spawn } from 'child_process';

const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export interface StageConfig {
  name: string;
  type: string;
  command?: string;
  timeout?: number;
  config?: Record<string, any>;
}

export interface StageContext {
  projectDir: string;
  onLog: (line: string) => void;
  envVars?: Record<string, string>;
}

export interface StageResult {
  success: boolean;
  error?: string;
}

export class CommandStage {
  execute(stageConfig: StageConfig, ctx: StageContext): Promise<StageResult> {
    return new Promise((resolve) => {
      const timeoutMs = stageConfig.timeout ?? DEFAULT_TIMEOUT;
      let resolved = false;
      const done = (result: StageResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const child = spawn('sh', ['-c', stageConfig.command!], {
        cwd: ctx.projectDir,
        env: { ...process.env, ...ctx.envVars, CI: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        ctx.onLog(`\x1b[31mStage "${stageConfig.name}" timed out after ${Math.round(timeoutMs / 1000)}s — killing process\x1b[0m`);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
        done({ success: false, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => {
          const color = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m';
          ctx.onLog(`${color}[stderr] ${line}\x1b[0m`);
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        done(code === 0 ? { success: true } : { success: false, error: `Command exited with code ${code}` });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        done({ success: false, error: err.message });
      });
    });
  }
}
