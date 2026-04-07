'use client';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGitHubInstallations, useGitHubRepositories } from '@/hooks/use-github-app';
import { GitBranch, Search, Lock, Globe, Loader2, Check, RefreshCw } from 'lucide-react';

interface RepoSelectorProps {
  onSelect: (repoUrl: string, defaultBranch: string) => void;
  onSwitchToManual: () => void;
}

export function RepoSelector({ onSelect, onSwitchToManual }: RepoSelectorProps) {
  const { data: installations, isLoading: installationsLoading } = useGitHubInstallations();
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<{ fullName: string; branch: string; isPrivate: boolean } | null>(null);

  const activeInstallationId = selectedInstallation ?? installations?.[0]?.installationId ?? null;
  const { data: repos, isLoading: reposLoading } = useGitHubRepositories(activeInstallationId);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search) return repos;
    const lower = search.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase().includes(lower));
  }, [repos, search]);

  if (installationsLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading GitHub connections...
      </div>
    );
  }

  if (!installations || installations.length === 0) {
    return null;
  }

  if (selectedRepo) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Check className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {selectedRepo.isPrivate ? (
                <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              <p className="truncate text-sm font-medium">{selectedRepo.fullName}</p>
            </div>
            <p className="text-xs text-foreground-muted font-mono">{selectedRepo.branch}</p>
          </div>
          <button
            onClick={() => { setSelectedRepo(null); setSearch(''); }}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-foreground-muted hover:bg-muted hover:text-foreground transition-colors"
          >
            <RefreshCw className="size-3" />
            Change
          </button>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={onSwitchToManual}
        >
          Enter repository URL manually instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {installations.length > 1 && (
        <div className="flex gap-2">
          {installations.map((inst) => (
            <Button
              key={inst.id}
              variant={activeInstallationId === inst.installationId ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedInstallation(inst.installationId)}
            >
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              {inst.accountLogin}
            </Button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
        {reposLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repositories...
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {search ? 'No matching repositories' : 'No repositories found'}
          </div>
        ) : (
          filteredRepos.map((repo) => (
            <button
              key={repo.id}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              onClick={() => {
                setSelectedRepo({ fullName: repo.full_name, branch: repo.default_branch, isPrivate: repo.private });
                onSelect(`https://github.com/${repo.full_name}`, repo.default_branch);
              }}
            >
              <div className="flex items-center gap-2">
                {repo.private ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{repo.full_name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{repo.default_branch}</span>
            </button>
          ))
        )}
      </div>

      <button
        className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={onSwitchToManual}
      >
        Enter repository URL manually instead
      </button>
    </div>
  );
}
