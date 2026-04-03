import { SslStage } from './ssl.stage';

describe('SslStage', () => {
  let stage: SslStage;
  beforeEach(() => { stage = new SslStage(); });

  it('builds certbot command for a domain', () => {
    const cmd = stage.buildCommand('app.example.com');
    expect(cmd).toContain('certbot certonly');
    expect(cmd).toContain('--nginx');
    expect(cmd).toContain('-d app.example.com');
    expect(cmd).toContain('--non-interactive');
    expect(cmd).toContain('--agree-tos');
  });
});
