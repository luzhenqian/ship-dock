import { RemoteMigrator } from './remote-migrator';

describe('RemoteMigrator', () => {
  describe('buildConnectionString', () => {
    it('builds a valid connection string', () => {
      const result = RemoteMigrator.buildConnectionString({
        host: 'localhost', port: 5432, username: 'user', password: 'pass', database: 'mydb',
      });
      expect(result).toBe('postgresql://user:pass@localhost:5432/mydb');
    });

    it('encodes special characters in password', () => {
      const result = RemoteMigrator.buildConnectionString({
        host: 'localhost', port: 5432, username: 'user', password: 'p@ss/word', database: 'mydb',
      });
      expect(result).toContain(encodeURIComponent('p@ss/word'));
    });
  });

  describe('formatBytes', () => {
    it('converts bytes to human readable', () => {
      expect(RemoteMigrator.formatBytes(1024)).toBe('1.0 KB');
      expect(RemoteMigrator.formatBytes(1048576)).toBe('1.0 MB');
      expect(RemoteMigrator.formatBytes(0)).toBe('0 B');
    });
  });
});
