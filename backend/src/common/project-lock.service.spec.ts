import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProjectLockService } from './project-lock.service';

describe('ProjectLockService', () => {
  let service: ProjectLockService;
  let redisMock: any;

  beforeEach(async () => {
    redisMock = {
      set: jest.fn(),
      eval: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProjectLockService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get(ProjectLockService);
    (service as any).client = redisMock;
  });

  it('acquire returns a token when SET NX succeeds', async () => {
    redisMock.set.mockResolvedValue('OK');
    const token = await service.acquire('p1');
    expect(token).toBeTruthy();
    expect(redisMock.set).toHaveBeenCalledWith(
      'project-lock:p1', expect.any(String), 'PX', expect.any(Number), 'NX',
    );
  });

  it('acquire returns null when lock is held', async () => {
    redisMock.set.mockResolvedValue(null);
    const token = await service.acquire('p1');
    expect(token).toBeNull();
  });

  it('release runs the compare-and-delete script', async () => {
    await service.release('p1', 'tok-1');
    expect(redisMock.eval).toHaveBeenCalled();
    const args = redisMock.eval.mock.calls[0];
    expect(args[2]).toBe('project-lock:p1');
    expect(args[3]).toBe('tok-1');
  });

  it('withLock acquires, runs fn, and releases even on throw', async () => {
    redisMock.set.mockResolvedValue('OK');
    await expect(
      service.withLock('p1', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(redisMock.eval).toHaveBeenCalled();
  });

  it('withLock retries when lock is held, then succeeds', async () => {
    redisMock.set
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OK');
    const fn = jest.fn().mockResolvedValue('done');
    const result = await service.withLock('p1', fn, { retryDelayMs: 1, maxWaitMs: 1000 });
    expect(result).toBe('done');
    expect(redisMock.set).toHaveBeenCalledTimes(3);
  });
});
