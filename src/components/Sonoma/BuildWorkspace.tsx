'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MailPlus, Pencil, Plus, Users, X } from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AnvilIcon } from '@hugeicons/core-free-icons';
import { useChatActions, useChatConversations } from '@/context/ChatContext';
import SonomaChatShell from './ChatShell';

const MODEL_IDS = ['astro-5', 'taipei4', 'majuli4', 'suzhou4'];
type SplitDirection = 'left' | 'right' | 'up' | 'down';
type Pane = { id: string; sessionId?: string };

export default function BuildWorkspace({ conversationId }: { conversationId?: string }) {
    const router = useRouter();
    const { conversations } = useChatConversations();
    const { createConversation, renameConversation, selectConversation } = useChatActions();
    const [openTabs, setOpenTabs] = useState<string[]>(conversationId ? [conversationId] : []);
    const [panes, setPanes] = useState<Pane[]>([{ id: 'main', sessionId: conversationId }]);
    const [activePaneId, setActivePaneId] = useState('main');
    const [split, setSplit] = useState<'rows' | 'columns'>('columns');
    const [renameId, setRenameId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteError, setInviteError] = useState('');
    const [incomingInvite, setIncomingInvite] = useState<{ id: string; inviter_email: string; conversation_id: string } | null>(null);
    const bootstrapped = useRef(false);
    const openSessions = useMemo(() => openTabs.map((id) => conversations.find((session) => session.id === id)).filter(Boolean), [openTabs, conversations]);

    useEffect(() => {
        if (!conversationId) return;
        setOpenTabs((current) => current.includes(conversationId) ? current : [...current, conversationId]);
        setPanes((current) => current.map((pane) => pane.id === 'main' ? { ...pane, sessionId: conversationId } : pane));
    }, [conversationId]);

    useEffect(() => {
        if (conversationId || bootstrapped.current) return;
        bootstrapped.current = true;
        const id = createConversation(MODEL_IDS[0]);
        if (!id) return;
        setOpenTabs([id]);
        setPanes([{ id: 'main', sessionId: id }]);
    }, [conversationId, createConversation]);

    useEffect(() => {
        const check = () => fetch('/api/collaborators/invite').then((response) => response.ok ? response.json() : null).then((data: { invites?: { id: string; inviter_email: string; conversation_id: string }[] } | null) => { if (data?.invites?.[0]) setIncomingInvite(data.invites[0]); }).catch(() => {});
        void check();
        const timer = window.setInterval(check, 15000);
        return () => window.clearInterval(timer);
    }, []);

    const sendInvite = async () => {
        setInviteError('');
        const conversationId = panes.find((pane) => pane.id === activePaneId)?.sessionId;
        const response = await fetch('/api/collaborators/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, conversationId }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); setInviteError(String(data.error || 'Could not send invite')); return; }
        setInviteEmail('');
        setInviteOpen(false);
    };
    const answerInvite = async (status: 'accepted' | 'declined') => { if (!incomingInvite) return; await fetch('/api/collaborators/invite', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: incomingInvite.id, status }) }); if (status === 'accepted') window.location.assign(`/build/${incomingInvite.conversation_id}`); else setIncomingInvite(null); };

    const selectTab = (id: string) => {
        selectConversation(id);
        setPanes((current) => current.map((pane) => pane.id === activePaneId ? { ...pane, sessionId: id } : pane));
    };
    const newSession = () => {
        const id = createConversation(MODEL_IDS[0]);
        if (!id) return;
        setOpenTabs((current) => current.includes(id) ? current : [...current, id]);
        selectTab(id);
    };
    const closeTab = (id: string) => {
        setOpenTabs((current) => current.filter((tabId) => tabId !== id));
        setPanes((current) => current.map((pane) => pane.sessionId === id ? { ...pane, sessionId: undefined } : pane));
    };
    const splitPane = (direction: SplitDirection, sessionId: string) => {
        setContextMenu(null);
        setSplit(direction === 'left' || direction === 'right' ? 'columns' : 'rows');
        setPanes((current) => {
            if (current.length >= 2) return current;
            const next: Pane = { id: `pane_${Date.now()}`, sessionId };
            return direction === 'left' || direction === 'up' ? [next, ...current] : [...current, next];
        });
    };

    return <div className="oc-build-root" onClick={() => setContextMenu(null)} onContextMenu={(event) => { if (!(event.target as HTMLElement).closest('.oc-tab-slot')) event.preventDefault(); }}>
        <div className="oc-titlebar">
            <div className="oc-titlebar-brand"><span className="oc-mark"><HugeiconsIcon icon={AnvilIcon} size={13} strokeWidth={1.8} /></span><span>Build</span></div>
            <div className="oc-tabs" data-titlebar-tab-list>
                {openSessions.map((session) => session && <div key={session.id} className="oc-tab-slot" data-active={panes.some((pane) => pane.sessionId === session.id && pane.id === activePaneId)}><button className="oc-tab" data-titlebar-tab onClick={() => selectTab(session.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ id: session.id, x: event.clientX, y: event.clientY }); }}><span className="oc-tab-avatar">{(session.title || 'U').slice(0, 1).toUpperCase()}</span><span className="oc-tab-title">{session.title || 'Untitled session'}</span><span className="oc-tab-actions"><span className="oc-tab-rename" aria-label="Rename session" onClick={(event) => { event.stopPropagation(); setRenameId(session.id); setName(session.title || ''); }}><Pencil size={12} /></span><span className="oc-tab-close" aria-label="Close session" onClick={(event) => { event.stopPropagation(); closeTab(session.id); }}><X size={13} /></span></span></button></div>)}
                <button className="oc-titlebar-action" onClick={newSession} aria-label="New session"><Plus size={16} /></button>
            </div>
            <button className="oc-titlebar-action" onClick={() => setInviteOpen(true)} aria-label="Invite collaborator"><Users size={15} /></button><button className="oc-titlebar-action" onClick={() => router.push('/chat')} aria-label="Close build"><X size={15} /></button>
        </div>
        <main className={`oc-main oc-pane-grid ${panes.length > 1 ? `oc-pane-${split}` : 'oc-pane-single'}`}>
            {panes.map((pane) => <section key={pane.id} className={`oc-chat-pane ${pane.id === activePaneId ? 'active' : ''}`} onMouseDown={() => setActivePaneId(pane.id)}>{pane.sessionId ? <SonomaChatShell page="code" modelIds={MODEL_IDS} conversationId={pane.sessionId} /> : <div className="oc-pane-empty"><button onClick={newSession}><Plus size={16} />New chat</button></div>}</section>)}
        </main>
        {contextMenu && <div className="oc-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>{(['left', 'right', 'up', 'down'] as SplitDirection[]).map((direction) => <button key={direction} onClick={() => splitPane(direction, contextMenu.id)}>Split {direction}</button>)}</div>}
        {inviteOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'color-mix(in oklch, var(--sonoma-bg) 55%, rgba(0,0,0,0.45))' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false); }}><form className="w-full max-w-[380px] rounded-[16px] p-4" style={{ background: 'var(--sonoma-bg)', border: '1px solid var(--sonoma-border)', boxShadow: 'var(--sonoma-shadow-lg)' }} onSubmit={(event) => { event.preventDefault(); void sendInvite(); }}><div className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: 'var(--sonoma-ink)' }}><MailPlus size={16} />Invite collaborator</div><input autoFocus type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" className="mt-3 w-full rounded-[10px] px-3 py-2 text-[14px] outline-none" style={{ background: 'var(--sonoma-bg-2)', border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink)' }} />{inviteError && <div className="mt-2 text-[12px]" style={{ color: 'var(--sonoma-danger, #b33)' }}>{inviteError}</div>}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setInviteOpen(false)} className="rounded-full px-3.5 py-1.5 text-[12.5px]" style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)' }}>Cancel</button><button type="submit" className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium" style={{ background: 'var(--sonoma-accent)', color: '#fff' }}>Invite</button></div></form></div>}
        {incomingInvite && <div className="oc-invite-toast"><div className="text-[13px] font-semibold">Collaboration invite</div><div className="mt-1 text-[12px]" style={{ color: 'var(--sonoma-muted)' }}>{incomingInvite.inviter_email} invited you to collaborate.</div><div className="mt-3 flex justify-end gap-2"><button onClick={() => void answerInvite('declined')}>Decline</button><button className="primary" onClick={() => void answerInvite('accepted')}>Accept</button></div></div>}
        {renameId && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'color-mix(in oklch, var(--sonoma-bg) 55%, rgba(0,0,0,0.45))' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameId(null); }}><form className="w-full max-w-[380px] rounded-[16px] p-4" style={{ background: 'var(--sonoma-bg)', border: '1px solid var(--sonoma-border)', boxShadow: 'var(--sonoma-shadow-lg)' }} onSubmit={(event) => { event.preventDefault(); renameConversation(renameId, name); setRenameId(null); }}><div className="text-[14px] font-semibold" style={{ color: 'var(--sonoma-ink)' }}>Rename project</div><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-3 w-full rounded-[10px] px-3 py-2 text-[14px] outline-none" style={{ background: 'var(--sonoma-bg-2)', border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink)' }} /><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setRenameId(null)} className="rounded-full px-3.5 py-1.5 text-[12.5px]" style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)' }}>Cancel</button><button type="submit" className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium" style={{ background: 'var(--sonoma-accent)', color: 'var(--sonoma-accent-ink, #fff)' }}>Rename</button></div></form></div>}
    </div>;
}
