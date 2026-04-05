import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateNginxConfigDto } from './dto/update-nginx-config.dto';
import { NginxStage, NginxStageConfig } from '../deploy/stages/nginx.stage';
import { spawn } from 'child_process';

@Injectable()
export class NginxConfigService {
  private nginxStage = new NginxStage();

  constructor(private prisma: PrismaService) {}

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

    const values = config
      ? {
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
        }
      : defaults;

    const preview = project.domain
      ? this.nginxStage.buildConfig({
          domain: project.domain,
          port: project.port,
          slug: project.slug,
          hasSsl: true,
          ...values,
        })
      : null;

    return { config: values, preview };
  }

  async updateConfig(projectId: string, dto: UpdateNginxConfigDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.domain) throw new BadRequestException('Project must have a domain configured before editing Nginx settings');

    const config = await this.prisma.nginxConfig.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });

    const stageConfig: NginxStageConfig = {
      domain: project.domain,
      port: project.port,
      slug: project.slug,
      hasSsl: true,
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

    const confPath = `/etc/nginx/sites-available/${project.slug}.conf`;
    const nginxConf = this.nginxStage.buildConfig(stageConfig);

    // Write config and validate
    const result = await this.execCommand(
      `echo '${nginxConf.replace(/'/g, "'\\''")}' | sudo tee ${confPath} > /dev/null && sudo nginx -t 2>&1`,
    );

    if (!result.success) {
      await this.prisma.nginxConfig.delete({ where: { projectId } }).catch(() => {});
      throw new BadRequestException(`Nginx config validation failed: ${result.output}`);
    }

    // Config is valid, reload
    await this.execCommand('sudo nginx -s reload');

    const preview = this.nginxStage.buildConfig(stageConfig);
    return {
      config: {
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
      },
      preview,
    };
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
