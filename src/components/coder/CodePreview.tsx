import { useState } from 'react';
import { FileCode2, Eye, Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GeneratedFile } from '@/hooks/useCodeGeneration';
import { motion, AnimatePresence } from 'framer-motion';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface CodePreviewProps {
    files: GeneratedFile[];
    streamedContent: string;
    currentFileIndex: number;
    isGenerating: boolean;
}

export function CodePreview({
    files,
    streamedContent,
    currentFileIndex,
    isGenerating,
}: CodePreviewProps) {
    const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
    const [selectedFileIndex, setSelectedFileIndex] = useState(0);
    const [copied, setCopied] = useState(false);

    const currentFile = files[selectedFileIndex] || null;
    const displayContent = isGenerating && selectedFileIndex === currentFileIndex
        ? streamedContent
        : currentFile?.content || '';

    const handleCopy = async () => {
        if (!displayContent) return;
        await navigator.clipboard.writeText(displayContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getLanguageLabel = (lang: string) => {
        const labels: Record<string, string> = {
            tsx: 'TypeScript React',
            ts: 'TypeScript',
            jsx: 'JavaScript React',
            js: 'JavaScript',
            css: 'CSS',
            html: 'HTML',
        };
        return labels[lang] || lang.toUpperCase();
    };

    return (
        <div className="flex flex-col h-full bg-neutral-900">
            {/* Tabs */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-neutral-950">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setActiveTab('code')}
                        className={cn(
                            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            activeTab === 'code'
                                ? 'bg-white/10 text-white'
                                : 'text-white/50 hover:text-white hover:bg-white/5'
                        )}
                    >
                        <FileCode2 className="w-4 h-4" />
                        Code
                    </button>
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={cn(
                            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            activeTab === 'preview'
                                ? 'bg-white/10 text-white'
                                : 'text-white/50 hover:text-white hover:bg-white/5'
                        )}
                    >
                        <Eye className="w-4 h-4" />
                        Preview
                    </button>
                </div>

                {activeTab === 'code' && files.length > 0 && (
                    <div className="flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-white hover:bg-white/10 transition-colors">
                                <FileCode2 className="w-4 h-4 text-primary" />
                                <span className="max-w-[150px] truncate">{currentFile?.name || 'Select file'}</span>
                                <ChevronDown className="w-3 h-3 opacity-50" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-neutral-900 border-white/10">
                                {files.map((file, index) => (
                                    <DropdownMenuItem
                                        key={file.name}
                                        onClick={() => setSelectedFileIndex(index)}
                                        className={cn(
                                            'flex items-center gap-2',
                                            selectedFileIndex === index && 'bg-white/10'
                                        )}
                                    >
                                        <FileCode2 className="w-4 h-4 text-primary" />
                                        <span>{file.name}</span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <button
                            onClick={handleCopy}
                            className="p-2 rounded-lg bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                            title="Copy code"
                        >
                            {copied ? (
                                <Check className="w-4 h-4 text-green-500" />
                            ) : (
                                <Copy className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                <AnimatePresence mode="wait">
                    {activeTab === 'code' ? (
                        <motion.div
                            key="code"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full overflow-auto"
                        >
                            {files.length === 0 && !isGenerating ? (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, ease: 'easeOut' }}
                                    className="flex flex-col items-center justify-center h-full text-center px-8"
                                >
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.92 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.05, duration: 0.25 }}
                                        className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4"
                                    >
                                        <FileCode2 className="w-8 h-8 text-white/50" />
                                    </motion.div>
                                    <motion.h3
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.12, duration: 0.25 }}
                                        className="text-lg font-medium text-white mb-2"
                                    >
                                        No Code Yet
                                    </motion.h3>
                                    <motion.p
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2, duration: 0.25 }}
                                        className="text-sm text-white/50 max-w-sm"
                                    >
                                        Start a conversation to generate code. Describe what you want to build!
                                    </motion.p>
                                </motion.div>
                            ) : (
                                <div className="relative">
                                    {/* Language badge */}
                                    {currentFile && (
                                        <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-white/10 text-xs text-white/50">
                                            {getLanguageLabel(currentFile.language)}
                                        </div>
                                    )}
                                    <pre className="p-4 text-sm font-mono text-white/90 overflow-auto h-full">
                                        <code>
                                            {displayContent}
                                            {isGenerating && selectedFileIndex === currentFileIndex && (
                                                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                                            )}
                                        </code>
                                    </pre>
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="preview"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full bg-white"
                        >
                            {files.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center px-8 bg-neutral-900">
                                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                                        <Eye className="w-8 h-8 text-white/30" />
                                    </div>
                                    <h3 className="text-lg font-medium text-white mb-2">Preview Unavailable</h3>
                                    <p className="text-sm text-white/50 max-w-sm">
                                        Generate some code first to see the preview.
                                    </p>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-100 to-slate-200">
                                    <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                                                <FileCode2 className="w-6 h-6 text-primary" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-900">Component Preview</h3>
                                                <p className="text-sm text-slate-500">Live rendering</p>
                                            </div>
                                        </div>

                                        <div className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl border border-primary/20">
                                            <h4 className="text-lg font-medium text-slate-900 mb-2">Hello World</h4>
                                            <p className="text-sm text-slate-600 mb-4">
                                                This is your custom component generated by Tripplet Coder.
                                            </p>
                                            <button className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                                                Click Me
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
