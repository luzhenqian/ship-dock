import { CommandStage, StageConfig, StageResult } from './command.stage';

export interface ExecutorContext {
  projectDir: string;
  onLog: (line: string) => void;
  onStageStart: (index: number, stage: StageConfig) => void;
  onStageEnd: (index: number, stage: StageConfig, result: StageResult & { skipped?: boolean }) => void;
  resumeFromIndex?: number;
}

export interface ExecutorStageResult extends StageResult {
  skipped?: boolean;
  stageName: string;
}

export class StageExecutor {
  private commandStage = new CommandStage();

  async executeAll(stages: StageConfig[], ctx: ExecutorContext): Promise<ExecutorStageResult[]> {
    const results: ExecutorStageResult[] = [];
    let failed = false;
    const resumeFrom = ctx.resumeFromIndex ?? 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      if (i < resumeFrom || failed) {
        results.push({ success: false, skipped: true, stageName: stage.name });
        continue;
      }

      ctx.onStageStart(i, stage);

      const result = await this.executeStage(stage, { projectDir: ctx.projectDir, onLog: ctx.onLog });
      const fullResult = { ...result, stageName: stage.name };
      results.push(fullResult);
      ctx.onStageEnd(i, stage, fullResult);

      if (!result.success) failed = true;
    }

    return results;
  }

  private async executeStage(stage: StageConfig, ctx: { projectDir: string; onLog: (line: string) => void }): Promise<StageResult> {
    if (stage.type === 'command') {
      return this.commandStage.execute(stage, ctx);
    }
    ctx.onLog(`[builtin] Executing ${stage.name} stage`);
    return { success: true };
  }
}
