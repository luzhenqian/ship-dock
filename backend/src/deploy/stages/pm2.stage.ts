import { writeFileSync } from 'fs';
import { join } from 'path';
import { StageContext, StageResult } from './command.stage';
import { spawn } from 'child_process';

export interface Pm2Config {
  name: string; script: string; cwd: string; port: number; envVars: Record<string, string>;
}

export class Pm2Stage {
  buildEcosystemConfig(config: Pm2Config, isNpmStart = false): string {
    const envEntries = Object.entries(config.envVars).map(([k, v]) => `      ${k}: '${v}'`).join(',\n');

    if (isNpmStart) {
      return `module.exports = {
  apps: [{
    name: '${config.name}',
    script: 'npm',
    args: 'start',
    cwd: '${config.cwd}',
    env: {
      PORT: ${config.port},
      NODE_ENV: 'production',
${envEntries}
    }
  }]
};`;
    }

    return `module.exports = {
  apps: [{
    name: '${config.name}',
    script: '${config.script}',
    cwd: '${config.cwd}',
    env: {
      PORT: ${config.port},
      NODE_ENV: 'production',
${envEntries}
    }
  }]
};`;
  }

  buildCommand(projectDir: string, isFirstDeploy: boolean): string {
    return isFirstDeploy
      ? `cd ${projectDir} && pm2 start ecosystem.config.js`
      : `cd ${projectDir} && pm2 restart ecosystem.config.js`;
  }

  async execute(config: Pm2Config, isFirstDeploy: boolean, ctx: StageContext, isNpmStart = false): Promise<StageResult> {
    const ecosystemPath = join(config.cwd, 'ecosystem.config.js');
    writeFileSync(ecosystemPath, this.buildEcosystemConfig(config, isNpmStart));
    ctx.onLog(`Wrote ecosystem.config.js`);
    const command = this.buildCommand(config.cwd, isFirstDeploy);
    ctx.onLog(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(line)); });
      child.stderr.on('data', (data) => { data.toString().split('\n').filter(Boolean).forEach((line: string) => ctx.onLog(`\x1b[31m${line}\x1b[0m`)); });
      child.on('close', (code) => { resolve(code === 0 ? { success: true } : { success: false, error: `pm2 exited with code ${code}` }); });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }
}
