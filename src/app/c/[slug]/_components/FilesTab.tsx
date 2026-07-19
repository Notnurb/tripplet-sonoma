'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download, File, FilePlus, FolderUp, Save, Trash2, Upload, X,
} from 'lucide-react';
import { CloudEnvironment, CloudFile } from '@/hooks/useCloudEnvironments';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    formatBytes, fileIcon, buildFileTree, FileTreeNode, readFileContent,
} from '../_lib/cloud-core';

export function FilesTab({ env, onAddFile, onRemoveFile }: {
    env: CloudEnvironment;
    onAddFile: (f: CloudFile) => void;
    onRemoveFile: (name: string) => void;
}) {
    const [selected, setSelected] = useState<CloudFile | null>(env.files[0] ?? null);
    const [editContent, setEditContent] = useState(selected?.content ?? '');
    const [dirty, setDirty] = useState(false);
    const [newFile, setNewFile] = useState({ open: false, name: '', content: '' });
    const [dragOver, setDragOver] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        // Auto-expand all directories on mount
        const dirs = new Set<string>();
        env.files.forEach(f => {
            const parts = f.name.split('/');
            for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        });
        return dirs;
    });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // Set webkitdirectory on folder input after mount
    useEffect(() => {
        folderInputRef.current?.setAttribute('webkitdirectory', '');
        folderInputRef.current?.setAttribute('directory', '');
    }, []);

    useEffect(() => {
        if (selected) {
            const latest = env.files.find(f => f.name === selected.name);
            if (latest) { setSelected(latest); setEditContent(latest.content); setDirty(false); }
        }
     
    }, [env.files]);

    const tree = useMemo(() => buildFileTree(env.files), [env.files]);

    const toggleDir = (path: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
    });

    const handleSelect = (f: CloudFile) => { setSelected(f); setEditContent(f.content); setDirty(false); };

    const handleSave = () => {
        if (!selected) return;
        onAddFile({ ...selected, content: editContent, size: editContent.length, uploadedAt: new Date().toISOString() });
        setDirty(false);
        toast.success(`${selected.name.split('/').pop()} saved`);
    };

    const handleDownload = (f: CloudFile) => {
        const blob = new Blob([f.content], { type: f.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = f.name.split('/').pop() ?? f.name; a.click();
        URL.revokeObjectURL(url);
    };

    const handleCreate = () => {
        if (!newFile.name.trim()) return;
        const f: CloudFile = { name: newFile.name.trim(), content: newFile.content, size: newFile.content.length, type: 'text/plain', uploadedAt: new Date().toISOString() };
        onAddFile(f);
        setSelected(f); setEditContent(f.content);
        setNewFile({ open: false, name: '', content: '' });
        toast.success(`${f.name} created`);
    };

    const handleRename = (oldName: string, newName: string) => {
        const file = env.files.find(f => f.name === oldName);
        if (!file || !newName.trim()) return;
        onRemoveFile(oldName);
        onAddFile({ ...file, name: newName, uploadedAt: new Date().toISOString() });
        if (selected?.name === oldName) { setSelected({ ...file, name: newName }); setEditContent(file.content); }
        toast.success(`Renamed to ${newName.split('/').pop()}`);
    };

    // Upload individual files
    const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        for (const file of files) {
            const content = await readFileContent(file);
            onAddFile({ name: file.name, content, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
        }
        e.target.value = '';
        if (files.length > 0) toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
    };

    // Upload entire folder (webkitdirectory)
    const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;

        // Strip common top-level folder prefix
        const paths = files.map(f => f.webkitRelativePath || f.name);
        const topFolder = paths[0]?.split('/')[0];
        const allSameTop = topFolder && paths.every(p => p.startsWith(topFolder + '/'));
        const stripPrefix = allSameTop ? topFolder + '/' : '';

        for (const file of files) {
            const rawPath = file.webkitRelativePath || file.name;
            const path = stripPrefix ? rawPath.replace(stripPrefix, '') : rawPath;
            if (!path) continue;
            const content = await readFileContent(file);
            onAddFile({ name: path, content, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
        }
        e.target.value = '';

        // Auto-expand new directories
        const newDirs = new Set(expanded);
        files.forEach(f => {
            const p = (f.webkitRelativePath || f.name).replace(stripPrefix, '');
            const parts = p.split('/');
            for (let i = 1; i < parts.length; i++) newDirs.add(parts.slice(0, i).join('/'));
        });
        setExpanded(newDirs);
        toast.success(`${files.length} files uploaded from folder`);
    };

    // Drag-and-drop (supports folders via webkitGetAsEntry)
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);

        const items = e.dataTransfer.items;
        const fileList: { path: string; file: File }[] = [];

        // Read entries recursively (supports folders)
        const readEntry = async (entry: FileSystemEntry, basePath = ''): Promise<void> => {
            const path = basePath ? `${basePath}/${entry.name}` : entry.name;
            if (entry.isFile) {
                const file = await new Promise<File>((resolve) => (entry as FileSystemFileEntry).file(resolve));
                fileList.push({ path, file });
            } else if (entry.isDirectory) {
                const reader = (entry as FileSystemDirectoryEntry).createReader();
                const subEntries = await new Promise<FileSystemEntry[]>((resolve) => {
                    const results: FileSystemEntry[] = [];
                    const readBatch = () => {
                        reader.readEntries((entries) => {
                            if (entries.length === 0) resolve(results);
                            else { results.push(...entries); readBatch(); }
                        });
                    };
                    readBatch();
                });
                for (const sub of subEntries) await readEntry(sub, path);
            }
        };

        // Try webkitGetAsEntry first (supports folders)
        const entries: FileSystemEntry[] = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry?.();
            if (entry) entries.push(entry);
        }

        if (entries.length > 0) {
            for (const entry of entries) await readEntry(entry);
        } else {
            for (const file of Array.from(e.dataTransfer.files)) {
                fileList.push({ path: file.name, file });
            }
        }

        // Strip common top folder if all from same root
        const topFolder = fileList[0]?.path.split('/')[0];
        const allSameTop = fileList.length > 1 && topFolder && fileList.every(f => f.path.startsWith(topFolder + '/'));
        const stripPrefix = allSameTop ? topFolder + '/' : '';

        for (const { path: rawPath, file } of fileList) {
            const path = stripPrefix ? rawPath.replace(stripPrefix, '') : rawPath;
            if (!path) continue;
            const content = await readFileContent(file);
            onAddFile({ name: path, content, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
        }

        if (fileList.length > 0) {
            const newDirs = new Set(expanded);
            fileList.forEach(f => {
                const p = stripPrefix ? f.path.replace(stripPrefix, '') : f.path;
                const parts = p.split('/');
                for (let i = 1; i < parts.length; i++) newDirs.add(parts.slice(0, i).join('/'));
            });
            setExpanded(newDirs);
            toast.success(`${fileList.length} file${fileList.length > 1 ? 's' : ''} uploaded`);
        }
    };

    return (
        <div className={cn('flex min-h-[520px] rounded-xl border overflow-hidden bg-card relative transition-colors',
            dragOver ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border')}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUploadChange} />
            <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderUpload} />

            {/* Drag overlay */}
            <AnimatePresence>
                {dragOver && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-40 bg-emerald-500/10 border-2 border-dashed border-emerald-500/40 rounded-xl flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-2 text-emerald-400">
                            <Upload size={28} />
                            <p className="text-sm font-semibold">Drop files or folders here</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* New file modal */}
            <AnimatePresence>
                {newFile.open && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-30 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">New file</h3>
                                <button onClick={() => setNewFile(n => ({ ...n, open: false }))} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Filename</label>
                                    <input autoFocus value={newFile.name} onChange={e => setNewFile(n => ({ ...n, name: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                        placeholder="src/App.tsx"
                                        className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-mono outline-none focus:border-foreground/40 transition-colors" />
                                    <p className="text-[10px] text-muted-foreground/40 mt-1">Use / for directories, e.g. src/components/Button.tsx</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Content</label>
                                    <textarea value={newFile.content} onChange={e => setNewFile(n => ({ ...n, content: e.target.value }))}
                                        placeholder="Paste or type content here..." rows={7}
                                        className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs font-mono outline-none focus:border-foreground/40 transition-colors resize-none" />
                                </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => setNewFile(n => ({ ...n, open: false }))} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                                <button onClick={handleCreate} disabled={!newFile.name.trim()} className="px-3 py-1.5 rounded-lg text-xs bg-foreground text-background font-semibold disabled:opacity-40 hover:bg-foreground/90 transition-colors">Create file</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* File tree sidebar */}
            <div className="w-56 shrink-0 flex flex-col border-r border-border/60 bg-muted/20">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
                    <div className="flex items-center gap-0.5">
                        <button onClick={() => setNewFile(n => ({ ...n, open: true }))} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="New file"><FilePlus size={12} /></button>
                        <button onClick={() => fileInputRef.current?.click()} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Upload files"><Upload size={12} /></button>
                        <button onClick={() => folderInputRef.current?.click()} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Upload folder"><FolderUp size={12} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                    {env.files.length === 0
                        ? <div className="flex flex-col items-center gap-2 mt-8 px-3 text-center">
                            <Upload size={16} className="text-muted-foreground/30" />
                            <p className="text-[10px] text-muted-foreground/50">Drop files here or use the upload buttons</p>
                        </div>
                        : tree.map(node => (
                            <FileTreeNode key={node.fullPath} node={node} depth={0}
                                selectedFile={selected?.name ?? null} onSelect={handleSelect}
                                expanded={expanded} onToggle={toggleDir} onRename={handleRename} />
                        ))}
                </div>
                <div className="px-3 py-2 border-t border-border/40 text-[9px] text-muted-foreground/40">
                    {env.files.length} file{env.files.length !== 1 ? 's' : ''} · double-click to rename
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col min-w-0">
                {selected ? (
                    <>
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-muted/10">
                            <span className="text-sm mr-0.5">{fileIcon(selected.name)}</span>
                            <span className="text-xs font-medium text-foreground/80 truncate">{selected.name}</span>
                            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 ml-0.5 shrink-0" title="Unsaved" />}
                            <div className="ml-auto flex items-center gap-1 shrink-0">
                                <button onClick={() => handleDownload(selected)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><Download size={11} /> Download</button>
                                <button onClick={() => { onRemoveFile(selected.name); setSelected(env.files.find(f => f.name !== selected.name) ?? null); }}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"><Trash2 size={11} /> Delete</button>
                                {dirty && <button onClick={handleSave} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-foreground text-background font-semibold hover:bg-foreground/90 transition-colors"><Save size={11} /> Save</button>}
                            </div>
                        </div>
                        {selected.content.startsWith('data:image/') ? (
                            <div className="flex-1 flex items-center justify-center bg-background p-4">
                                { }
                                <img src={selected.content} alt={selected.name} className="max-w-full max-h-[400px] rounded-lg border border-border" />
                            </div>
                        ) : (
                            <textarea value={editContent} onChange={e => { setEditContent(e.target.value); setDirty(true); }}
                                spellCheck={false}
                                className="flex-1 resize-none bg-background font-mono text-xs leading-relaxed p-4 outline-none text-foreground/85 min-h-[400px]" />
                        )}
                        <div className="px-4 py-1.5 border-t border-border/40 flex items-center gap-3 text-[10px] text-muted-foreground/50 bg-muted/10">
                            <span>{formatBytes(selected.content.startsWith('data:') ? selected.size : editContent.length)}</span><span>·</span>
                            {!selected.content.startsWith('data:') && <><span>{editContent.split('\n').length} lines</span><span>·</span></>}
                            <span>{selected.name.split('.').pop()?.toUpperCase() ?? 'TEXT'}</span>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
                        <File size={28} />
                        <p className="text-sm">Select a file to edit</p>
                        <p className="text-xs">or drag &amp; drop files and folders here</p>
                        <button onClick={() => setNewFile(n => ({ ...n, open: true }))} className="text-xs text-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">create a new file</button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

