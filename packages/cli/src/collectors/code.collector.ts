import * as path from 'path';
import { execShell } from '../utils';

export interface CodeCollectResult {
  type: 'git' | 'archive';
  /** For git: the remote URL */
  gitRemote?: string;
  /** For git: the commit hash */
  gitCommit?: string;
  /** For archive: path to the tar.gz */
  archivePath?: string;
  sizeBytes?: number;
  error?: string;
}

const EXCLUDE_PATTERNS = [
  'node_modules',
  '.env',
  '.env.*',
  'dist',
  'build',
  '.next',
  '.git',
  '__pycache__',
  '*.pyc',
  '.venv',
  'venv',
  'vendor',
  '.cache',
  'coverage',
  '.nyc_output',
  'tmp',
];

/**
 * Collect source code for a project.
 * If the project has a git remote, just record the remote + commit.
 * Otherwise, create a tar.gz archive of the directory.
 */
export async function collectCode(
  directory: string,
  gitRemote: string | undefined,
  gitCommit: string | undefined,
  outputDir: string,
): Promise<CodeCollectResult> {
  // If we have a git remote, just record it — no need to archive
  if (gitRemote && gitCommit) {
    return {
      type: 'git',
      gitRemote,
      gitCommit,
    };
  }

  // No git remote — archive the directory
  const archiveName = 'source.tar.gz';
  const archivePath = path.join(outputDir, archiveName);

  const excludeFlags = EXCLUDE_PATTERNS.map(
    (p) => `--exclude='${p}'`,
  ).join(' ');

  const cmd = `tar czf '${archivePath}' ${excludeFlags} -C '${path.dirname(directory)}' '${path.basename(directory)}'`;

  const result = await execShell(cmd, { timeout: 120_000 });
  if (result === null) {
    return { type: 'archive', error: 'Failed to create source archive' };
  }

  const sizeResult = await execShell(
    `stat -c%s '${archivePath}' 2>/dev/null || stat -f%z '${archivePath}' 2>/dev/null`,
  );
  const sizeBytes = sizeResult ? parseInt(sizeResult.trim(), 10) || undefined : undefined;

  return { type: 'archive', archivePath, sizeBytes };
}
