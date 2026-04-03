import { StageExecutor } from './stage-executor';

describe('StageExecutor', () => {
  let executor: StageExecutor;
  beforeEach(() => { executor = new StageExecutor(); });

  it('runs stages sequentially and returns all results', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "one"' },
      { name: 'step2', type: 'command', command: 'echo "two"' },
    ];
    const results = await executor.executeAll(stages, {
      projectDir: '/tmp', onLog: () => {}, onStageStart: () => {}, onStageEnd: () => {},
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('stops on first failure and marks remaining as skipped', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "ok"' },
      { name: 'step2', type: 'command', command: 'exit 1' },
      { name: 'step3', type: 'command', command: 'echo "never"' },
    ];
    const results = await executor.executeAll(stages, {
      projectDir: '/tmp', onLog: () => {}, onStageStart: () => {}, onStageEnd: () => {},
    });
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].skipped).toBe(true);
  });

  it('can resume from a specific stage index', async () => {
    const stages = [
      { name: 'step1', type: 'command', command: 'echo "skip me"' },
      { name: 'step2', type: 'command', command: 'echo "run me"' },
    ];
    const logs: string[] = [];
    const results = await executor.executeAll(stages, {
      projectDir: '/tmp', onLog: (line) => logs.push(line), onStageStart: () => {}, onStageEnd: () => {},
      resumeFromIndex: 1,
    });
    expect(results[0].skipped).toBe(true);
    expect(results[1].success).toBe(true);
    expect(logs.some((l) => l.includes('run me'))).toBe(true);
    expect(logs.some((l) => l.includes('skip me'))).toBe(false);
  });
});
