import { Test } from '@nestjs/testing';
import { UploadController } from './upload.controller';
import { ConfigService } from '@nestjs/config';
import { DeployService } from '../deploy/deploy.service';

describe('UploadController', () => {
  let controller: UploadController;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: ConfigService, useValue: { get: () => '/tmp/test-projects' } },
        { provide: DeployService, useValue: { trigger: jest.fn().mockResolvedValue({ id: 'dep-1' }) } },
      ],
    }).compile();
    controller = module.get(UploadController);
  });
  it('is defined', () => { expect(controller).toBeDefined(); });
});
