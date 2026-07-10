'use client';

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { useState } from 'react';
import { CodeExecution } from '@/types';
import CodeExecutionPanel from './CodeExecutionPanel';
import { motion } from 'framer-motion';

interface CodeBlockProps {
    language: string;
    value: string;
    execution?: CodeExecution;
}

export default function CodeBlock({ language, value, execution }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // Fallback for insecure contexts / permission denied
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Custom style overrides to match the design system
    const customStyle: React.CSSProperties = {
        margin: 0,
        borderRadius: '1rem',
        fontSize: '0.85rem',
        lineHeight: '1.6',
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative group my-4 rounded-2xl overflow-hidden border border-border/60 hover:border-border bg-card hover:shadow-lg transition-all duration-300"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-gradient-to-r from-accent/40 to-accent/20 hover:from-accent/50 hover:to-accent/30 transition-all duration-200">
                <span className="text-xs font-mono text-muted-foreground/80 uppercase tracking-widest font-semibold">
                    {language}
                </span>
                <motion.button
                    onClick={handleCopy}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                    className={`flex items-center gap-1.5 text-xs font-medium py-1 px-2 rounded-lg transition-all duration-200 ${
                        copied
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent hover:border-border'
                    }`}
                >
                    <motion.div
                        key={copied ? 'copied' : 'copy'}
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 1.2 }}
                        transition={{ duration: 0.2 }}
                    >
                        <HugeiconsIcon
                            icon={copied ? Tick02Icon : Copy01Icon}
                            size={14}
                            className={copied ? 'text-emerald-400' : ''}
                        />
                    </motion.div>
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </motion.button>
            </div>

            {/* Code */}
            <SyntaxHighlighter
                language={language}
                style={vscDarkPlus}
                customStyle={customStyle}
                showLineNumbers
                wrapLongLines
            >
                {value}
            </SyntaxHighlighter>

            {execution && <CodeExecutionPanel execution={execution} />}
        </motion.div>
    );
}
