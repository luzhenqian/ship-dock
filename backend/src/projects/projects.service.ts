import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { PortAllocationService } from './port-allocation.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const DEFAULT_PIPELINE = {
  stages: [
    { name: 'clone', type: 'builtin', config: {} },
    { name: 'install', type: 'command', command: 'npm install' },
    { name: 'migrate', type: 'command', command: 'npx prisma migrate deploy' },
    { name: 'build', type: 'command', command: 'npm run build' },
    { name: 'pm2', type: 'builtin', config: {} },
    { name: 'nginx', type: 'builtin', config: {} },
    { name: 'ssl', type: 'builtin', config: {} },
  ],
};

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private portAllocation: PortAllocationService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    const projectId = crypto.randomUUID();
    const port = dto.port
      ? await this.portAllocation.allocateSpecific(projectId, dto.port)
      : await this.portAllocation.allocate(projectId);

    const envVars = dto.envVars ? this.encryption.encrypt(JSON.stringify(dto.envVars)) : '';

    return this.prisma.project.create({
      data: {
        id: projectId, name: dto.name, slug: dto.slug,
        sourceType: dto.sourceType as any, repoUrl: dto.repoUrl,
        branch: dto.branch || 'main', domain: dto.domain,
        port, envVars, pipeline: dto.pipeline || DEFAULT_PIPELINE,
        pm2Name: dto.slug, createdById: userId,
      },
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      include: { deployments: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id }, include: { deployments: { orderBy: { version: 'desc' }, take: 5 } },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const data: any = { ...dto };
    if (data.envVars) {
      data.envVars = this.encryption.encrypt(JSON.stringify(data.envVars));
    }
    delete data.port;
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.portAllocation.release(id);
    return this.prisma.project.delete({ where: { id } });
  }

  async getDecryptedEnvVars(id: string): Promise<Record<string, string>> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.envVars) return {};
    return JSON.parse(this.encryption.decrypt(project.envVars));
  }
}
