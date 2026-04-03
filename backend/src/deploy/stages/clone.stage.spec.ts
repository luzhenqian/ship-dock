import { CloneStage } from './clone.stage';

describe('CloneStage', () => {
  let stage: CloneStage;
  beforeEach(() => { stage = new CloneStage(); });

  it('generates a git clone command for first deploy', () => {
    const cmd = stage.buildCommand({ repoUrl: 'https://github.com/user/repo.git', branch: 'main', projectDir: '/var/www/my-app', isFirstDeploy: true });
    expect(cmd).toContain('git clone');
    expect(cmd).toContain('--branch main');
    expect(cmd).toContain('https://github.com/user/repo.git');
  });

  it('generates a git pull command for subsequent deploys', () => {
    const cmd = stage.buildCommand({ repoUrl: 'https://github.com/user/repo.git', branch: 'main', projectDir: '/var/www/my-app', isFirstDeploy: false });
    expect(cmd).toContain('git fetch');
    expect(cmd).toContain('git reset --hard origin/main');
  });
});
