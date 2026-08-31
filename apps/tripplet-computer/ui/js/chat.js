// The conversation view: transcript, live turn rendering, approval sheet.

import * as api from './api.js'
import { h, mount, clear, toast } from './dom.js'
import { icon } from './icons.js'
import { renderMarkdown } from './markdown.js'
import { createComposer } from './composer.js'

/** Tool name → activity-row glyph. */
const TOOL_GLYPH = {
    read_file: 'file',
    write_file: 'pencil',
    edit_file: 'pencil',
    list_dir: 'folder',
    search_files: 'search',
    run_command: 'terminal',
    fetch_url: 'globe',
    web_search: 'search',
}

export function createChat({ store, onOpenPlugins, onThreadMenu }) {
    const thread = h('div.thread')
    const scroller = h('div.chat-scroll', null, thread)
    const dock = h('div.composer-dock')
    const head = h('div.chat-head')
    const el = h('div.chat', null, head, scroller, dock)

    const composer = createComposer({
        store,
        onOpenPlugins,
        onSend: (text) => send(text),
        onStop: () => stop(),
    })

    /** Live turn scratch state, cleared on every terminal event. */
    let live = null
    let pinned = true

    scroller.addEventListener('scroll', () => {
        const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        pinned = distance < 80
    })

    function scrollToEnd(force = false) {
        if (!force && !pinned) return
        requestAnimationFrame(() => {
            scroller.scrollTop = scroller.scrollHeight
        })
    }

    // ── Rendering ──

    function renderHead() {
        const title =
            store.threads?.find((t) => t.id === store.threadId)?.title || 'New thread'
        mount(
            head,
            h('div.title', { text: title }),
            h(
                'div.tools',
                null,
                store.busy ? h('span.ring') : null,
                h('button', {
                    type: 'button',
                    title: 'Thread actions',
                    html: icon('more', 17),
                    onclick: (event) => onThreadMenu?.(event.currentTarget),
                }),
            ),
        )
    }

    function render() {
        const empty = store.messages.length === 0 && !live
        el.classList.toggle('empty', empty)
        renderHead()

        if (empty) {
            mount(
                dock,
                h(
                    'div.home',
                    null,
                    h('h1', { text: 'What should we work on?' }),
                    composer.el,
                ),
            )
            clear(thread)
        } else {
            mount(dock, composer.el)
            mount(thread, ...store.messages.map(renderMessage))
            if (live) thread.append(live.node)
        }
        composer.refresh()
        scrollToEnd(true)
    }

    function renderMessage(message) {
        if (message.role === 'user') {
            return h('div.msg.user', { text: message.content })
        }
        const node = h('div.msg.assistant')
        node.innerHTML = renderMarkdown(message.content)
        const meta = message.meta || {}
        if (meta.cancelled) {
            node.append(h('div.act', null, h('span.glyph', { html: icon('stop', 12) }), 'Stopped'))
        }
        if (meta.hit_step_limit) {
            node.append(
                h(
                    'div.act',
                    null,
                    h('span.glyph', { html: icon('x', 12) }),
                    `Stopped after ${meta.steps} steps`,
                ),
            )
        }
        return node
    }

    // ── Live turn ──

    function beginLive(event) {
        const activity = h('div.activity')
        const fleet = h('div.fleet', { style: { display: 'none' } })
        const thinking = h('details.thinking', { style: { display: 'none' } })
        const thinkingBody = h('div.body')
        thinking.append(h('summary', { text: 'Thinking' }), thinkingBody)
        const body = h('div.msg.assistant')

        const node = h('div.live', null, fleet, thinking, activity, body)
        live = {
            id: event.message_id,
            node,
            activity,
            fleet,
            fleetTasks: new Map(),
            thinking,
            thinkingBody,
            body,
            text: '',
            reasoning: '',
            tools: new Map(),
        }
        if (store.messages.length === 0) render()
        else thread.append(node)
        scrollToEnd(true)
    }

    function endLive() {
        live = null
    }

    function onAgentEvent(event) {
        if (event.thread_id && event.thread_id !== store.threadId) return
        if (live && event.message_id && event.message_id !== live.id && event.type !== 'turn-started') {
            // A stale event from a turn that has already been replaced.
            return
        }

        switch (event.type) {
            case 'turn-started':
                if (event.thread_id !== store.threadId) return
                composer.setBusy(true)
                renderHead()
                beginLive(event)
                break

            case 'content':
                if (!live) return
                live.text += event.delta
                live.body.innerHTML = renderMarkdown(live.text)
                scrollToEnd()
                break

            case 'reasoning':
                if (!live) return
                live.reasoning += event.delta
                live.thinking.style.display = ''
                live.thinkingBody.textContent = live.reasoning
                live.thinkingBody.scrollTop = live.thinkingBody.scrollHeight
                scrollToEnd()
                break

            case 'tool-started': {
                if (!live) return
                const row = h(
                    'div.act.running',
                    null,
                    h('span.glyph', { html: icon(TOOL_GLYPH[event.name] || 'spark', 13) }),
                    h('span', { text: event.label }),
                )
                live.tools.set(event.call_id, row)
                live.activity.append(row)
                scrollToEnd()
                break
            }

            case 'tool-finished': {
                if (!live) return
                const row = live.tools.get(event.call_id)
                if (!row) return
                row.classList.remove('running')
                row.classList.toggle('failed', !event.ok)
                row.lastChild.textContent = event.summary
                scrollToEnd()
                break
            }

            case 'fleet-planned': {
                if (!live) return
                live.fleet.style.display = ''
                const grid = h('div.fleet-grid')
                live.fleetTasks.clear()
                for (const task of event.tasks) {
                    const row = h(
                        'div.fleet-task.pending',
                        { title: task.brief },
                        h('span.pip'),
                        h('span.lens', { text: task.lens }),
                    )
                    live.fleetTasks.set(task.id, row)
                    grid.append(row)
                }
                mount(
                    live.fleet,
                    h(
                        'div.fleet-head',
                        null,
                        h('span', { html: icon('fleet', 14) }),
                        h('span', { text: `${event.tasks.length} subagents investigating` }),
                    ),
                    grid,
                )
                scrollToEnd()
                break
            }

            case 'fleet-progress': {
                const row = live?.fleetTasks.get(event.task_id)
                if (!row) return
                row.classList.remove('pending', 'running', 'done', 'failed')
                row.classList.add(event.status)
                if (event.note) row.title = event.note
                break
            }

            case 'fleet-done': {
                if (!live) return
                const head = live.fleet.querySelector('.fleet-head span:last-child')
                if (head) {
                    head.textContent = `${event.completed} of ${
                        event.completed + event.failed
                    } subagents reported`
                }
                break
            }

            case 'step-limit':
                if (!live) return
                live.activity.append(
                    h(
                        'div.act.failed',
                        null,
                        h('span.glyph', { html: icon('x', 13) }),
                        h('span', { text: `Stopped after ${event.steps} steps` }),
                    ),
                )
                break

            case 'turn-finished':
                composer.setBusy(false)
                renderHead()
                endLive()
                reload()
                break

            case 'turn-cancelled':
                composer.setBusy(false)
                renderHead()
                endLive()
                reload()
                toast('Stopped')
                break

            case 'turn-failed':
                composer.setBusy(false)
                renderHead()
                endLive()
                thread.append(h('div.msg.error', { text: event.error }))
                scrollToEnd(true)
                break
        }
    }

    // ── Actions ──

    async function send(text) {
        if (!store.threadId) {
            try {
                const created = await api.createThread()
                store.threadId = created.id
                store.onThreadsChanged?.()
            } catch (err) {
                toast(String(err), 'error')
                return
            }
        }
        // Show the user's message immediately; the turn confirms it server-side.
        store.messages.push({ role: 'user', content: text, meta: {} })
        render()
        try {
            await api.sendMessage(store.threadId, text)
        } catch (err) {
            composer.setBusy(false)
            store.messages.pop()
            render()
            thread.append(h('div.msg.error', { text: String(err) }))
            scrollToEnd(true)
        }
    }

    function stop() {
        if (store.threadId) api.cancelTurn(store.threadId).catch(() => {})
    }

    async function reload() {
        if (!store.threadId) return render()
        try {
            store.messages = await api.getThread(store.threadId)
        } catch (err) {
            toast(String(err), 'error')
        }
        render()
        store.onThreadsChanged?.()
    }

    render()

    return {
        el,
        render,
        renderHead,
        reload,
        onAgentEvent,
        focus: () => composer.focus(),
        refreshComposer: () => composer.refresh(),
    }
}

// ─────────────────────────── Approval sheet ───────────────────────────

const RISK_COPY = {
    safe: 'Routine',
    elevated: 'Needs review',
    dangerous: 'Potentially destructive',
}

const KIND_TITLE = {
    'file-read': 'Read a file',
    'file-write': 'Write a file',
    command: 'Run a command',
    network: 'Use the network',
    connector: 'Use a connected app',
}

/** Render the modal the agent blocks on. Resolves when the user answers. */
export function showApproval(prompt) {
    return new Promise((resolve) => {
        const answer = (allow) => {
            backdrop.remove()
            document.removeEventListener('keydown', onKey)
            resolve(allow)
        }

        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                answer(false)
            }
            if (event.key === 'Enter' && event.metaKey) {
                event.preventDefault()
                answer(true)
            }
        }

        const allowBtn = h('button.btn', {
            type: 'button',
            class: prompt.risk === 'dangerous' ? 'danger' : 'primary',
            text: 'Allow',
            onclick: () => answer(true),
        })

        const sheet = h(
            'div.sheet',
            { role: 'dialog', 'aria-modal': 'true' },
            h('h2', { text: prompt.title || KIND_TITLE[prompt.kind] || 'Allow this action?' }),
            h('div.reason', { text: prompt.reason }),
            h('span.risk', {
                class: prompt.risk,
                text: RISK_COPY[prompt.risk] || prompt.risk,
            }),
            h('div.detail', { text: prompt.detail }),
            h(
                'div.sheet-actions',
                null,
                h('button.btn', { type: 'button', text: 'Deny', onclick: () => answer(false) }),
                allowBtn,
            ),
        )

        const backdrop = h('div.sheet-backdrop', null, sheet)
        backdrop.addEventListener('pointerdown', (event) => {
            if (event.target === backdrop) answer(false)
        })
        document.body.append(backdrop)
        document.addEventListener('keydown', onKey)
        // Focus Deny, not Allow: the safe answer should be the one a stray
        // Return key produces.
        setTimeout(() => backdrop.querySelector('.btn')?.focus(), 0)
    })
}
