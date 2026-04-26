import { Test } from '@nestjs/testing';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTasksService } from './project-tasks.service';

describe('ProjectTasksController', () => {
  let controller: ProjectTasksController;
  let svc: any;

  beforeEach(async () => {
    svc = {
      list: jest.fn(), create: jest.fn(), getOne: jest.fn(),
      update: jest.fn(), remove: jest.fn(),
      triggerRun: jest.fn(), listRuns: jest.fn(), getRun: jest.fn(), cancelRun: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ProjectTasksController],
      providers: [{ provide: ProjectTasksService, useValue: svc }],
    }).compile();
    controller = module.get(ProjectTasksController);
  });

  it('list delegates to service', async () => {
    svc.list.mockResolvedValue([]);
    await controller.list('p1');
    expect(svc.list).toHaveBeenCalledWith('p1');
  });

  it('triggerRun passes the user id from req', async () => {
    svc.triggerRun.mockResolvedValue({ id: 'r1' });
    const result = await controller.triggerRun('p1', 't1', { user: { id: 'u1' } } as any);
    expect(svc.triggerRun).toHaveBeenCalledWith('p1', 't1', 'u1');
    expect(result).toEqual({ id: 'r1' });
  });

  it('listRuns parses limit', async () => {
    svc.listRuns.mockResolvedValue({ items: [], nextCursor: null });
    await controller.listRuns('p1', 't1', undefined, '10');
    expect(svc.listRuns).toHaveBeenCalledWith('p1', 't1', undefined, 10);
  });
  // The cancel endpoint is added in Task 9 once service.cancelRun + processor exist.
});
