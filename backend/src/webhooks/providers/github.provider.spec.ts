import { GitHubProvider } from './github.provider';

describe('GitHubProvider', () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    provider = new GitHubProvider();
  });

  describe('verifySignature', () => {
    it('should return true for valid signature', () => {
      const secret = 'test-secret';
      const payload = Buffer.from('{"action":"push"}');
      const crypto = require('crypto');
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(provider.verifySignature(payload, expected, secret)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const payload = Buffer.from('{"action":"push"}');
      expect(provider.verifySignature(payload, 'sha256=invalid', 'secret')).toBe(
        false,
      );
    });
  });

  describe('parsePayload', () => {
    it('should parse push event', () => {
      const payload = {
        ref: 'refs/heads/main',
        after: 'abc123',
        pusher: { name: 'user1' },
        head_commit: { message: 'fix: bug' },
        commits: [
          { added: ['new.ts'], modified: ['old.ts'], removed: ['gone.ts'] },
        ],
      };
      const result = provider.parsePayload('push', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: 'abc123',
        changedFiles: ['new.ts', 'old.ts', 'gone.ts'],
        sender: 'user1',
        message: 'fix: bug',
      });
    });

    it('should parse pull_request event', () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: true,
          base: { ref: 'main' },
          merge_commit_sha: 'def456',
          title: 'feat: new feature',
          changed_files: 3,
        },
        sender: { login: 'user2' },
      };
      const result = provider.parsePayload('pull_request', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: 'def456',
        changedFiles: [],
        sender: 'user2',
        message: 'feat: new feature',
      });
    });

    it('should parse release event', () => {
      const payload = {
        release: {
          target_commitish: 'main',
          tag_name: 'v1.0.0',
          name: 'Release 1.0',
        },
        sender: { login: 'user3' },
      };
      const result = provider.parsePayload('release', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: null,
        changedFiles: [],
        sender: 'user3',
        message: 'Release 1.0',
      });
    });
  });

  describe('parseRepoUrl', () => {
    it('should extract owner and repo from HTTPS URL', () => {
      expect(
        (provider as any).parseRepoUrl('https://github.com/owner/repo'),
      ).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should extract owner and repo from URL with .git suffix', () => {
      expect(
        (provider as any).parseRepoUrl('https://github.com/owner/repo.git'),
      ).toEqual({ owner: 'owner', repo: 'repo' });
    });
  });
});
