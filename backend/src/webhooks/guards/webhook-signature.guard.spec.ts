import { ExecutionContext } from '@nestjs/common';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { createHmac } from 'crypto';
import { Test } from '@nestjs/testing';

describe('WebhookSignatureGuard', () => {
  let guard: WebhookSignatureGuard;
  const mockPrisma = { webhookConfig: { findUnique: jest.fn() } };
  const mockEncryption = { decrypt: jest.fn((v: string) => v) };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebhookSignatureGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();
    guard = module.get(WebhookSignatureGuard);
    jest.clearAllMocks();
  });

  function mockContext(projectId: string, signature: string, body: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { projectId },
          headers: { 'x-hub-signature-256': signature },
          rawBody: Buffer.from(body),
        }),
      }),
    } as any;
  }

  it('should allow request with valid signature', async () => {
    const secret = 'my-secret';
    const body = '{"ref":"refs/heads/main"}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret, enabled: true });

    const result = await guard.canActivate(mockContext('proj-1', sig, body));
    expect(result).toBe(true);
  });

  it('should reject request with invalid signature', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret: 'real-secret', enabled: true });

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=wrong', '{}'))).rejects.toThrow();
  });

  it('should reject when no webhook config exists', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=x', '{}'))).rejects.toThrow();
  });

  it('should reject when webhook is disabled', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret: 's', enabled: false });

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=x', '{}'))).rejects.toThrow();
  });
});
