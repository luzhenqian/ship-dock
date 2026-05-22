'use client';

import { useState, useEffect } from 'react';
import { codeToHtml } from 'shiki';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { useFileContent } from '@/hooks/use-project-files';
import { ArrowLeft, Download, Copy, Check } from 'lucide-react';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', mdx: 'mdx',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  xml: 'xml', svg: 'xml',
  env: 'dotenv', prisma: 'prisma',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  php: 'php', swift: 'swift', dart: 'dart',
  vue: 'vue', svelte: 'svelte',
  nginx: 'nginx', conf: 'nginx',
  lock: 'json', map: 'json',
};

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'exe', 'dll', 'so', 'dylib', 'node',
]);

function getLang(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'dotenv';
  const ext = lower.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'text';
}

function isBinary(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return BINARY_EXTENSIONS.has(ext);
}

function useHighlightedCode(code: string | undefined, lang: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (!code) { setHtml(''); return; }
    let cancelled = false;
    codeToHtml(code, {
      lang,
      theme: 'github-dark',
    }).then((result) => {
      if (!cancelled) setHtml(result);
    }).catch(() => {
      if (!cancelled) {
        codeToHtml(code, { lang: 'text', theme: 'github-dark' }).then((r) => {
          if (!cancelled) setHtml(r);
        });
      }
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  return html;
}

interface FilePreviewProps {
  projectId: string;
  filePath: string;
  fileName: string;
  onBack: () => void;
  onDownload: (path: string) => void;
}

export function FilePreview({ projectId, filePath, fileName, onBack, onDownload }: FilePreviewProps) {
  const binary = isBinary(fileName);
  const { data: content, isLoading, error } = useFileContent(projectId, binary ? null : filePath);
  const lang = getLang(fileName);
  const html = useHighlightedCode(content, lang);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{fileName}</span>
          <span className="text-xs text-foreground-muted font-mono">{lang}</span>
        </div>
        <div className="flex items-center gap-1">
          {!binary && content && (
            <Button size="sm" variant="ghost" onClick={handleCopy} title="Copy content">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onDownload(filePath)} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {binary ? (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary text-sm mb-1">Binary file — cannot preview</p>
          <p className="text-foreground-muted text-xs mb-4">{fileName}</p>
          <Button size="sm" variant="outline" onClick={() => onDownload(filePath)}>
            <Download className="h-4 w-4 mr-1.5" /> Download
          </Button>
        </div>
      ) : isLoading ? (
        <Loading className="py-20" />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary text-sm mb-1">{(error as Error).message}</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => onDownload(filePath)}>
            <Download className="h-4 w-4 mr-1.5" /> Download instead
          </Button>
        </div>
      ) : html ? (
        <div
          className="border rounded-xl overflow-auto text-xs [&_pre]:!bg-transparent [&_pre]:p-4 [&_code]:leading-relaxed"
          style={{ maxHeight: 'calc(100vh - 300px)' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
    </div>
  );
}
