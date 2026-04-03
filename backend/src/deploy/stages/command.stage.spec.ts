import { CommandStage } from './command.stage';

describe('CommandStage', () => {
  it('executes a shell command and captures output', async () => {
    const stage = new CommandStage();
    const logs: string[] = [];
    const result = await stage.execute(
      { name: 'test', type: 'command', command: 'echo "hello world"' },
      { projectDir: '/tmp', onLog: (line) => logs.push(line) },
    );
    expect(result.success).toBe(true);
    expect(logs.some((l) => l.includes('hello world'))).toBe(true);
  });

  it('returns failure for a bad command', async () => {
    const stage = new CommandStage();
    const result = await stage.execute(
      { name: 'test', type: 'command', command: 'exit 1' },
      { projectDir: '/tmp', onLog: () => {} },
    );
    expect(result.success).toBe(false);
  });
});
