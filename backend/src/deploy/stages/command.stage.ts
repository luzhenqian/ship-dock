import { spawn } from 'child_process';

export interface StageConfig {
  name: string;
  type: string;
  command?: string;
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
      const child = spawn('sh', ['-c', stageConfig.command!], {
        cwd: ctx.projectDir,
        env: { ...process.env, ...ctx.envVars },
      });

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => ctx.onLog(line));
      });

      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => ctx.onLog(`\x1b[31m[stderr] ${line}\x1b[0m`));
      });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `Command exited with code ${code}` });
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}
