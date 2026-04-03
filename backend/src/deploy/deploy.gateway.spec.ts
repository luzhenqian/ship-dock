import { Test } from '@nestjs/testing';
import { DeployGateway } from './deploy.gateway';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('DeployGateway', () => {
  let gateway: DeployGateway;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DeployGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', role: 'ADMIN' }) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'secret' } },
      ],
    }).compile();
    gateway = module.get(DeployGateway);
  });

  it('is defined', () => { expect(gateway).toBeDefined(); });
  it('has emitToDeployment method', () => { expect(typeof gateway.emitToDeployment).toBe('function'); });
  it('has emitToDashboard method', () => { expect(typeof gateway.emitToDashboard).toBe('function'); });
});
