'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { useChatActions } from '@/context/ChatContext';
import SonomaChatShell from './ChatShell';
import { buildPreviewSrcDoc } from './HtmlPreviewPanel';
import { SonomaProjectFiles, SonomaX } from './icons';
import type { WebBlock } from './message-context';

const MODEL_IDS = ['astro-5', 'taipei4', 'majuli4', 'suzhou4'];
const BUILD_PROMPT_EVENT = 'tripplet:build-prompt';

const BUILD_GREETING = {
    title: 'What will you build?',
    sub: 'Shape the idea. I’ll help make it real.',
    placeholder: 'Describe what you want to build…',
};

const QUESTIONS = [
    'What should this build help people do?',
    'Who is this experience for?',
    'What feeling should the visual design create?',
];
const QUESTION_OPTIONS = ['Keep it focused', 'Make it bold', 'Write my own answer'];
const BUILD_STATUSES = ['Thinking this through', 'Building', 'Shaping the visual'];
const PLAN_FILE = `# Build plan

## Objective
Create a focused, polished experience that solves the user’s primary problem with a clear visual hierarchy and a fast path to the main action.

## Phase 1 — Clarify
- Confirm the target audience and the single most important user outcome.
- Gather the required content, data, integrations, and constraints.
- Define the success criteria before visual implementation begins.

## Phase 2 — Structure
- Map the primary user flow from entry point to completion.
- Choose the page or screen structure and name the reusable sections.
- Identify responsive states for narrow, medium, and wide screens.

## Phase 3 — Design
- Establish typography, spacing, color, and interaction tokens.
- Build the highest-value screen first with accessible semantic markup.
- Keep visual emphasis on the primary action and remove unnecessary decoration.

## Phase 4 — Implement
- Create the component structure and wire real interaction states.
- Add loading, empty, error, and success states.
- Validate keyboard navigation, contrast, and responsive behavior.

## Acceptance criteria
- The main task is understandable without explanation.
- The primary action is visible and usable at every supported width.
- The experience works with real content, not only placeholder copy.
- Visual and interaction changes are verified in the live canvas.

## Next question
What is the one outcome this build must make easier for its users?
`;

function QuestionSkill({ question: questionOverride, onAnswer }: { question?: string; onAnswer: (answer: string) => void }) {
    const [questionIndex, setQuestionIndex] = useState(0);
    const [selectedOption, setSelectedOption] = useState(QUESTION_OPTIONS[0]);
    const [answer, setAnswer] = useState('');
    const question = questionOverride || QUESTIONS[questionIndex];

    const submitAnswer = () => {
        const response = selectedOption === 'Write my own answer' ? answer.trim() : selectedOption;
        if (!response) return;
        onAnswer(`Build question: ${question}\nMy answer: ${response}`);
        setAnswer('');
        setQuestionIndex((index) => (index + 1) % QUESTIONS.length);
        setSelectedOption(QUESTION_OPTIONS[0]);
    };

    return (
        <section className="build-question-skill" aria-label="Build question skill">
            <div className="build-question-skill-heading"><span>Question</span><span className="build-question-step">{questionIndex + 1}/{QUESTIONS.length}</span></div>
            <p>{question}</p>
            <div className="build-question-skill-controls build-question-answer-controls">
                {QUESTION_OPTIONS.map((option) => <button key={option} type="button" className={selectedOption === option ? 'is-active' : ''} onClick={() => setSelectedOption(option)}>{option}</button>)}
                {selectedOption === 'Write my own answer' && <input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitAnswer(); }} placeholder="Type your answer…" aria-label="Answer build question" />}
                <button type="button" className="build-question-submit" onClick={submitAnswer} aria-label="Submit answer">Continue</button>
            </div>
        </section>
    );
}

type ProjectFile = { path: string; content: string; language: string };

const CODE_LANGUAGES = new Set(['html', 'css', 'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'json', 'md', 'markdown', 'svg']);

function extractProjectFiles(content: string): { blocks: WebBlock[]; files: ProjectFile[] } {
    const blocks: WebBlock[] = [];
    const files: ProjectFile[] = [];
    const counts = new Map<string, number>();
    const fence = /```([\w+#-]*)(?:[ \t]+([^\n]+))?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = fence.exec(content)) !== null) {
        const rawLang = (match[1] || '').toLowerCase();
        const lang = rawLang === 'javascript' ? 'js' : rawLang === 'typescript' ? 'ts' : rawLang === 'markdown' ? 'md' : rawLang;
        if (!CODE_LANGUAGES.has(rawLang) && !CODE_LANGUAGES.has(lang)) continue;
        const code = match[3].trim();
        if (!code) continue;
        blocks.push({ lang, code });
        const explicitPath = match[2]?.trim().replace(/^path[=:]/i, '').trim();
        const defaults: Record<string, string> = { html: 'index.html', css: 'styles.css', js: 'script.js', jsx: 'App.jsx', ts: 'script.ts', tsx: 'App.tsx', json: 'data.json', md: 'README.md', svg: 'image.svg' };
        const base = explicitPath && /[./]/.test(explicitPath) ? explicitPath : defaults[lang] || `file.${lang}`;
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        const dot = base.lastIndexOf('.');
        const path = count === 0 ? base : `${base.slice(0, dot)}-${count + 1}${base.slice(dot)}`;
        files.push({ path, content: code, language: lang });
    }
    return { blocks, files };
}

function ProjectFilesModal({ files, onClose }: { files: ProjectFile[]; onClose: () => void }) {
    const exportAll = () => {
        if (files.length === 0) return;
        const archive = zipSync(Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])));
        const url = URL.createObjectURL(new Blob([archive as unknown as BlobPart], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'tripplet-project.zip';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label="Project Files">
            <button type="button" className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" aria-label="Close Project Files" onClick={onClose} />
            <section className="relative flex max-h-[min(680px,calc(100vh-40px))] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
                <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close Project Files"><SonomaX /></button>
                <div className="sonoma-scroll min-h-0 flex-1 overflow-y-auto p-3">
                    {files.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Ask Agentic to create a web experience and its files will appear here.</p> : files.map((file) => (
                        <div key={file.path} className="flex items-center justify-between rounded-xl px-3 py-3 text-sm hover:bg-accent">
                            <span className="truncate font-mono text-foreground">{file.path}</span><span className="ml-4 shrink-0 text-xs text-muted-foreground">{file.language}</span>
                        </div>
                    ))}
                </div>
                <footer className="flex justify-center p-4"><button type="button" onClick={exportAll} disabled={files.length === 0} className="rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40">Export All</button></footer>
            </section>
        </div>
    );
}

function BuildCanvas({ started, building, planMode, blocks }: { started: boolean; building: boolean; planMode: boolean; blocks: WebBlock[] }) {
    const [statusIndex, setStatusIndex] = useState(0);
    useEffect(() => {
        if (!building) return;
        setStatusIndex(0);
        const timer = window.setInterval(() => setStatusIndex((index) => (index + 1) % BUILD_STATUSES.length), 1400);
        return () => window.clearInterval(timer);
    }, [building]);
    if (!started || planMode) return null;
    const srcDoc = blocks.length > 0 ? buildPreviewSrcDoc(blocks) : '';
    return (
        <section className="build-canvas" aria-label="Build visual canvas">
            {building && <div className="build-canvas-loading" aria-live="polite">
                <span className="build-canvas-spinner" />
                <span>{BUILD_STATUSES[statusIndex]}</span>
            </div>}
            {!building && blocks.length > 0 && <iframe title="Generated project canvas" srcDoc={srcDoc} className="h-full min-h-[420px] w-full rounded-2xl border border-border bg-white shadow-sm" sandbox="allow-scripts allow-forms allow-popups allow-modals" />}
            {!building && blocks.length === 0 && <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">Your generated experience will appear here.</div>}
        </section>
    );
}

export default function BuildWorkspace({ conversationId }: { conversationId?: string }) {
    const { createConversation } = useChatActions();
    const [sessionId, setSessionId] = useState(conversationId);
    const [chatRatio, setChatRatio] = useState(30);
    const [started, setStarted] = useState(false);
    const [building, setBuilding] = useState(false);
    const [planMode, setPlanMode] = useState(false);
    const [question, setQuestion] = useState<string | undefined>();
    const [questionVisible, setQuestionVisible] = useState(false);
    const [filesOpen, setFilesOpen] = useState(false);
    const [canvasContent, setCanvasContent] = useState('');
    const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
    const bootstrapped = useRef(false);

    const project = useMemo(() => {
        const current = extractProjectFiles(canvasContent);
        return { blocks: current.blocks, files: projectFiles };
    }, [canvasContent, projectFiles]);

    const updateCanvas = (content: string) => {
        setCanvasContent(content);
        const next = extractProjectFiles(content).files;
        if (next.length === 0) return;
        setProjectFiles((current) => {
            const byPath = new Map(current.map((file) => [file.path, file]));
            next.forEach((file) => byPath.set(file.path, file));
            return Array.from(byPath.values());
        });
    };

    useEffect(() => {
        if (conversationId || bootstrapped.current) return;
        bootstrapped.current = true;
        const id = createConversation(MODEL_IDS[0]);
        if (id) setSessionId(id);
    }, [conversationId, createConversation]);

    useEffect(() => {
        if (conversationId) setSessionId(conversationId);
    }, [conversationId]);

    useEffect(() => {
        if (window.location.search.includes('question-skill-test=1')) {
            setQuestionVisible(true);
        }
    }, []);

    useEffect(() => {
        const showQuestion = (event: Event) => {
            const nextQuestion = (event as CustomEvent<{ question?: string }>).detail?.question;
            if (!nextQuestion) return;
            setQuestion(nextQuestion);
            setQuestionVisible(true);
        };
        window.addEventListener('tripplet:build-question', showQuestion);
        return () => window.removeEventListener('tripplet:build-question', showQuestion);
    }, []);

    useEffect(() => {
        const onBuildMode = (event: Event) => {
            const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
            if (mode === 'Plan') {
                setPlanMode(true);
                setStarted(true);
                setBuilding(false);
                setCanvasContent('');
                setProjectFiles((current) => [{ path: 'plan.md', content: PLAN_FILE, language: 'md' }, ...current.filter((file) => file.path !== 'plan.md')]);
            } else if (mode === 'Build') {
                setPlanMode(false);
            }
        };
        window.addEventListener('tripplet:build-mode', onBuildMode);
        return () => window.removeEventListener('tripplet:build-mode', onBuildMode);
    }, []);

    const sendPromptToChat = (prompt: string) => {
        setQuestionVisible(false);
        window.dispatchEvent(new CustomEvent(BUILD_PROMPT_EVENT, { detail: { prompt } }));
    };

    const resizeChat = (event: React.PointerEvent<HTMLDivElement>) => {
        const resizer = event.currentTarget;
        const root = resizer.parentElement?.parentElement;
        if (!root) return;
        resizer.setPointerCapture(event.pointerId);
        const update = (move: PointerEvent) => {
            const bounds = root.getBoundingClientRect();
            const next = ((move.clientX - bounds.left) / bounds.width) * 100;
            setChatRatio(Math.min(45, Math.max(20, next)));
        };
        const stop = () => {
            resizer.removeEventListener('pointermove', update);
            resizer.removeEventListener('pointerup', stop);
        };
        resizer.addEventListener('pointermove', update);
        resizer.addEventListener('pointerup', stop);
    };

    return (
        <div
            className={`build-workspace${started ? ' is-started' : ''}${building ? ' is-building' : ''}`}
            style={{ '--build-chat-ratio': `${chatRatio}%` } as React.CSSProperties}
        >
            <section className="build-chat-column" aria-label="Build chat">
                {sessionId && (
                    <SonomaChatShell
                        page="code"
                        modelIds={MODEL_IDS}
                        conversationId={sessionId}
                        transparent
                        composerAtBottom
                        promptEventName={BUILD_PROMPT_EVENT}
                        greeting={BUILD_GREETING}
                        buildWorkspace
                        beforeComposer={questionVisible ? <QuestionSkill question={question} onAnswer={sendPromptToChat} /> : null}
                        onCanvasContentChange={updateCanvas}
                        onMessageSent={() => {
                            setStarted(true);
                            setBuilding(true);
                            window.dispatchEvent(new Event('tripplet:build-message-sent'));
                        }}
                        onResponseSettled={() => setBuilding(false)}
                    />
                )}
                {started && <div className="build-chat-resizer" role="separator" aria-label="Resize Build chat and canvas" onPointerDown={resizeChat} />}
            </section>
            <BuildCanvas started={started} building={building} planMode={planMode} blocks={project.blocks} />
            <button type="button" onClick={() => setFilesOpen(true)} className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-card/90 px-3.5 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent" aria-label="Open Project Files">
                <SonomaProjectFiles size={18} />
                <span>Project Files</span>
            </button>
            {filesOpen && <ProjectFilesModal files={project.files} onClose={() => setFilesOpen(false)} />}
        </div>
    );
}