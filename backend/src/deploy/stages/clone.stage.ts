import { StageContext, StageResult, spawnWithTimeout } from './command.stage';

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
    return spawnWithTimeout(command, ctx.onLog, {
      timeoutMs: 5 * 60 * 1000,
      label: 'git clone',
    });
  }
}
