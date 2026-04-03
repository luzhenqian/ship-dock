import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DeployService } from './deploy.service';
import { PrismaService } from '../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';

describe('DeployService', () => {
  let service: DeployService;
  let prisma: any;
  let queue: any;

  beforeEach(async () => {
    prisma = {
      deployment: {
        create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        update: jest.fn(), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn(),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: 'proj-1', slug: 'my-app', pipeline: { stages: [] } }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('deploy'), useValue: queue },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  describe('trigger', () => {
    it('creates a deployment and adds job to queue', async () => {
      prisma.deployment.count.mockResolvedValue(2);
      prisma.deployment.create.mockResolvedValue({ id: 'dep-1', version: 3, status: 'QUEUED' });
      const result = await service.trigger('proj-1', 'user-1');
      expect(prisma.deployment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: 'proj-1', triggeredById: 'user-1', version: 3, status: 'QUEUED' }) }),
      );
      expect(queue.add).toHaveBeenCalledWith('deploy', expect.objectContaining({ deploymentId: 'dep-1' }));
    });
  });

  describe('cancel', () => {
    it('marks a running deployment as cancelled', async () => {
      prisma.deployment.findUnique.mockResolvedValue({ id: 'dep-1', status: 'RUNNING' });
      prisma.deployment.update.mockResolvedValue({ id: 'dep-1', status: 'CANCELLED' });
      const result = await service.cancel('dep-1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('getHistory', () => {
    it('returns deployments for a project', async () => {
      prisma.deployment.findMany.mockResolvedValue([{ id: 'dep-1', version: 1 }, { id: 'dep-2', version: 2 }]);
      const result = await service.getHistory('proj-1');
      expect(result).toHaveLength(2);
    });
  });
});
