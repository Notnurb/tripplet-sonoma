'use client';

import Link from 'next/link';
import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';
import { ArrowLeft, Download } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94] as const;
const PDF_URL = '/api/environment/report';

export default function EnvironmentReportPage() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow flex flex-col">
                {/* Top bar */}
                <section className="mx-auto w-full max-w-5xl px-4 pt-28 pb-4 md:pt-36">
                    <motion.div
                        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.6, ease }}
                        className="flex items-center justify-between"
                    >
                        <Link
                            href="/environment"
                            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to Environment
                        </Link>

                        <a
                            href={PDF_URL}
                            download="tripplet-environmental-report.pdf"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <Download className="h-4 w-4" />
                            Download PDF
                        </a>
                    </motion.div>
                </section>

                {/* PDF viewer */}
                <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.15, ease }}
                    className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12"
                >
                    <iframe
                        src={PDF_URL}
                        className="w-full rounded-xl border border-border shadow-lg"
                        style={{ height: 'calc(100vh - 200px)', minHeight: 600 }}
                        title="Tripplet Environmental Report"
                    />
                </motion.section>
            </main>

            <LandingFooter />
        </div>
    );
}
