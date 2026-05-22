import { spawn, SpawnOptions } from 'child_process';

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

export function spawnWithTimeout(
  command: string,
  onLog: (line: string) => void,
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; label?: string } = {},
): Promise<StageResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const label = opts.label || command.slice(0, 40);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: StageResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    const child = spawn('sh', ['-c', command], spawnOpts);

    const timer = setTimeout(() => {
      onLog(`\x1b[31m"${label}" timed out after ${Math.round(timeoutMs / 1000)}s — killing process\x1b[0m`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
      done({ success: false, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout!.on('data', (data) => {
      data.toString().split('\n').filter((l: string) => l).forEach((line: string) => onLog(line));
    });

    child.stderr!.on('data', (data) => {
      data.toString().split('\n').filter((l: string) => l).forEach((line: string) => {
        if (/\bsyntax is ok\b|\btest is successful\b|\bsignal process started\b|\b\[notice\]\b/i.test(line)) {
          onLog(line);
        } else if (/\bwarn(ing)?\b/i.test(line)) {
          onLog(`\x1b[33m${line}\x1b[0m`);
        } else {
          onLog(`\x1b[31m${line}\x1b[0m`);
        }
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

export class CommandStage {
  execute(stageConfig: StageConfig, ctx: StageContext): Promise<StageResult> {
    return spawnWithTimeout(stageConfig.command!, ctx.onLog, {
      cwd: ctx.projectDir,
      env: ctx.envVars,
      timeoutMs: stageConfig.timeout,
      label: stageConfig.name,
    });
  }
}
