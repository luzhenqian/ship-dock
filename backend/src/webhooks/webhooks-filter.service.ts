import { Injectable } from '@nestjs/common';
import { minimatch } from 'minimatch';

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

@Injectable()
export class WebhooksFilterService {
  matchBranch(branch: string | null, filters: string[]): FilterResult {
    if (filters.length === 0) return { pass: true };
    if (!branch) return { pass: false, reason: 'No branch in payload' };
    const matched = filters.some((pattern) => minimatch(branch, pattern));
    return matched
      ? { pass: true }
      : {
          pass: false,
          reason: `Branch "${branch}" does not match filters [${filters.join(', ')}]`,
        };
  }

  matchPaths(changedFiles: string[], filters: string[]): FilterResult {
    if (filters.length === 0) return { pass: true };
    if (changedFiles.length === 0) return { pass: true };
    const matched = changedFiles.some((file) =>
      filters.some((pattern) => minimatch(file, pattern)),
    );
    return matched
      ? { pass: true }
      : {
          pass: false,
          reason: `No changed files match path filters [${filters.join(', ')}]`,
        };
  }

  matchEvent(
    event: string,
    action: string | null,
    allowedEvents: string[],
    merged?: boolean,
  ): FilterResult {
    if (!allowedEvents.includes(event)) {
      return {
        pass: false,
        reason: `Event "${event}" not in allowed events [${allowedEvents.join(', ')}]`,
      };
    }
    if (event === 'pull_request' && !(action === 'closed' && merged)) {
      return {
        pass: false,
        reason: `pull_request event not a merge (action=${action}, merged=${merged})`,
      };
    }
    return { pass: true };
  }
}
