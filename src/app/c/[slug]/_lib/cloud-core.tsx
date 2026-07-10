'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CloudFile } from '@/hooks/useCloudEnvironments';

// ─── Utils ───────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTime(d: Date): string {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const FILE_ICONS: Record<string, string> = {
    html: '🌐', css: '🎨', js: '⚡', ts: '🔷', tsx: '⚛️', jsx: '⚛️',
    json: '📋', md: '📝', txt: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
    svg: '🖼️', pdf: '📑', zip: '📦', py: '🐍', sh: '⚙️', yaml: '⚙️', yml: '⚙️',
    env: '🔑', toml: '⚙️', xml: '📋', rs: '🦀', go: '🐹', rb: '💎', php: '🐘',
    purs: '🟣', lock: '🔒', mjs: '⚡', cjs: '⚡', map: '🗺️', woff: '🔤', woff2: '🔤',
    ttf: '🔤', eot: '🔤', ico: '🖼️', gif: '🖼️', webp: '🖼️',
};

export function fileIcon(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return FILE_ICONS[ext] ?? '📄';
}

// ─── Asset resolver ──────────────────────────────────────────────────────────

export function resolveAssets(html: string, files: CloudFile[]): string {
    let resolved = html;
    let needsBabel = false;
    let needsReact = false;
    let needsTailwind = false;

    const findFile = (ref: string) =>
        files.find(f => f.name === ref || f.name === ref.replace(/^\.\//, ''));

    // Detect Tailwind usage in HTML classes or CSS @tailwind directives
    if (/<[^>]+class=["'][^"']*(?:flex |grid |p-|m-|text-|bg-|rounded|border-|shadow|w-|h-|gap-|items-|justify-)/i.test(html)) {
        needsTailwind = true;
    }
    files.forEach(f => {
        if (f.name.endsWith('.css') && f.content.includes('@tailwind')) needsTailwind = true;
    });

    // Inline CSS: <link rel="stylesheet" href="...">
    resolved = resolved.replace(
        /<link\b[^>]*?href=["']([^"']+?)["'][^>]*?>/gi,
        (match, href) => {
            if (!match.toLowerCase().includes('stylesheet')) return match;
            const file = findFile(href);
            if (!file) return match;
            // Skip inlining if it's a Tailwind directive file — CDN handles it
            if (file.content.includes('@tailwind')) { needsTailwind = true; return ''; }
            return `<style>\n${file.content}\n</style>`;
        }
    );

    // Inline scripts: <script src="..."></script>
    resolved = resolved.replace(
        /<script\b[^>]*?src=["']([^"']+?)["'][^>]*?><\/script>/gi,
        (match, src) => {
            if (src.startsWith('http') || src.startsWith('//')) return match;
            const file = findFile(src);
            if (!file) return match;

            const ext = src.split('.').pop()?.toLowerCase();
            const isTS = ext === 'ts' || ext === 'tsx';
            const isJSX = ext === 'jsx' || ext === 'tsx';

            if (isTS || isJSX) {
                needsBabel = true;
                if (isJSX || file.content.includes('React') || file.content.includes('createRoot') || file.content.includes('jsx')) needsReact = true;
                const presets = [isTS ? 'typescript' : null, isJSX ? 'react' : null].filter(Boolean).join(',');
                return `<script type="text/babel" data-presets="${presets}">\n${file.content}\n</script>`;
            }

            return `<script>\n${file.content}\n</script>`;
        }
    );

    // Resolve data URI references for binary files (images, fonts, etc.)
    files.forEach(file => {
        if (file.content.startsWith('data:')) {
            const escaped = file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            resolved = resolved.replace(
                new RegExp(`(["'(])(\\.?\\/?)${escaped}(["')])`, 'g'),
                `$1${file.content}$3`
            );
        }
    });

    // Inject CDN scripts for Tailwind, React, Babel (TypeScript/JSX transpilation)
    const injections: string[] = [];
    if (needsTailwind) injections.push('<script src="https://cdn.tailwindcss.com"></script>');
    if (needsReact) {
        injections.push('<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>');
        injections.push('<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>');
    }
    if (needsBabel) injections.push('<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>');

    if (injections.length > 0) {
        const injection = injections.join('\n');
        if (resolved.includes('</head>')) {
            resolved = resolved.replace('</head>', `${injection}\n</head>`);
        } else if (resolved.includes('<body')) {
            resolved = resolved.replace(/<body[^>]*>/, `$&\n${injection}`);
        } else {
            resolved = `${injection}\n${resolved}`;
        }
    }

    return resolved;
}

// ─── File tree helpers ───────────────────────────────────────────────────────

export interface TreeNode {
    name: string;
    fullPath: string;
    isDir: boolean;
    children: TreeNode[];
    file?: CloudFile;
}

export function buildFileTree(files: CloudFile[]): TreeNode[] {
    const root: TreeNode[] = [];
    for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
        const parts = file.name.split('/');
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const fullPath = parts.slice(0, i + 1).join('/');
            let node = current.find(n => n.name === parts[i] && n.isDir === !isLast);
            if (!node) {
                node = { name: parts[i], fullPath, isDir: !isLast, children: [], ...(isLast ? { file } : {}) };
                current.push(node);
            }
            if (!isLast) current = node.children;
        }
    }
    const sort = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
        nodes.forEach(n => sort(n.children));
    };
    sort(root);
    return root;
}

export function FileTreeNode({ node, depth, selectedFile, onSelect, expanded, onToggle, onRename }: {
    node: TreeNode; depth: number; selectedFile: string | null;
    onSelect: (f: CloudFile) => void; expanded: Set<string>;
    onToggle: (path: string) => void; onRename: (oldName: string, newName: string) => void;
}) {
    const [renaming, setRenaming] = useState(false);
    const [renameTo, setRenameTo] = useState(node.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (renaming) inputRef.current?.select(); }, [renaming]);

    const isExpanded = expanded.has(node.fullPath);
    const isSelected = !node.isDir && selectedFile === node.fullPath;

    const handleRenameSubmit = () => {
        if (!renameTo.trim() || renameTo === node.name) { setRenaming(false); return; }
        const parts = node.fullPath.split('/');
        parts[parts.length - 1] = renameTo.trim();
        onRename(node.fullPath, parts.join('/'));
        setRenaming(false);
    };

    return (
        <>
            <button
                onClick={() => node.isDir ? onToggle(node.fullPath) : (node.file && onSelect(node.file))}
                onDoubleClick={(e) => { if (!node.isDir) { e.preventDefault(); setRenaming(true); setRenameTo(node.name); } }}
                className={cn(
                    'w-full flex items-center gap-1.5 py-1 text-left text-xs transition-colors',
                    isSelected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: 8 }}
            >
                {node.isDir && <ChevronRight size={10} className={cn('shrink-0 transition-transform duration-150', isExpanded && 'rotate-90')} />}
                <span className="text-sm shrink-0">{node.isDir ? (isExpanded ? '📂' : '📁') : fileIcon(node.name)}</span>
                {renaming ? (
                    <input
                        ref={inputRef}
                        value={renameTo}
                        onChange={e => setRenameTo(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(false); }}
                        className="flex-1 bg-background border border-foreground/30 rounded px-1 py-0 text-xs outline-none min-w-0"
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <span className="truncate flex-1">{node.name}</span>
                )}
            </button>
            {node.isDir && isExpanded && node.children.map(child => (
                <FileTreeNode key={child.fullPath} node={child} depth={depth + 1}
                    selectedFile={selectedFile} onSelect={onSelect} expanded={expanded}
                    onToggle={onToggle} onRename={onRename} />
            ))}
        </>
    );
}

// ─── Read file as text or data URI ───────────────────────────────────────────

export async function readFileContent(file: File): Promise<string> {
    const isBinary = file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')
        || file.type === 'application/pdf' || file.type === 'application/octet-stream'
        || file.type.startsWith('font/') || /\.(woff2?|ttf|eot|ico)$/i.test(file.name);
    if (isBinary) {
        return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
        });
    }
    return file.text().catch(() => '');
}

// ─── Generate index.html for Node.js projects ───────────────────────────────

export function generateProjectHtml(pkgJson: Record<string, unknown>, files: CloudFile[]): string {
    const deps: Record<string, string> = { ...(pkgJson.dependencies as Record<string, string> ?? {}), ...(pkgJson.devDependencies as Record<string, string> ?? {}) };
    const hasReact = !!deps['react'];
    const hasTailwind = !!deps['tailwindcss'];

    const entryNames = ['src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js', 'src/main.tsx', 'src/main.ts', 'src/App.tsx', 'index.tsx', 'index.ts', 'index.js'];
    const entry = entryNames.find(n => files.some(f => f.name === n));
    const ext = entry?.split('.').pop() ?? 'js';
    const isTS = ext === 'ts' || ext === 'tsx';
    const isJSX = ext === 'jsx' || ext === 'tsx';
    const presets = [isTS ? 'typescript' : null, isJSX || hasReact ? 'react' : null].filter(Boolean).join(',');

    let h = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n';
    h += `  <title>${(pkgJson.name as string) || 'Project'}</title>\n`;
    if (hasTailwind) h += '  <script src="https://cdn.tailwindcss.com"><\/script>\n';
    if (hasReact) {
        h += '  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"><\/script>\n';
        h += '  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>\n';
    }
    if (isTS || isJSX || hasReact) h += '  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>\n';
    h += '</head>\n<body>\n';
    if (hasReact) h += '  <div id="root"></div>\n';
    if (entry) h += `  <script type="text/babel" data-presets="${presets}" src="${entry}"><\/script>\n`;
    h += '</body>\n</html>';
    return h;
}

// ─── Log generator ───────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export interface LogLine { id: number; ts: Date; level: LogLevel; msg: string; }

let logIdCounter = 0;
export function makeLog(level: LogLevel, msg: string): LogLine {
    return { id: ++logIdCounter, ts: new Date(), level, msg };
}

export const BOOT_LOGS = (name: string): LogLine[] => [
    makeLog('info',    `Starting server process for "${name}"...`),
    makeLog('info',    'Loading environment configuration'),
    makeLog('success', 'Configuration loaded — 0 errors'),
    makeLog('info',    'Binding to 0.0.0.0:3000'),
    makeLog('success', 'Server online — ready to accept connections'),
    makeLog('info',    'Health check passed'),
];

export const FAKE_HTTP_MSGS = [
    (slug: string) => `GET /c/${slug}/ 200 OK — 42ms`,
    (slug: string) => `GET /c/${slug}/assets/style.css 200 OK — 12ms`,
    (_: string) => 'Health check passed',
    (slug: string) => `GET /c/${slug}/ 304 Not Modified — 8ms`,
    (_: string) => 'Memory usage: 38MB / 256MB',
    (_: string) => 'GC pause: 1.2ms',
    (slug: string) => `POST /c/${slug}/api 200 OK — 88ms`,
    (_: string) => 'Keepalive ping received',
    (_: string) => 'Static asset served from cache',
    (slug: string) => `HEAD /c/${slug}/ 200 OK — 3ms`,
];

// ─── Camera System HTML template ─────────────────────────────────────────────

export const CAMERA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Camera System</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #050505;
      color: #fff;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: #555; }
    #wrap {
      position: relative;
      width: min(800px, 100vw);
      background: #111;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #222;
    }
    video { width: 100%; display: block; }
    #overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: #0a0a0a;
    }
    #overlay p { font-size: 13px; color: #555; }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #0f0;
      animation: pulse 1.5s ease-in-out infinite;
      box-shadow: 0 0 8px #0f04;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .controls {
      display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;
    }
    button {
      background: #111;
      border: 1px solid #2a2a2a;
      color: #ddd;
      padding: 9px 22px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 13px;
      transition: background .15s, border-color .15s;
    }
    button:hover { background: #1e1e1e; border-color: #444; }
    button.danger { border-color: #500; color: #f66; }
    button.danger:hover { background: #200; }
    #status { font-size: 11px; color: #444; font-family: monospace; }
    canvas { display: none; }
  </style>
</head>
<body>
  <h1>Camera System</h1>
  <div id="wrap">
    <video id="cam" autoplay playsinline muted></video>
    <div id="overlay"><p>Camera off</p></div>
  </div>
  <div class="controls">
    <button onclick="toggleCamera()">Toggle Camera</button>
    <button onclick="takePhoto()">📸 Take Photo</button>
    <button onclick="toggleMirror()">↔ Mirror</button>
    <button class="danger" onclick="stopAll()">Stop</button>
  </div>
  <p id="status">Click "Toggle Camera" to begin</p>
  <canvas id="canvas"></canvas>
  <script>
    let stream = null;
    let mirrored = false;
    const video = document.getElementById('cam');
    const overlay = document.getElementById('overlay');
    const status = document.getElementById('status');

    async function toggleCamera() {
      if (stream) { stopAll(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        overlay.style.display = 'none';
        status.innerHTML = '<span style="color:#0f0">● Live</span>';
      } catch (e) {
        status.innerHTML = '<span style="color:#f66">Access denied: ' + e.message + '</span>';
      }
    }

    function stopAll() {
      if (!stream) return;
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      video.srcObject = null;
      overlay.style.display = 'flex';
      status.textContent = 'Camera stopped';
    }

    function takePhoto() {
      if (!stream) { status.textContent = 'Start camera first'; return; }
      const c = document.getElementById('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const a = document.createElement('a');
      a.download = 'photo-' + Date.now() + '.png';
      a.href = c.toDataURL();
      a.click();
      status.textContent = 'Photo saved!';
    }

    function toggleMirror() {
      mirrored = !mirrored;
      video.style.transform = mirrored ? 'scaleX(-1)' : '';
    }
  </script>
</body>
</html>`;

