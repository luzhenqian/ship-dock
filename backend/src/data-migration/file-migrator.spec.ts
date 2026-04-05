import { FileMigrator } from './file-migrator';

describe('FileMigrator', () => {
  describe('detectFormat', () => {
    it('detects .sql as plain format', () => {
      expect(FileMigrator.detectFormat('backup.sql')).toBe('plain');
    });

    it('detects .dump as custom format', () => {
      expect(FileMigrator.detectFormat('backup.dump')).toBe('custom');
    });

    it('defaults to plain for unknown extensions', () => {
      expect(FileMigrator.detectFormat('backup.txt')).toBe('plain');
    });
  });

  describe('parseTablesFromSql', () => {
    it('extracts CREATE TABLE names from SQL', () => {
      const sql = `
        CREATE TABLE "public"."users" (id serial PRIMARY KEY);
        CREATE TABLE public.posts (id serial PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS "comments" (id serial);
      `;
      const tables = FileMigrator.parseTablesFromSql(sql);
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'users' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'posts' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'comments' });
    });

    it('extracts table names from INSERT INTO (data-only dumps)', () => {
      const sql = `
        INSERT INTO public.article_chunks VALUES ('id1', 'data');
        INSERT INTO public.users VALUES ('id2', 'name');
        INSERT INTO public.article_chunks VALUES ('id3', 'more data');
      `;
      const tables = FileMigrator.parseTablesFromSql(sql);
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'article_chunks' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'users' });
      expect(tables).toHaveLength(2); // deduped
    });

    it('extracts table names from COPY ... FROM stdin', () => {
      const sql = `
        COPY public.messages (id, content) FROM stdin;
        COPY "public"."users" (id, name) FROM stdin;
      `;
      const tables = FileMigrator.parseTablesFromSql(sql);
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'messages' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'users' });
    });
  });
});
