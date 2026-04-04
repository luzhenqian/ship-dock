import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  projectDir: string;
  isFirstDeploy: boolean;
}

export class CloneStage {
  buildCommand(opts: CloneOptions): string {
    if (opts.isFirstDeploy) {
      return `git clone --branch ${opts.branch} --single-branch ${opts.repoUrl} ${opts.projectDir}`;
    }
    return `cd ${opts.projectDir} && git fetch origin && git reset --hard origin/${opts.branch}`;
  }

  execute(opts: CloneOptions, ctx: StageContext): Promise<StageResult> {
    const command = this.buildCommand(opts);
    ctx.onLog(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], { env: { ...process.env } });
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => { const c = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m'; ctx.onLog(`${c}${line}\x1b[0m`); }); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `git exited with code ${code}` }); });
      child.on('error', (err) => { resolve({ success: false, error: err.message }); });
    });
  }
}
