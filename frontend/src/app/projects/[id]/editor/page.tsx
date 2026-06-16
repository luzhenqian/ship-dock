'use client';
import { use, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { File as FileIcon, FolderOpen, Plus, Trash2, Loader2, Globe, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useProject } from '@/hooks/use-projects';
import { useStaticFiles, useUpsertStaticFile, useDeleteStaticFile } from '@/hooks/use-static-files';
import { api } from '@/lib/api';

function getLanguageExtension(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return html();
  if (ext === 'css') return css();
  if (ext === 'js' || ext === 'mjs' || ext === 'ts') return javascript({ typescript: ext === 'ts' });
  return [];
}

type SaveStatus = 'saved' | 'saving' | 'unsaved';

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  const { data: project } = useProject(projectId);
  const { data: files = [], isLoading } = useStaticFiles(projectId);
  const upsert = useUpsertStaticFile(projectId);
  const deleteFile = useDeleteStaticFile(projectId);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [publishing, setPublishing] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upsertRef = useRef(upsert);
  useEffect(() => { upsertRef.current = upsert; });

  // Select first file on load
  useEffect(() => {
    if (files.length > 0 && !selectedPath) {
      const first = files[0];
      setSelectedPath(first.path);
      setEditorContent(first.content);
    }
  }, [files, selectedPath]);

  // Cleanup autosave timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  // Sync content when switching files
  function selectFile(path: string) {
    const file = files.find((f) => f.path === path);
    if (!file) return;
    setSelectedPath(path);
    setEditorContent(file.content);
    setSaveStatus('saved');
  }

  const handleChange = useCallback(
    (value: string) => {
      setEditorContent(value);
      setSaveStatus('saving');
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(async () => {
        if (!selectedPath) return;
        try {
          await upsertRef.current.mutateAsync({ path: selectedPath, content: value });
          setSaveStatus('saved');
        } catch {
          setSaveStatus('unsaved');
        }
      }, 500);
    },
    [selectedPath],
  );

  async function handleAddFile() {
    const name = newFileName.trim();
    if (!name) return;
    try {
      await upsert.mutateAsync({ path: name, content: '' });
      setNewFileName('');
      setShowNewFile(false);
      setSelectedPath(name);
      setEditorContent('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create file');
    }
  }

  async function handleDeleteFile(path: string) {
    try {
      await deleteFile.mutateAsync(path);
      if (selectedPath === path) {
        setSelectedPath(null);
        setEditorContent('');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    }
  }

  async function handlePublish() {
    if (files.length === 0) {
      toast.error('No files to publish');
      return;
    }
    setPublishing(true);
    try {
      await api(`/projects/${projectId}/deploy`, { method: 'POST' });
      toast.success('Deployment started');
      router.push(`/projects/${projectId}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setPublishing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="text-foreground-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium">{project?.name ?? 'Editor'}</span>
          <span
            className={`text-xs ${
              saveStatus === 'saved'
                ? 'text-foreground-muted'
                : saveStatus === 'saving'
                  ? 'text-foreground-muted animate-pulse'
                  : 'text-destructive'
            }`}
          >
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved'}
          </span>
        </div>
        <Button size="sm" onClick={handlePublish} disabled={publishing || files.length === 0}>
          {publishing ? (
            <>
              <Loader2 className="size-3 animate-spin mr-1" />
              Publishing…
            </>
          ) : (
            <>
              <Globe className="size-3 mr-1" />
              Publish
            </>
          )}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-foreground-muted uppercase tracking-wider">Files</span>
            <button
              onClick={() => setShowNewFile(true)}
              className="text-foreground-muted hover:text-foreground transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {showNewFile && (
            <div className="px-2 py-1.5 border-b border-border">
              <Input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFile();
                  if (e.key === 'Escape') {
                    setShowNewFile(false);
                    setNewFileName('');
                  }
                }}
                placeholder="filename.html"
                className="h-6 text-xs"
              />
            </div>
          )}
          <ul className="py-1">
            {files.map((f) => (
              <li
                key={f.path}
                className={`group flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                  selectedPath === f.path
                    ? 'bg-muted text-foreground'
                    : 'text-foreground-muted hover:text-foreground hover:bg-muted/50'
                }`}
                onClick={() => selectFile(f.path)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileIcon className="size-3 flex-shrink-0" />
                  <span className="truncate text-xs">{f.path}</span>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFile(f.path);
                  }}
                >
                  <Trash2 className="size-3 text-foreground-muted hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
          {files.length === 0 && (
            <div className="flex flex-col items-center py-8 px-4 text-center">
              <FolderOpen className="size-5 text-foreground-muted mb-2" />
              <p className="text-xs text-foreground-muted">No files yet</p>
              <button className="text-xs text-foreground underline mt-1" onClick={() => setShowNewFile(true)}>
                Add a file
              </button>
            </div>
          )}
        </div>

        {/* Editor pane */}
        <div className="flex-1 overflow-hidden">
          {selectedPath ? (
            <CodeMirror
              value={editorContent}
              onChange={handleChange}
              extensions={[getLanguageExtension(selectedPath), EditorView.lineWrapping]}
              theme={resolvedTheme === 'dark' ? oneDark : 'light'}
              height="100%"
              className="h-full text-sm"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
              Select a file to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
