import { writeFileSync } from 'fs';
import { join } from 'path';
import { StageContext, StageResult, spawnWithTimeout } from './command.stage';

export interface Pm2Config {
  name: string; script: string; cwd: string; port: number; envVars: Record<string, string>;
  instances?: number;
  execMode?: string;
  maxMemoryRestart?: string;
}

export class Pm2Stage {
  buildEcosystemConfig(config: Pm2Config, isNpmStart = false): string {
    const envEntries = Object.entries(config.envVars).map(([k, v]) => `      ${k}: '${v}'`).join(',\n');

    const optionalLines: string[] = [];
    if (config.instances !== undefined && config.instances !== 1) {
      optionalLines.push(`    instances: ${config.instances},`);
    }
    if (config.execMode && config.execMode !== 'fork') {
      optionalLines.push(`    exec_mode: '${config.execMode}',`);
    }
    if (config.maxMemoryRestart) {
      optionalLines.push(`    max_memory_restart: '${config.maxMemoryRestart}',`);
    }
    const optionalBlock = optionalLines.length > 0 ? '\n' + optionalLines.join('\n') : '';

    const scriptLine = isNpmStart
      ? `    script: '${config.script}',\n    args: 'start',`
      : `    script: '${config.script}',\n    interpreter: 'node',`;

    return `module.exports = {
  apps: [{
    name: '${config.name}',
${scriptLine}
    cwd: '${config.cwd}',${optionalBlock}
    env: {
      PORT: ${config.port},
      NODE_ENV: 'production',
${envEntries}
    }
  }]
};`;
  }

  buildCommand(projectDir: string, name: string): string {
    return `cd ${projectDir} && pm2 delete ${name} 2>/dev/null; pm2 start ecosystem.config.js`;
  }

  async execute(config: Pm2Config, isFirstDeploy: boolean, ctx: StageContext, isNpmStart = false): Promise<StageResult> {
    const ecosystemPath = join(config.cwd, 'ecosystem.config.js');
    writeFileSync(ecosystemPath, this.buildEcosystemConfig(config, isNpmStart));
    ctx.onLog(`Wrote ecosystem.config.js`);
    const command = this.buildCommand(config.cwd, config.name);
    ctx.onLog(`$ ${command}`);
    return spawnWithTimeout(command, ctx.onLog, {
      env: ctx.envVars,
      timeoutMs: 2 * 60 * 1000,
      label: 'pm2',
    });
  }
}
