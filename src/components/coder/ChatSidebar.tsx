import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Trash2, Bot, User, ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Message } from '@/hooks/useCodeGeneration';
import { motion, AnimatePresence } from 'framer-motion';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const AI_MODELS = [
    'Tripplet Coder',
    'Tripplet Coder Pro',
    'Tripplet Coder v1.5',
];

const TRIPPLET_ICON = (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
);

interface ChatSidebarProps {
    messages: Message[];
    isGenerating: boolean;
    onSendMessage: (content: string, model: string) => void;
    onClear: () => void;
    selectedModel?: string;
    onModelChange?: (model: string) => void;
    /** Optional title shown below the model name (e.g. article title) */
    contextLabel?: string;
    /** Show a close button — fires this callback */
    onClose?: () => void;
    /** Placeholder text for the input */
    inputPlaceholder?: string;
    /** Empty state body copy */
    emptyStateBody?: string;
}

export function ChatSidebar({
    messages,
    isGenerating,
    onSendMessage,
    onClear,
    selectedModel: controlledModel,
    onModelChange,
    contextLabel,
    onClose,
    inputPlaceholder = 'Describe what to build...',
    emptyStateBody = "Describe what you want to create and I'll generate the code for you.",
}: ChatSidebarProps) {
    const [input, setInput] = useState('');
    const [internalModel, setInternalModel] = useState(AI_MODELS[0]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const selectedModel = controlledModel ?? internalModel;
    const handleModelChange = (m: string) => {
        setInternalModel(m);
        onModelChange?.(m);
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isGenerating) return;
        onSendMessage(input, selectedModel);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <div className="flex flex-col h-full bg-neutral-950 border-r border-white/10">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-white hover:bg-white/10 transition-colors border border-white/10 max-w-[200px]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={selectedModel}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 4 }}
                                transition={{ duration: 0.12 }}
                                className="flex items-center gap-2 min-w-0"
                            >
                                {TRIPPLET_ICON}
                                <span className="truncate text-xs">{selectedModel}</span>
                                <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                            </motion.div>
                        </AnimatePresence>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-neutral-900 border-white/10 min-w-[220px]">
                        {AI_MODELS.map((model) => (
                            <DropdownMenuItem
                                key={model}
                                onClick={() => handleModelChange(model)}
                                className="flex items-center justify-between gap-2"
                            >
                                <div className="flex items-center gap-2">
                                    {TRIPPLET_ICON}
                                    <span className="text-sm">{model}</span>
                                </div>
                                {selectedModel === model && (
                                    <Check className="w-4 h-4 text-primary" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex items-center gap-1">
                    {messages.length > 0 && (
                        <button
                            onClick={onClear}
                            className="p-2 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors"
                            title="Clear conversation"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors"
                            title="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {contextLabel && (
                <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02]">
                    <p className="text-[11px] text-white/35 truncate">{contextLabel}</p>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="flex flex-col items-center justify-center h-full text-center px-4"
                    >
                        <div className="relative mb-4">
                            <div className="absolute inset-0 rounded-2xl bg-primary/20 animate-pulse" />
                            <div className="relative w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                                <Bot className="w-8 h-8 text-primary" />
                            </div>
                        </div>
                        <motion.h3
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1, duration: 0.25 }}
                            className="text-lg font-medium text-white mb-2"
                        >
                            Start Building
                        </motion.h3>
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.18, duration: 0.25 }}
                            className="text-sm text-white/50"
                        >
                            {emptyStateBody}
                        </motion.p>
                    </motion.div>
                ) : (
                    <AnimatePresence initial={false}>
                        {messages.map((message) => (
                            <motion.div
                                key={message.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                                className={cn(
                                    'flex gap-3',
                                    message.role === 'user' ? 'flex-row-reverse' : ''
                                )}
                            >
                                <div
                                    className={cn(
                                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                                        message.role === 'user'
                                            ? 'bg-primary/20'
                                            : 'bg-white/10'
                                    )}
                                >
                                    {message.role === 'user' ? (
                                        <User className="w-4 h-4 text-primary" />
                                    ) : (
                                        <Bot className="w-4 h-4 text-white" />
                                    )}
                                </div>
                                <div
                                    className={cn(
                                        'rounded-xl px-4 py-2 max-w-[85%]',
                                        message.role === 'user'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-white/10 text-white'
                                    )}
                                >
                                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}

                {isGenerating && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex gap-3"
                    >
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                        </div>
                        <div className="bg-white/10 rounded-xl px-4 py-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-white/70">Thinking</span>
                                <span className="flex gap-1">
                                    <span className="w-1 h-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1 h-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1 h-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={inputPlaceholder}
                        disabled={isGenerating}
                        className={cn(
                            'w-full px-4 py-3 pr-12 rounded-xl resize-none',
                            'bg-white/5 border border-white/10 text-white placeholder:text-white/40',
                            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                            'min-h-[48px] max-h-[120px] text-sm'
                        )}
                        rows={1}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isGenerating}
                        className={cn(
                            'absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all',
                            input.trim() && !isGenerating
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-white/5 text-white/30 cursor-not-allowed'
                        )}
                    >
                        {isGenerating ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
