'use client';

import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

type Post = {
    slug: string;
    title: string;
    excerpt: string;
    date: string;
    category: string;
    readTime: string;
};

const posts: Post[] = [
    {
        slug: 'march-2026-stability',
        title: 'How We Made Tripplet More Stable in March',
        excerpt: 'We quietly shipped a round of stability and security improvements to Tripplet\'s auth system this week. Password reset tokens, rate limiting, and error handling all got tightened up. Here\'s what we changed and why it matters.',
        date: 'March 24, 2026',
        category: 'Engineering',
        readTime: '4 min read',
    },
    {
        slug: 'introducing-v3-1-models',
        title: 'Introducing Taipei 3.1, Majuli 3.1, and Suzhou 3.1',
        excerpt: 'Our three models just got a major upgrade. Taipei 3.1 brings deeper reasoning with extended thinking. Majuli 3.1 cuts response times by 40%. Suzhou 3.1 produces richer creative output across writing, code, and image prompts. Here\'s what changed and why.',
        date: 'March 5, 2026',
        category: 'Models',
        readTime: '5 min read',
    },
    {
        slug: 'building-the-code-workspace',
        title: 'How We Built the Code Workspace',
        excerpt: 'Tripplet\'s Code workspace lets you describe an app in natural language and get working files in seconds. Under the hood, it\'s a chat-driven code generation pipeline with live preview, multi-file editing, and one-click deploy. We walk through the architecture decisions.',
        date: 'February 28, 2026',
        category: 'Engineering',
        readTime: '8 min read',
    },
    {
        slug: 'extended-thinking-explained',
        title: 'Extended Thinking: When and Why to Use It',
        excerpt: 'Extended Thinking lets Tripplet\'s models spend more time reasoning before responding. It\'s not always faster, but for complex problems — math, multi-step logic, code architecture — it produces significantly better results. We explain how the mechanism works and when to toggle it on.',
        date: 'February 22, 2026',
        category: 'Product',
        readTime: '4 min read',
    },
    {
        slug: 'why-we-open-sourced',
        title: 'Why Tripplet Is Open Source',
        excerpt: 'We released Tripplet under the Unlicense — anyone can use, modify, and ship it. This wasn\'t an obvious decision for an AI product. We share our reasoning, the tradeoffs we considered, and how open source has shaped our development process and community.',
        date: 'February 8, 2026',
        category: 'Company',
        readTime: '6 min read',
    },
    {
        slug: 'model-routing-architecture',
        title: 'Smart Model Routing: Picking the Right Model Automatically',
        excerpt: 'Not every question needs the most powerful model. We built a routing system that analyzes your prompt\'s complexity and picks the optimal model — balancing speed and quality in real time. Here\'s how the classifier works.',
        date: 'January 25, 2026',
        category: 'Engineering',
        readTime: '6 min read',
    },
    {
        slug: 'web-search-integration',
        title: 'How Tripplet Searches the Web',
        excerpt: 'When a conversation requires current information, Tripplet can search the web, pull relevant sources, and synthesize the results into its response. We explain the search pipeline, source ranking, and how we present citations.',
        date: 'January 18, 2026',
        category: 'Product',
        readTime: '5 min read',
    },
];

export default function Blog() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow">
                {/* Hero */}
                <section className="mx-auto w-full max-w-5xl px-4 pt-32 pb-16 md:pt-40 md:pb-20">
                    <div className="text-center">
                        <motion.h1
                            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.7, delay: 0.1, ease }}
                            className="gradient-text text-4xl font-bold tracking-tight md:text-5xl"
                        >
                            Blog
                        </motion.h1>
                        <motion.p
                            initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.6, delay: 0.25, ease }}
                            className="mt-4 text-lg text-muted-foreground"
                        >
                            Engineering, product updates, and behind-the-scenes.
                        </motion.p>
                    </div>
                </section>

                {/* Featured Post */}
                <section className="mx-auto w-full max-w-5xl px-4 pb-12">
                    <motion.div
                        initial={{ opacity: 0, y: 28, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.7, delay: 0.3, ease }}
                    >
                        <Link href={`/blog/${posts[0].slug}`} className="group block">
                            <motion.div
                                whileHover={{ y: -3 }}
                                transition={{ duration: 0.25 }}
                                className="rounded-2xl border border-border bg-card p-8 md:p-10 card-hover"
                            >
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                                    <span className="rounded-full border border-border px-2.5 py-0.5 font-medium">{posts[0].category}</span>
                                    <span>{posts[0].date}</span>
                                    <span>{posts[0].readTime}</span>
                                </div>
                                <h2 className="text-2xl font-bold tracking-tight md:text-3xl group-hover:underline underline-offset-4">
                                    {posts[0].title}
                                </h2>
                                <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">
                                    {posts[0].excerpt}
                                </p>
                                <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                                    Read more
                                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                                </div>
                            </motion.div>
                        </Link>
                    </motion.div>
                </section>

                {/* Post Grid */}
                <section className="mx-auto w-full max-w-5xl px-4 pb-20 md:pb-28">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {posts.slice(1).map((post, i) => (
                            <motion.div
                                key={post.slug}
                                initial={{ opacity: 0, y: 28, scale: 0.96 }}
                                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                                viewport={{ once: true, margin: '-40px' }}
                                transition={{ duration: 0.5, delay: i * 0.06, ease }}
                            >
                                <Link href={`/blog/${post.slug}`} className="group block h-full">
                                    <motion.div
                                        whileHover={{ y: -3 }}
                                        transition={{ duration: 0.25 }}
                                        className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 card-hover"
                                    >
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                                            <span className="rounded-full border border-border px-2 py-0.5 font-medium">{post.category}</span>
                                            <span>{post.readTime}</span>
                                        </div>
                                        <h3 className="font-semibold leading-snug group-hover:underline underline-offset-4">
                                            {post.title}
                                        </h3>
                                        <p className="mt-2 flex-1 text-sm text-muted-foreground leading-relaxed line-clamp-3">
                                            {post.excerpt}
                                        </p>
                                        <span className="mt-4 text-xs text-muted-foreground">{post.date}</span>
                                    </motion.div>
                                </Link>
                            </motion.div>
                        ))}
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
