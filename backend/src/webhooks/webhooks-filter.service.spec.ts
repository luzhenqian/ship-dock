import { WebhooksFilterService } from './webhooks-filter.service';

describe('WebhooksFilterService', () => {
  let service: WebhooksFilterService;

  beforeEach(() => {
    service = new WebhooksFilterService();
  });

  describe('matchBranch', () => {
    it('should pass when branchFilters is empty', () => {
      expect(service.matchBranch('feature/x', [])).toEqual({ pass: true });
    });

    it('should pass on exact match', () => {
      expect(service.matchBranch('main', ['main', 'develop'])).toEqual({
        pass: true,
      });
    });

    it('should pass on glob match', () => {
      expect(
        service.matchBranch('release/1.0', ['main', 'release/*']),
      ).toEqual({ pass: true });
    });

    it('should fail when no pattern matches', () => {
      const result = service.matchBranch('feature/x', ['main', 'release/*']);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('feature/x');
    });

    it('should fail when branch is null', () => {
      const result = service.matchBranch(null, ['main']);
      expect(result.pass).toBe(false);
    });
  });

  describe('matchPaths', () => {
    it('should pass when pathFilters is empty', () => {
      expect(service.matchPaths(['anything.ts'], [])).toEqual({ pass: true });
    });

    it('should pass when any file matches any pattern', () => {
      expect(
        service.matchPaths(['src/app.ts', 'README.md'], ['src/**']),
      ).toEqual({ pass: true });
    });

    it('should fail when no file matches', () => {
      const result = service.matchPaths(['docs/readme.md'], ['src/**']);
      expect(result.pass).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should pass when changedFiles is empty (no file info available)', () => {
      expect(service.matchPaths([], ['src/**'])).toEqual({ pass: true });
    });
  });

  describe('matchEvent', () => {
    it('should pass when event is in the list', () => {
      expect(
        service.matchEvent('push', null, ['push', 'release']),
      ).toEqual({ pass: true });
    });

    it('should fail when event is not in the list', () => {
      const result = service.matchEvent('push', null, ['release']);
      expect(result.pass).toBe(false);
    });

    it('should pass pull_request only when merged', () => {
      expect(
        service.matchEvent('pull_request', 'closed', ['pull_request'], true),
      ).toEqual({ pass: true });
      const result = service.matchEvent(
        'pull_request',
        'opened',
        ['pull_request'],
        false,
      );
      expect(result.pass).toBe(false);
    });
  });
});
