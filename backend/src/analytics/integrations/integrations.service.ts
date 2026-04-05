import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AnalyticsProvider } from '@prisma/client';

export interface CreateIntegrationInput {
  projectId: string;
  connectionId: string;
  provider: AnalyticsProvider;
  ga4PropertyId?: string;
  ga4StreamId?: string;
  measurementId?: string;
  clarityProjectId?: string;
  clarityTrackingCode?: string;
}

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.analyticsIntegration.findMany({
      where: { projectId },
      include: {
        connection: { select: { accountEmail: true, provider: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.analyticsIntegration.findUnique({ where: { id } });
  }

  async create(input: CreateIntegrationInput) {
    const existing = await this.prisma.analyticsIntegration.findFirst({
      where: { projectId: input.projectId, provider: input.provider },
    });
    if (existing) {
      throw new ConflictException(
        `Project already has a ${input.provider} integration`,
      );
    }

    return this.prisma.analyticsIntegration.create({
      data: {
        projectId: input.projectId,
        connectionId: input.connectionId,
        provider: input.provider,
        ga4PropertyId: input.ga4PropertyId,
        ga4StreamId: input.ga4StreamId,
        measurementId: input.measurementId,
        clarityProjectId: input.clarityProjectId,
        clarityTrackingCode: input.clarityTrackingCode,
      },
    });
  }

  async update(
    id: string,
    data: Partial<Omit<CreateIntegrationInput, 'projectId' | 'provider'>>,
  ) {
    return this.prisma.analyticsIntegration.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, projectId: string) {
    const integration = await this.prisma.analyticsIntegration.findUnique({
      where: { id },
    });
    if (!integration || integration.projectId !== projectId) {
      throw new NotFoundException('Integration not found');
    }
    return this.prisma.analyticsIntegration.delete({ where: { id } });
  }
}
