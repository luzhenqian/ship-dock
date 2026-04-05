import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateNginxConfigDto } from './dto/update-nginx-config.dto';
import { NginxStage, NginxStageConfig } from '../deploy/stages/nginx.stage';
import { SslStage } from '../deploy/stages/ssl.stage';
import { spawn } from 'child_process';
import { writeFileSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

@Injectable()
export class NginxConfigService {
  private nginxStage = new NginxStage();
  private sslStage = new SslStage();

  constructor(private prisma: PrismaService) {}

  private extractValues(config: { clientMaxBodySize: number; proxyReadTimeout: number; proxySendTimeout: number; proxyConnectTimeout: number; gzipEnabled: boolean; gzipMinLength: number; gzipTypes: string; proxyBuffering: boolean; proxyBufferSize: string; proxyBuffers: string }) {
    return {
      clientMaxBodySize: config.clientMaxBodySize,
      proxyReadTimeout: config.proxyReadTimeout,
      proxySendTimeout: config.proxySendTimeout,
      proxyConnectTimeout: config.proxyConnectTimeout,
      gzipEnabled: config.gzipEnabled,
      gzipMinLength: config.gzipMinLength,
      gzipTypes: config.gzipTypes,
      proxyBuffering: config.proxyBuffering,
      proxyBufferSize: config.proxyBufferSize,
      proxyBuffers: config.proxyBuffers,
    };
  }

  async getConfig(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const config = await this.prisma.nginxConfig.findUnique({ where: { projectId } });

    const defaults = {
      clientMaxBodySize: 10,
      proxyReadTimeout: 60,
      proxySendTimeout: 60,
      proxyConnectTimeout: 60,
      gzipEnabled: true,
      gzipMinLength: 1024,
      gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
      proxyBuffering: true,
      proxyBufferSize: '4k',
      proxyBuffers: '8 4k',
    };

    const values = config ? this.extractValues(config) : defaults;

    const preview = project.domain
      ? this.nginxStage.buildConfig({
          domain: project.domain,
          port: project.port,
          slug: project.slug,
          hasSsl: this.sslStage.hasCert(project.domain),
          ...values,
        })
      : null;

    return { config: values, preview };
  }

  async updateConfig(projectId: string, dto: UpdateNginxConfigDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.domain) throw new BadRequestException('Project must have a domain configured before editing Nginx settings');

    // Save previous config for rollback
    const previousConfig = await this.prisma.nginxConfig.findUnique({ where: { projectId } });

    const config = await this.prisma.nginxConfig.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });

    const hasSsl = this.sslStage.hasCert(project.domain);
    const stageConfig: NginxStageConfig = {
      domain: project.domain,
      port: project.port,
      slug: project.slug,
      hasSsl,
      ...this.extractValues(config),
    };

    const confPath = `/etc/nginx/sites-available/${project.slug}.conf`;
    const backupPath = `${confPath}.bak`;
    const nginxConf = this.nginxStage.buildConfig(stageConfig);

    // Backup current config file
    if (existsSync(confPath)) {
      await this.execCommand(`sudo cp ${confPath} ${backupPath}`);
    }

    // Write new config via temp file to avoid shell injection
    const tmpPath = join(tmpdir(), `nginx-${project.slug}-${Date.now()}.conf`);
    writeFileSync(tmpPath, nginxConf);
    await this.execCommand(`sudo cp ${tmpPath} ${confPath}`);
    unlinkSync(tmpPath);

    // Validate nginx config
    const result = await this.execCommand('sudo nginx -t 2>&1');

    if (!result.success) {
      // Restore backup file
      if (existsSync(backupPath)) {
        await this.execCommand(`sudo cp ${backupPath} ${confPath}`);
      }
      // Rollback database to previous state
      if (previousConfig) {
        await this.prisma.nginxConfig.update({
          where: { projectId },
          data: this.extractValues(previousConfig),
        });
      } else {
        await this.prisma.nginxConfig.delete({ where: { projectId } }).catch(() => {});
      }
      throw new BadRequestException(`Nginx config validation failed: ${result.output}`);
    }

    // Config is valid, reload and clean up backup
    await this.execCommand('sudo nginx -s reload');
    if (existsSync(backupPath)) {
      await this.execCommand(`sudo rm ${backupPath}`);
    }

    const preview = this.nginxStage.buildConfig(stageConfig);
    return { config: this.extractValues(config), preview };
  }

  private execCommand(command: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn('sh', ['-c', command]);
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });
      child.on('close', (code) => resolve({ success: code === 0, output }));
      child.on('error', (err) => resolve({ success: false, output: err.message }));
    });
  }
}
