import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { GitHubAppWebhookController } from './github-app-webhook.controller';
import { GitHubAppService } from './github-app.service';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('GitHubAppWebhookController', () => {
  let controller: GitHubAppWebhookController;
  let githubAppService: GitHubAppService;
  let webhooksService: WebhooksService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot()],
      controllers: [GitHubAppWebhookController],
      providers: [
        {
          provide: GitHubAppService,
          useValue: {
            handleInstallationDeleted: jest.fn(),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            processAppWebhookEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(GitHubAppWebhookController);
    githubAppService = module.get(GitHubAppService);
    webhooksService = module.get(WebhooksService);
  });

  it('should handle push events by routing to processAppWebhookEvent', async () => {
    const req = {
      headers: {
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'push',
      },
      body: { repository: { full_name: 'octocat/hello-world' } },
    };

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(webhooksService.processAppWebhookEvent).toHaveBeenCalledWith({
      repoFullName: 'octocat/hello-world',
      deliveryId: 'delivery-123',
      event: 'push',
      headers: req.headers,
      payload: req.body,
    });
  });

  it('should handle installation.deleted events', async () => {
    const req = {
      headers: {
        'x-github-delivery': 'delivery-456',
        'x-github-event': 'installation',
      },
      body: { action: 'deleted', installation: { id: 99 } },
    };

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(githubAppService.handleInstallationDeleted).toHaveBeenCalledWith(99);
  });

  it('should return 400 for missing headers', async () => {
    const req = { headers: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
