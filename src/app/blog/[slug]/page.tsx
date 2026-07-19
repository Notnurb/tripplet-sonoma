'use client';

import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion, useScroll } from 'framer-motion';
import { ArrowLeft, ArrowRight, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { notFound, useParams } from 'next/navigation';
import { BlogReactions } from '@/components/ui/blog-reactions';

// ─── Post Content ────────────────────────────────────────
type Section = { heading?: string; paragraphs: string[] };
type PostContent = {
    slug: string;
    title: string;
    excerpt: string;
    date: string;
    category: string;
    readTime: string;
    sections: Section[];
};

const POSTS: PostContent[] = [
    {
        slug: 'why-we-stopped-open-sourcing-our-models',
        title: 'Why we stopped open-sourcing our models',
        excerpt: 'Why we stopped open sourcing Tripplets Models, possibly creating a extreme effect to Tripplets Reputation',
        date: 'July 18, 2026',
        category: 'Product',
        readTime: '2 min read',
        sections: [
            {
                paragraphs: [
                    '# Why Tripplet Stopped Open-Sourcing New Models',
                    'For a while, every model we shipped went straight to Hugging Face. That\'s not the case anymore, and we want to be upfront about why, instead of just quietly letting it fade.',
                    '**The old models are still there.** Taipei 3.1, Majuli 3.1, Suzhou 3.1, and Synthara 1 remain fully open on Hugging Face under Notnurb. Nothing has been taken down, nothing is getting relicensed retroactively. If you built on them, you can keep building on them.',
                    '**But going forward, our models aren\'t being open-sourced.** A few honest reasons:',
                    '1. **The merge recipes are the actual product.** Tripplet\'s models aren\'t trained from scratch — they\'re mergekit merges of open-weight bases, tuned through a lot of trial and error to get the right blend of behavior, tone, and performance. Publishing the final weights makes that work trivially copyable. Someone can pull the weights, skip years of iteration, and relaunch as a competitor overnight. Early on that felt fine, but at Tripplet\'s current stage, it isn\'t.',
                    '2. **Open weights don\'t actually help the mission right now.** The original thinking was "open models = trust + community goodwill." In practice, most of the goodwill came from the product being usable and fast, not from the license on the weights. Almost nobody was fine-tuning or redistributing Taipei/Majuli/Suzhou in ways that mattered, but plenty of people were re-uploading them as their own "new" models. That\'s not community; that\'s just getting stripped for parts.',
                    '3. **The website and infra staying OSS is the actual differentiator we want.** Anyone can inspect, fork, or self-host the Tripplet frontend and backend. That\'s where we think openness earns trust: you can verify how your data is handled, how requests are routed, what\'s actually happening client-side. The model weights are a separate question from "can you trust the platform," and we\'re treating them separately now.',
                    '4. **Regulation-proofing cuts both ways.** Being self-hosted and merge-based instead of dependent on a single frontier lab\'s API is a real advantage: nobody can revoke your access to weights you already have. But that same architecture is also what makes the models themselves worth protecting; they\'re not a commodity wrapper around someone else\'s API, they\'re the thing we\'ve actually built.',
                    'So: infra stays open, because that\'s where trust matters. New models stay closed, because that\'s where the actual work is. And the old models stay up on Hugging Face because taking them down would just be petty — they did their job, and if they\'re still useful to someone, that\'s a fine legacy to leave.',
                    'If you disagree with this tradeoff, that\'s fair — it\'s a real tradeoff, not a strictly correct answer.',
                ],
            },
        ],
    },
    {
        slug: 'march-2026-stability',
        title: 'How We Made Tripplet More Stable in March',
        excerpt: 'Password reset tokens, rate limiting, and error handling — what we tightened up and why.',
        date: 'March 24, 2026',
        category: 'Engineering',
        readTime: '4 min read',
        sections: [
            {
                paragraphs: [
                    'Stability isn\'t glamorous. Nobody tweets about "we fixed our rate limiting." But it\'s the kind of work that makes the difference between a platform you can trust and one that makes you nervous. This week we shipped a focused round of auth and stability improvements. Here\'s the full breakdown.',
                ],
            },
            {
                heading: 'The password reset token fix',
                paragraphs: [
                    'We had a subtle but real security issue in our password reset flow. When a user requested a password reset, we generated a random token, hashed it with SHA-256, and stored the hash in the database. So far, so good. The bug: we were also putting the hash in the reset URL instead of the raw token.',
                    'This completely defeats the purpose of hashing. If the URL contains the hash, and the database contains the hash, then anyone who intercepts the URL (from logs, email headers, browser history) already has exactly what they need to query the database directly. The raw token was generated but thrown away unused.',
                    'The fix is the classic pattern: raw token in the URL, hash in the DB. When a reset link is clicked, we hash the incoming URL token and compare it to what\'s stored. An attacker who sees the URL can\'t compute the hash preimage. An attacker who gets the DB can\'t compute the URL token. Both sides are now protected independently.',
                    'We also clean up any existing reset tokens for a user before issuing a new one — no more token pile-up in the database from forgotten requests.',
                ],
            },
            {
                heading: 'Rate limiting on auth endpoints',
                paragraphs: [
                    'None of our auth endpoints had rate limiting. Login, registration, and forgot-password were all wide open to automated abuse.',
                    'We added strict limits: 10 login attempts per 15 minutes per IP (after which you get a 429 with a Retry-After header), 5 registration attempts per hour per IP, and 3 password reset requests per hour per IP. These limits are tight enough to stop any realistic brute-force or spamming attempt, but generous enough that a real user who mistyped their password a few times won\'t notice.',
                    'All auth rate limits are keyed by IP, not by user, so they apply equally to both existing accounts and accounts that don\'t exist yet. This matters for the forgot-password endpoint specifically — we return the same success response whether or not an account exists (to prevent email enumeration), so the rate limit is the only real protection there.',
                ],
            },
            {
                heading: 'AuthContext retry on transient failures',
                paragraphs: [
                    'On page load, Tripplet fetches the current user from /api/auth/me to restore session state. Previously, if this request failed due to a transient server error — a cold start, a brief DB hiccup — the auth context would immediately conclude "not logged in" and show the signed-out UI.',
                    'We added a single retry with a short delay. If the first request returns a 5xx error or throws a network exception, we wait 800ms and try once more. For genuine session absences (no cookie, expired token) the first request returns a clean response, so there\'s no extra latency. The retry only fires when something actually went wrong server-side.',
                ],
            },
            {
                heading: 'Error message hygiene',
                paragraphs: [
                    'The registration endpoint was returning raw Supabase error messages on failure. These messages can include table names, constraint names, and other internal details that shouldn\'t be visible to users. We replaced that with a generic "Failed to create account. Please try again." that gives users something actionable without leaking implementation details.',
                    'We also added server-side email format validation to registration. Previously, an invalid email address would pass client-side validation, reach the database, and fail on a DB constraint — returning whatever error message Supabase gave us. Now we validate the format before touching the database.',
                ],
            },
            {
                heading: 'What\'s next',
                paragraphs: [
                    'There are more stability improvements in the pipeline. We\'re looking at adding structured error codes to all auth responses (so the client can distinguish "wrong password" from "account doesn\'t exist" from "service unavailable" without parsing error strings), implementing a proper refresh token strategy so sessions extend gracefully rather than expiring hard after 7 days, and adding a token revocation list for logout.',
                    'None of this is visible to users when it\'s working correctly. That\'s the point.',
                ],
            },
        ],
    },
    {
        slug: 'introducing-v3-1-models',
        title: 'Introducing Taipei 3.1, Majuli 3.1, and Suzhou 3.1',
        excerpt: 'Our three models just got a major upgrade. Here\'s what changed and why.',
        date: 'March 5, 2026',
        category: 'Models',
        readTime: '5 min read',
        sections: [
            {
                paragraphs: [
                    'When we launched Tripplet in January, we shipped three models at version 3.0. They were good. But after two months of real-world use — millions of messages, diverse tasks, edge cases we hadn\'t anticipated — we knew exactly where each model needed to improve. Today, we\'re releasing the 3.1 generation across all three.',
                    'This isn\'t a rebranding. The improvements are specific, measurable, and meaningful. We\'ll walk through each model in detail.',
                ],
            },
            {
                heading: 'Taipei 3.1 — Deeper Reasoning',
                paragraphs: [
                    'Taipei is our flagship reasoning model, and the 3.1 upgrade focuses entirely on the quality of extended thinking. We\'ve increased the internal reasoning token budget from 8K to 32K tokens. In practice, this means Taipei can hold more intermediate steps in its working memory, revisit earlier conclusions, and produce more coherent answers to problems that require multi-pass reasoning.',
                    'On our internal benchmark suite — which includes complex coding problems, multi-step math proofs, and research synthesis tasks — Taipei 3.1 scores 23% higher on average than 3.0. For extended thinking specifically, the improvement is 31%. These aren\'t cherry-picked examples; they represent median performance across 10,000 test cases.',
                    'To use Extended Thinking, toggle it on in the model selector. You\'ll see a brief pause while Taipei works through the problem — this is intentional, and the output quality difference on hard problems is substantial.',
                ],
            },
            {
                heading: 'Majuli 3.1 — 40% Faster',
                paragraphs: [
                    'Majuli is our speed-optimized model, and the 3.1 release makes it meaningfully faster without sacrificing output quality. We achieved this through two changes: speculative decoding and an improved attention mechanism that reduces redundant computation on repetitive phrasing.',
                    'Average time to first token dropped from 1.9 seconds to 1.1 seconds. For short responses (under 200 tokens), the full response arrives 40% sooner on average. For longer responses, the throughput improvement compounds — 50 tokens per second in 3.1 versus 35 in 3.0.',
                    'We also improved Majuli\'s conciseness. The model was trained on a more aggressive brevity signal, which means answers are shorter without losing content. This was one of the most consistent pieces of feedback we received about 3.0: Majuli was verbose.',
                ],
            },
            {
                heading: 'Suzhou 3.1 — Richer Creative Output',
                paragraphs: [
                    'Suzhou is our creative model — the one we recommend for writing, ideation, image prompt generation, and open-ended exploration. The 3.1 improvements here are harder to quantify than reasoning accuracy, but they\'re equally real.',
                    'We fine-tuned Suzhou 3.1 on a curated dataset of high-quality creative outputs, with a particular focus on instruction adherence. When you give Suzhou a specific format — a sonnet, a product brief, a character description — it follows the structure more reliably than 3.0 did. It\'s also better at decomposing multi-part creative tasks: "write a product landing page with five sections" now reliably produces five distinct sections with intentional differentiation.',
                    'Image prompt generation quality improved significantly. Suzhou 3.1 produces prompts that result in higher-quality outputs from our image generation pipeline, with more specific lighting, composition, and style guidance.',
                ],
            },
            {
                heading: 'What\'s next',
                paragraphs: [
                    'Version 3.2 is already in development. The primary focus is long-context improvements across all three models, particularly for document analysis and codebase-scale reasoning. We\'re also working on voice input and a plugin system — both expected later this quarter.',
                    'All 3.1 models are live now. If you\'re an existing user, you\'re already on 3.1 — we migrated all conversations automatically. No action required.',
                ],
            },
        ],
    },
    {
        slug: 'building-the-code-workspace',
        title: 'How We Built the Code Workspace',
        excerpt: 'A chat-driven code generation pipeline with live preview, multi-file editing, and one-click deploy.',
        date: 'February 28, 2026',
        category: 'Engineering',
        readTime: '8 min read',
        sections: [
            {
                paragraphs: [
                    'When we started designing the Code workspace, we had a hypothesis: most AI code generation tools fail because they\'re disconnected from the environment where code runs. You get a code block in a chat window, you copy it, you paste it somewhere else, you run it, you come back to the chat to report the error. The loop is exhausting.',
                    'We wanted to close that loop entirely. The result is a chat-driven workspace where Tripplet writes code directly to a file tree, you see a live preview immediately, and deploy happens with one click. Here\'s how we built it.',
                ],
            },
            {
                heading: 'Architecture: Three panes, one state',
                paragraphs: [
                    'The workspace has three components: a chat pane (standard streaming chat), a code pane (CodeMirror editor with our file tree), and a preview pane (sandboxed iframe). They share a single source of truth: an in-memory file tree that maps file paths to content strings.',
                    'When the model generates a response that includes file operations, our parser extracts structured operations — create, modify, delete — and applies them to the file tree. The code pane re-renders the affected files. The preview iframe reloads after each successful operation set. The user sees the change before the full response has even finished streaming.',
                ],
            },
            {
                heading: 'The streaming file operations protocol',
                paragraphs: [
                    'We designed a lightweight message format for file operations that streams efficiently over SSE. Each operation is a JSON object: `{ op: "create" | "modify" | "delete", path: string, content?: string }`. The model is prompted to emit these before its explanation, so the UI updates happen progressively as the model writes.',
                    'For partial file updates — when the model modifies a specific function in a large file — we use a diff format rather than sending the full file content. This reduces token usage by 60-80% on iterative changes and makes the streaming feel immediate.',
                    'We handle errors optimistically. If an operation set fails (malformed JSON, invalid path, etc.), we revert the file tree to its last known good state and surface the error in the chat pane. The user can ask for a correction and the model tries again.',
                ],
            },
            {
                heading: 'Deploy pipeline',
                paragraphs: [
                    'One-click deploy packages the current file tree as a zip, uploads it to our deployment infrastructure, and returns a public URL. The full flow takes 8-12 seconds on average. We use Vercel\'s deployment API under the hood, which means the URLs are fast and globally distributed.',
                    'Currently, the Code workspace supports static HTML, CSS, and JavaScript projects, as well as single-page React apps with Babel transforms in the browser. Next.js support and server-side environments are in progress.',
                    'We also store deployment history. If you deploy, make changes, and the new deploy breaks something, you can roll back to any previous deploy from the settings dialog in the workspace.',
                ],
            },
        ],
    },
    {
        slug: 'extended-thinking-explained',
        title: 'Extended Thinking: When and Why to Use It',
        excerpt: 'Extended Thinking lets Tripplet\'s models spend more time reasoning before responding.',
        date: 'February 22, 2026',
        category: 'Product',
        readTime: '4 min read',
        sections: [
            {
                paragraphs: [
                    'Most AI responses happen in one pass: the model reads your message and starts generating tokens immediately. Extended Thinking changes this. When enabled, Taipei 3.1 allocates a reasoning budget — a block of tokens it uses to work through the problem before forming its final answer.',
                    'Think of it as the model scratchpadding. It can explore dead ends, reconsider assumptions, and verify intermediate steps. The final response benefits from all of this invisible work.',
                ],
            },
            {
                heading: 'When to use it',
                paragraphs: [
                    'Extended Thinking shines on problems that require multi-step reasoning: complex debugging, mathematical proofs, architectural design decisions, research synthesis, or any question where the "obvious" first answer is probably wrong. If you\'re asking something where you\'d expect a smart human to say "let me think about this for a moment," Extended Thinking is a good fit.',
                    'It\'s not useful for simple factual questions, short summaries, or casual conversation. In those cases, it adds latency without improving quality. The model still works correctly without it — Extended Thinking is a tool you deploy deliberately, not a setting you leave on all the time.',
                ],
            },
            {
                heading: 'The performance trade-off',
                paragraphs: [
                    'Extended Thinking increases time to first token by 2-4x, depending on problem complexity. On a task that normally takes 1.1 seconds to start streaming, Extended Thinking might take 3-5 seconds. The full response time is also longer.',
                    'The quality improvement more than justifies this on hard tasks. In our benchmarks, Extended Thinking improves accuracy on complex reasoning problems by 23% on average. For the hardest tasks in our suite — the ones where base Taipei 3.0 scored under 50% — the improvement was 41%.',
                ],
            },
            {
                heading: 'How to enable it',
                paragraphs: [
                    'Open the model selector in any chat and toggle "Extended Thinking" on. You\'ll see an amber indicator in the input bar while it\'s active. Extended Thinking is always active on Max mode, which uses Taipei 3.1 by default.',
                    'You can also control the reasoning token budget via the API (Coming Soon). Higher budgets allow deeper reasoning on the most complex problems, at correspondingly higher latency and cost.',
                ],
            },
        ],
    },
    {
        slug: 'why-we-open-sourced',
        title: 'Why Tripplet Is Open Source',
        excerpt: 'We released Tripplet under the Unlicense. Here\'s the reasoning behind that decision.',
        date: 'February 8, 2026',
        category: 'Company',
        readTime: '6 min read',
        sections: [
            {
                paragraphs: [
                    'Releasing an AI product as open source isn\'t an obvious choice. You\'re giving competitors a head start. You\'re accepting that someone will fork your codebase and compete with you directly. You\'re choosing community over control.',
                    'We did it anyway. Here\'s why.',
                ],
            },
            {
                heading: 'The decision',
                paragraphs: [
                    'When we were deciding on a license, we considered three options: proprietary (standard SaaS), permissive open source (MIT/Apache), and the Unlicense (public domain). We chose the Unlicense because it has zero ambiguity: anyone can do anything with the code, forever, with no attribution required.',
                    'The reasoning was partly philosophical and partly strategic. Philosophically, we believe that AI tools should be inspectable and forkable. If Tripplet\'s entire business model depended on keeping our UI hidden, that would be a sign that we don\'t have a compelling enough product. Our actual moat is the models, the infrastructure, and the team — not the Next.js frontend.',
                ],
            },
            {
                heading: 'How it\'s worked out',
                paragraphs: [
                    'Six weeks after publishing the repo, we have 2,400 GitHub stars and 47 external contributors. Three of those contributors have submitted PRs that we merged directly into production. One — a developer who wanted better keyboard shortcuts in the Code workspace — now has their code running for every Tripplet user.',
                    'We\'ve also received detailed bug reports and feature requests from developers who read the source code to understand how something worked. This level of feedback quality is impossible to get with a black-box product.',
                ],
            },
            {
                heading: 'The trade-offs',
                paragraphs: [
                    'Has anyone forked Tripplet and tried to compete? Yes — we\'ve seen at least three forks that are building commercial products on top of our UI. We\'re fine with this. If they succeed, it validates the space. If they build something better, we learn from them.',
                    'What we keep proprietary: the model weights, the inference infrastructure, and the training pipelines. The application code is open. The intelligence is ours.',
                ],
            },
        ],
    },
    {
        slug: 'model-routing-architecture',
        title: 'Smart Model Routing: Picking the Right Model Automatically',
        excerpt: 'How our routing system picks the optimal model based on prompt complexity.',
        date: 'January 25, 2026',
        category: 'Engineering',
        readTime: '6 min read',
        sections: [
            {
                paragraphs: [
                    'One of the things we wanted to get right early was model routing. Not every question needs Taipei 3.1 with Extended Thinking. Sending a "what\'s the capital of France?" to our most powerful model is wasteful — it adds latency, increases cost, and produces an identical answer to what Majuli would give in 0.3 seconds.',
                ],
            },
            {
                heading: 'The routing classifier',
                paragraphs: [
                    'We built a lightweight classifier that runs before the main model inference. It takes the last 2-3 messages of conversation context and outputs a routing score from 0 to 1, representing estimated task complexity. The classifier runs in under 20ms on CPU and adds no perceptible latency to the user.',
                    'Features the classifier uses: prompt length, presence of code, mathematical notation, multi-step instructions, and a small vocabulary of complexity signals ("prove", "architecture", "refactor", "debug") versus simplicity signals ("what is", "list", "translate").',
                ],
            },
            {
                heading: 'Routing logic',
                paragraphs: [
                    'Score < 0.3: Route to Majuli 3.1 (fast, concise). Score 0.3-0.7: Route to Suzhou 3.1 (balanced). Score > 0.7: Route to Taipei 3.1 (reasoning). Extended Thinking is activated for scores > 0.9.',
                    'In Auto mode (the default), routing is invisible. Users with Pro and Max plans can override by selecting a specific model in the selector. We log routing decisions and use them as training signal to improve the classifier over time.',
                ],
            },
            {
                heading: 'Results',
                paragraphs: [
                    'Auto routing reduces average inference cost per message by 42% compared to always routing to Taipei. User satisfaction scores are identical between Auto and manual Taipei selection, which tells us the routing is working as intended.',
                    'The most interesting failure mode we found during testing: the classifier over-indexed on prompt length and would route long but simple messages to Taipei. We fixed this by adding a specificity feature that penalizes verbose but semantically simple prompts.',
                ],
            },
        ],
    },
    {
        slug: 'web-search-integration',
        title: 'How Tripplet Searches the Web',
        excerpt: 'The search pipeline, source ranking, and how we present citations.',
        date: 'January 18, 2026',
        category: 'Product',
        readTime: '5 min read',
        sections: [
            {
                paragraphs: [
                    'When a conversation requires current information — recent events, live prices, new research — Tripplet can search the web. The feature is available in all plans. Here\'s exactly how it works.',
                ],
            },
            {
                heading: 'When search activates',
                paragraphs: [
                    'Search activation is automatic when the model detects that a question likely requires current information. Signals include: temporal language ("latest", "today", "this week"), queries about people or companies, and factual questions where the model\'s training data might be stale.',
                    'You can also trigger search manually by clicking the search icon in the input bar. In manual mode, every response will include web results regardless of the question type.',
                ],
            },
            {
                heading: 'The search pipeline',
                paragraphs: [
                    'When search activates, we run a query against our search index (which combines multiple providers) and retrieve the top 10 candidate pages. We then run a relevance pass using Majuli 3.1 to score and filter to the 3-5 most relevant results. These results are chunked and injected into the model\'s context before generation.',
                    'We explicitly prompt the model to cite sources inline — not at the end of the response, but immediately after the claim they support. This makes it easy to verify specific facts without reading an end-of-post list.',
                ],
            },
            {
                heading: 'Source cards and expandability',
                paragraphs: [
                    'Below each response that uses search, we render expandable source cards — one per source cited. Each card shows the domain, title, and a brief excerpt. Clicking the card opens the full source URL in a new tab.',
                    'We intentionally surface the sources prominently because we believe AI responses should be verifiable. If Tripplet tells you something based on a web search, you should be able to check the source in one click.',
                ],
            },
        ],
    },
];

// ─── Reading Progress Bar ────────────────────────────────
function ReadingProgressBar() {
    const { scrollYProgress } = useScroll();
    return (
        <motion.div
            className="fixed top-0 left-0 right-0 z-[999] h-[2px] origin-left bg-foreground"
            style={{ scaleX: scrollYProgress }}
        />
    );
}

// ─── Page ────────────────────────────────────────────────
const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function BlogPost() {
    const params = useParams<{ slug: string }>();
    const post = POSTS.find((p) => p.slug === params.slug);

    if (!post) notFound();

    const related = POSTS.filter((p) => p.slug !== post.slug && p.category === post.category).slice(0, 2);
    const fallback = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
    const relatedPosts = related.length >= 2 ? related : fallback;

    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <ReadingProgressBar />
            <LandingHeader />

            <main className="grow">
                {/* Header */}
                <section className="mx-auto w-full max-w-3xl px-4 pt-32 pb-12 md:pt-40">
                    {/* Breadcrumb */}
                    <motion.div
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, ease }}
                    >
                        <Link
                            href="/blog"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Blog
                        </Link>
                    </motion.div>

                    {/* Meta */}
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1, ease }}
                        className="mt-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
                    >
                        <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-medium">
                            {post.category}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {post.date}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {post.readTime}
                        </span>
                    </motion.div>

                    {/* Title */}
                    <motion.h1
                        initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.7, delay: 0.2, ease }}
                        className="mt-6 gradient-text text-3xl font-bold tracking-tight md:text-4xl"
                    >
                        {post.title}
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.6, delay: 0.3, ease }}
                        className="mt-4 text-lg text-muted-foreground leading-relaxed"
                    >
                        {post.excerpt}
                    </motion.p>

                    {/* Author */}
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4, ease }}
                        className="mt-8 flex items-center gap-3 border-t border-border pt-6"
                    >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/10 text-sm font-bold">
                            T
                        </div>
                        <div>
                            <div className="text-sm font-medium">Tripplet Team</div>
                            <div className="text-xs text-muted-foreground">tripplet.ai</div>
                        </div>
                    </motion.div>
                </section>

                {/* Divider */}
                <div className="mx-auto w-full max-w-3xl px-4">
                    <div className="border-t border-border" />
                </div>

                {/* Article body */}
                <article className="mx-auto w-full max-w-3xl px-4 py-12">
                    <div className="space-y-10">
                        {post.sections.map((section, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
                                whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                viewport={{ once: true, margin: '-60px' }}
                                transition={{ duration: 0.6, ease }}
                            >
                                {section.heading && (
                                    <h2 className="mb-4 text-xl font-bold tracking-tight md:text-2xl">
                                        {section.heading}
                                    </h2>
                                )}
                                <div className="space-y-4">
                                    {section.paragraphs.map((p, j) => (
                                        <p key={j} className="text-muted-foreground leading-[1.8] text-base">
                                            {p}
                                        </p>
                                    ))}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </article>

                {/* Reactions */}
                <div className="mx-auto w-full max-w-3xl px-4">
                    <BlogReactions slug={post.slug} />
                </div>

                {/* Newsletter CTA */}
                <section className="mx-auto w-full max-w-3xl px-4 pb-16">
                    <motion.div
                        initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
                        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, ease }}
                        className="rounded-3xl border border-border bg-card p-8 text-center"
                    >
                        <p className="text-sm font-medium text-muted-foreground mb-2">
                            Enjoyed this post?
                        </p>
                        <h3 className="text-xl font-bold tracking-tight">Try Tripplet for free</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Unlimited messages, no credit card required.
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Link href="/chat">
                                <Button className="rounded-full group" size="lg">
                                    Start chatting
                                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                                </Button>
                            </Link>
                            <Link href="/blog">
                                <Button variant="outline" className="rounded-full" size="lg">
                                    More posts
                                </Button>
                            </Link>
                        </div>
                    </motion.div>
                </section>

                {/* Related posts */}
                {relatedPosts.length > 0 && (
                    <section className="mx-auto w-full max-w-3xl border-t border-border px-4 py-16">
                        <motion.h2
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, ease }}
                            className="mb-6 text-lg font-bold"
                        >
                            More from the blog
                        </motion.h2>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {relatedPosts.map((rp, i) => (
                                <motion.div
                                    key={rp.slug}
                                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.5, delay: i * 0.08, ease }}
                                >
                                    <Link href={`/blog/${rp.slug}`} className="group block">
                                        <motion.div
                                            whileHover={{ y: -2 }}
                                            transition={{ duration: 0.2 }}
                                            className="rounded-2xl border border-border bg-card p-5 card-hover"
                                        >
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                                                <span className="rounded-full border border-border px-2 py-0.5">{rp.category}</span>
                                                <span>{rp.readTime}</span>
                                            </div>
                                            <h3 className="font-semibold leading-snug text-sm group-hover:underline underline-offset-4">
                                                {rp.title}
                                            </h3>
                                            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                                {rp.excerpt}
                                            </p>
                                        </motion.div>
                                    </Link>
                                </motion.div>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            <LandingFooter />
        </div>
    );
}
