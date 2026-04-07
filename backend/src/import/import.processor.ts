import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('import')
export class ImportProcessor extends WorkerHost {
  async process(_job: Job): Promise<void> {
    throw new Error('Not implemented');
  }
}
