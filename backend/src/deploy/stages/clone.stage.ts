import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  projectDir: string;
  isFirstDeploy: boolean;
  githubToken?: string;
}

export class CloneStage {
  private buildAuthUrl(repoUrl: string, token: string): string {
    try {
      const url = new URL(repoUrl);
      url.username = 'x-access-token';
      url.password = token;
      return url.toString();
    } catch {
      return repoUrl;
    }
  }

  buildCommand(opts: CloneOptions): { command: string; displayCommand: string } {
    const authUrl = opts.githubToken ? this.buildAuthUrl(opts.repoUrl, opts.githubToken) : opts.repoUrl;

    if (opts.isFirstDeploy) {
      return {
        command: `git clone --branch ${opts.branch} --single-branch ${authUrl} ${opts.projectDir}`,
        displayCommand: `git clone --branch ${opts.branch} --single-branch ${opts.repoUrl} ${opts.projectDir}`,
      };
    }

    // For subsequent deploys, update the remote URL if token is provided
    const setRemote = opts.githubToken
      ? `cd ${opts.projectDir} && git remote set-url origin ${authUrl} && `
      : `cd ${opts.projectDir} && `;

    return {
      command: `${setRemote}git fetch origin && git reset --hard origin/${opts.branch}`,
      displayCommand: `cd ${opts.projectDir} && git fetch origin && git reset --hard origin/${opts.branch}`,
    };
  }

  execute(opts: CloneOptions, ctx: StageContext): Promise<StageResult> {
    const { command, displayCommand } = this.buildCommand(opts);
    ctx.onLog(`$ ${displayCommand}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], { env: { ...process.env } });
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => { const c = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m'; ctx.onLog(`${c}${line}\x1b[0m`); }); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `git exited with code ${code}` }); });
      child.on('error', (err) => { resolve({ success: false, error: err.message }); });
    });
  }
}
