export interface DbExtensionEntry {
  id: string;
  name: string;
  description: string;
  extension: string;
}

export const DB_EXTENSIONS_WHITELIST: DbExtensionEntry[] = [
  { id: 'pgvector', name: 'pgvector', description: 'Vector similarity search (AI/embeddings)', extension: 'vector' },
  { id: 'postgis', name: 'PostGIS', description: 'Geospatial data & queries', extension: 'postgis' },
  { id: 'pg_trgm', name: 'pg_trgm', description: 'Trigram-based fuzzy text search', extension: 'pg_trgm' },
  { id: 'hstore', name: 'hstore', description: 'Key-value pairs in a single column', extension: 'hstore' },
  { id: 'ltree', name: 'ltree', description: 'Hierarchical tree-like data', extension: 'ltree' },
  { id: 'citext', name: 'citext', description: 'Case-insensitive text type', extension: 'citext' },
  { id: 'tablefunc', name: 'tablefunc', description: 'Crosstab / pivot queries', extension: 'tablefunc' },
  { id: 'pgcrypto', name: 'pgcrypto', description: 'Cryptographic functions', extension: 'pgcrypto' },
  { id: 'unaccent', name: 'unaccent', description: 'Remove accents from text', extension: 'unaccent' },
];

export const DB_EXTENSIONS_IDS = new Set(DB_EXTENSIONS_WHITELIST.map((e) => e.id));
