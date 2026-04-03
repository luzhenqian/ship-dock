import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PortAllocationService {
  private readonly minPort: number;
  private readonly maxPort: number;

  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.minPort = this.config.get('PORT_RANGE_MIN', 3001);
    this.maxPort = this.config.get('PORT_RANGE_MAX', 3999);
  }

  async allocate(projectId: string): Promise<number> {
    const available = await this.prisma.portAllocation.findFirst({
      where: { projectId: null }, orderBy: { port: 'asc' },
    });
    if (available) {
      const updated = await this.prisma.portAllocation.update({
        where: { id: available.id }, data: { projectId, allocatedAt: new Date() },
      });
      return updated.port;
    }
    const nextPort = await this.findNextUnallocatedPort();
    const created = await this.prisma.portAllocation.create({
      data: { port: nextPort, projectId, allocatedAt: new Date() },
    });
    return created.port;
  }

  async allocateSpecific(projectId: string, port: number): Promise<number> {
    if (port < this.minPort || port > this.maxPort) {
      throw new BadRequestException(`Port must be between ${this.minPort} and ${this.maxPort}`);
    }
    const existing = await this.prisma.portAllocation.findUnique({ where: { port } });
    if (existing && existing.projectId) {
      throw new BadRequestException(`Port ${port} is already allocated`);
    }
    if (existing) {
      await this.prisma.portAllocation.update({
        where: { id: existing.id }, data: { projectId, allocatedAt: new Date() },
      });
      return port;
    }
    await this.prisma.portAllocation.create({ data: { port, projectId, allocatedAt: new Date() } });
    return port;
  }

  async release(projectId: string): Promise<void> {
    const allocation = await this.prisma.portAllocation.findFirst({ where: { projectId } });
    if (!allocation) return;
    await this.prisma.portAllocation.update({
      where: { id: allocation.id }, data: { projectId: null, allocatedAt: null },
    });
  }

  private async findNextUnallocatedPort(): Promise<number> {
    const last = await this.prisma.portAllocation.findFirst({ orderBy: { port: 'desc' } });
    const next = last ? last.port + 1 : this.minPort;
    if (next > this.maxPort) throw new BadRequestException('No available ports in range');
    return next;
  }
}
