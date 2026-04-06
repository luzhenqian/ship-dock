import { Test, TestingModule } from '@nestjs/testing';
import { ClarityAdminService } from './clarity-admin.service';

describe('ClarityAdminService', () => {
  let service: ClarityAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClarityAdminService],
    }).compile();

    service = module.get(ClarityAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
