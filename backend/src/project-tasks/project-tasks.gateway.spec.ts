import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ProjectTasksGateway } from './project-tasks.gateway';

describe('ProjectTasksGateway', () => {
  let gateway: ProjectTasksGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN' }) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'secret' } },
      ],
    }).compile();
    gateway = module.get(ProjectTasksGateway);
  });

  it('is defined', () => { expect(gateway).toBeDefined(); });
  it('exposes emitToTaskRun', () => { expect(typeof gateway.emitToTaskRun).toBe('function'); });
});
