export interface ParsedWebhookEvent {
  branch: string | null;
  commitHash: string | null;
  changedFiles: string[];
  sender: string;
  message: string;
}

export interface WebhookProviderInterface {
  registerWebhook(
    repoUrl: string,
    callbackUrl: string,
    secret: string,
    events: string[],
    token: string,
  ): Promise<{ webhookId: number }>;

  updateWebhook(
    repoUrl: string,
    webhookId: number,
    events: string[],
    token: string,
  ): Promise<void>;

  deleteWebhook(
    repoUrl: string,
    webhookId: number,
    token: string,
  ): Promise<void>;

  verifySignature(payload: Buffer, signature: string, secret: string): boolean;

  parsePayload(event: string, payload: any): ParsedWebhookEvent;
}
