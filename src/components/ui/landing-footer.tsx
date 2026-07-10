'use client';

import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { X } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const columns = [
    {
        title: 'Product',
        links: [
            { label: 'Features', href: '/features' },
            { label: 'Chat', href: '/chat' },
            { label: 'Code', href: '/code' },
            { label: 'Arena', href: '/arena' },
            { label: 'Usage', href: '/usage' },
        ],
    },
    {
        title: 'Company',
        links: [
            { label: 'About', href: '/about' },
            { label: 'Environment', href: '/environment' },
            { label: 'Blog', href: '/blog' },
            { label: 'Changelog', href: '/changelog' },
        ],
    },
    {
        title: 'Legal',
        links: [
            { label: 'Terms of Service', href: '/terms' },
            { label: 'Privacy Policy', href: '/privacy' },
        ],
    },
    {
        title: 'Support',
        links: [
            { label: 'Ask Questions', href: '#ask-questions' },
        ],
    },
];

export function LandingFooter() {
    const [copyrightHovered, setCopyrightHovered] = useState(false);
    const [showForm, setShowForm] = useState(false);

    return (
        <>
        {/* Typeform modal */}
        <AnimatePresence>
            {showForm && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={() => setShowForm(false)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 16 }}
                        transition={{ duration: 0.25 }}
                        className="relative w-full max-w-2xl h-[80vh] rounded-2xl overflow-hidden bg-background border border-border shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowForm(false)}
                            className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                        <iframe
                            src="https://form.typeform.com/to/hglbQHKr"
                            className="w-full h-full border-0"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
                            referrerPolicy="no-referrer"
                        />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
        <motion.footer
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.8, ease }}
            className="border-t border-border"
        >
            <div className="mx-auto max-w-5xl px-4 py-12">
                <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, ease }}
                        className="col-span-2 md:col-span-1"
                    >
                        <Link href="/" className="text-lg font-bold tracking-tight text-foreground transition-opacity hover:opacity-80">
                            Tripplet
                        </Link>
                        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                            Next-generation AI reasoning and creative tools.
                        </p>
                    </motion.div>

                    {columns.map((col, colIdx) => (
                        <motion.div
                            key={col.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: (colIdx + 1) * 0.08, ease }}
                        >
                            <h3 className="text-sm font-semibold text-foreground mb-3">{col.title}</h3>
                            <ul className="space-y-2">
                                {col.links.map((link) => (
                                    <li key={link.label}>
                                        {link.href === '#ask-questions' ? (
                                            <button
                                                onClick={() => setShowForm(true)}
                                                className="relative text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-foreground/40 after:transition-all after:duration-300 hover:after:w-full"
                                            >
                                                {link.label}
                                            </button>
                                        ) : (
                                            <Link
                                                href={link.href}
                                                className="relative text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-foreground/40 after:transition-all after:duration-300 hover:after:w-full"
                                            >
                                                {link.label}
                                            </Link>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.3, ease }}
                    className="mt-10 border-t border-border pt-6"
                >
                    <div
                        className="relative h-4 text-center cursor-default select-none"
                        onMouseEnter={() => setCopyrightHovered(true)}
                        onMouseLeave={() => setCopyrightHovered(false)}
                    >
                        <AnimatePresence mode="wait">
                            {!copyrightHovered ? (
                                <motion.p
                                    key="normal"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute inset-0 text-xs text-muted-foreground/60"
                                >
                                    &copy; {new Date().getFullYear()} Tripplet. All rights reserved.
                                </motion.p>
                            ) : (
                                <motion.p
                                    key="easter"
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="absolute inset-0 text-xs text-muted-foreground/80"
                                >
                                    Made with questionable sleep schedules and good coffee. ✦
                                </motion.p>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </motion.footer>
        </>
    );
}
