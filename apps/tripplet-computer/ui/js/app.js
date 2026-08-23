// Application shell: toolbar, sidebar, view router, and event wiring.

import * as api from './api.js'
import { h, mount, toast } from './dom.js'
import { icon } from './icons.js'
import { createChat, showApproval } from './chat.js'
import { createPluginsPage, createSkillsPage, createSettingsPage } from './catalog.js'
import {
    closeAll,
    openPopover,
    popItem,
    popSeparator,
    popSearch,
    popEmpty,
    refreshPopover,
} from './popover.js'

const store = {
    config: {},
    models: [],
    efforts: [],
    approvals: [],
    project: null,
    projects: [],
    threads: [],
    threadId: null,
    messages: [],
    plugins: [],
    installedPlugins: [],
    skills: [],
    busy: false,
    appVersion: '',
    installId: '',
    go: () => {},
    onThreadsChanged: () => {},
    onPluginsChanged: () => {},
}

// ── View history, driving the back/forward arrows ──
const history = { stack: [], index: -1 }

function pushHistory(view) {
    if (history.stack[history.index] === view) return
    history.stack = history.stack.slice(0, history.index + 1)
    history.stack.push(view)
    history.index = history.stack.length - 1
}

// ── Elements ──
const viewHost = h('main#view')
const sidebar = h('aside#sidebar')
const toolbarLeft = h('div.tb-left')
const toolbarMid = h('div.tb-mid')
const toolbarRight = h('div.tb-right')
const toolbar = h('header#toolbar', null, toolbarLeft, toolbarMid, h('div.tb-spacer'), toolbarRight)
const shell = h('div.shell', null, sidebar, viewHost)
const app = h('div#app', null, toolbar, shell)

let current = 'chat'
let sidebarOpen = false
let pages = {}

// ─────────────────────────── Toolbar ───────────────────────────

function tbButton(glyph, title, onClick, { disabled = false, dot = false } = {}) {
    const button = h('button.tb-btn', {
        type: 'button',
        title,
        disabled,
        html: icon(glyph, 17),
        onclick: onClick,
    })
    if (dot) button.append(h('span.dot'))
    return button
}

function renderToolbar() {
    mount(
        toolbarLeft,
        tbButton('sidebar', 'Threads', toggleSidebar, { dot: !sidebarOpen && store.threads.length > 0 }),
        tbButton('back', 'Back', goBack, { disabled: history.index <= 0 }),
        tbButton('forward', 'Forward', goForward, {
            disabled: history.index >= history.stack.length - 1,
        }),
        tbButton('compose', 'New thread', newThread),
    )

    const onCatalog = current === 'plugins' || current === 'skills'
    mount(
        toolbarMid,
        onCatalog
            ? h(
                  'div.segmented',
                  null,
                  ...[
                      ['plugins', 'Plugins'],
                      ['skills', 'Skills'],
                  ].map(([id, label]) =>
                      h('button', {
                          type: 'button',
                          text: label,
                          'aria-selected': String(current === id),
                          onclick: () => go(id),
                      }),
                  ),
              )
            : null,
    )

    if (onCatalog) {
        mount(
            toolbarRight,
            tbButton('refresh', 'Refresh', () => pages[current]?.refresh()),
            tbButton('gear', 'Settings', () => go('settings')),
            h(
                'button.tb-add',
                {
                    type: 'button',
                    onclick: (event) => openAddMenu(event.currentTarget),
                },
                h('span', { text: 'Add' }),
                h('span', { html: icon('chevronDown', 14) }),
            ),
        )
    } else if (current === 'settings') {
        mount(
            toolbarRight,
            tbButton('x', 'Close settings', () => go('chat')),
        )
    } else {
        mount(
            toolbarRight,
            tbButton('panelRight', 'Plugins & Skills', () => go('plugins')),
        )
    }
}

function openAddMenu(anchor) {
    openPopover({
        anchor,
        align: 'end',
        minWidth: 210,
        build: (close) => [
            popItem({
                glyph: 'puzzle',
                title: 'Connect an app',
                onClick: () => {
                    close()
                    go('plugins')
                },
            }),
            popItem({
                glyph: 'spark',
                title: 'New skill',
                onClick: () => {
                    close()
                    api.openSkillsFolder().catch((err) => toast(String(err), 'error'))
                },
            }),
            popSeparator(),
            popItem({
                glyph: 'folder',
                title: 'Open a project',
                onClick: async () => {
                    close()
                    try {
                        const picked = await api.chooseProject()
                        if (!picked) return
                        store.project = await api.openProject(picked)
                        store.projects = await api.listProjects()
                        pages.chat?.refreshComposer()
                        toast(`Opened ${store.project.name}`)
                    } catch (err) {
                        toast(String(err), 'error')
                    }
                },
            }),
        ],
    })
}

// ─────────────────────────── Sidebar ───────────────────────────

function toggleSidebar() {
    sidebarOpen = !sidebarOpen
    shell.classList.toggle('sidebar-open', sidebarOpen)
    renderToolbar()
    if (sidebarOpen) renderSidebar()
}

function renderSidebar() {
    if (!sidebarOpen) return

    // Threads that belong to a project are nested under it; the rest fall
    // through to Recents. A thread whose project has since been forgotten
    // still shows up in Recents rather than vanishing.
    const projects = (store.projects || []).slice(0, 6)
    const byProject = new Map(projects.map((p) => [p.path, []]))
    const recents = []
    for (const thread of store.threads) {
        const bucket = thread.project_path && byProject.get(thread.project_path)
        if (bucket) bucket.push(thread)
        else recents.push(thread)
    }

    const threadRow = (thread, nested) =>
        h(
            'button.sb-row',
            {
                type: 'button',
                class: [nested ? 'sb-child' : '', thread.id === store.threadId ? 'active' : '']
                    .filter(Boolean)
                    .join(' '),
                title: thread.title,
                onclick: () => openThread(thread.id),
                oncontextmenu: (event) => {
                    event.preventDefault()
                    openThreadMenu(event.currentTarget, thread)
                },
            },
            !nested ? h('span.glyph', { html: icon('compose', 15) }) : null,
            h('span.label', { text: thread.title }),
            // The blue pip marks the thread that is currently working.
            store.busy && thread.id === store.threadId ? h('span.pip') : null,
        )

    mount(
        sidebar,
        h(
            'div.sb-top',
            null,
            h(
                'button.sb-workspace',
                {
                    type: 'button',
                    title: 'Switch project',
                    onclick: (event) => openWorkspaceMenu(event.currentTarget),
                },
                h('span.name', { text: store.project ? store.project.name : 'Tripplet' }),
                h('span', { html: icon('chevronDown', 16) }),
            ),
            h('button.sb-icon', {
                type: 'button',
                title: 'Search threads',
                html: icon('search', 17),
                onclick: (event) => openThreadSearch(event.currentTarget),
            }),
            (() => {
                const bell = h('button.sb-icon', {
                    type: 'button',
                    title: store.busy ? 'A turn is running' : 'Nothing new',
                    html: icon('bell', 17),
                    onclick: () =>
                        toast(store.busy ? 'A turn is running.' : 'Nothing new right now.'),
                })
                if (store.busy) bell.append(h('span.dot'))
                return bell
            })(),
        ),

        h(
            'div.sb-scroll',
            null,
            h(
                'div.sb-nav',
                null,
                h(
                    'button.sb-row',
                    { type: 'button', onclick: newThread },
                    h('span.glyph', { html: icon('compose', 17) }),
                    h('span.label', { text: 'New chat' }),
                ),
                h(
                    'button.sb-row',
                    {
                        type: 'button',
                        onclick: () =>
                            toast('Scheduled runs are not wired up yet.'),
                    },
                    h('span.glyph', { html: icon('clock', 17) }),
                    h('span.label', { text: 'Scheduled' }),
                ),
                h(
                    'button.sb-row',
                    { type: 'button', class: current === 'plugins' ? 'active' : '', onclick: () => go('plugins') },
                    h('span.glyph', { html: icon('plug', 17) }),
                    h('span.label', { text: 'Plugins' }),
                ),
            ),

            projects.length ? h('div.sb-section', { text: 'Projects' }) : null,
            ...projects.flatMap((project) => {
                const threads = byProject.get(project.path) || []
                return [
                    h(
                        'button.sb-row',
                        {
                            type: 'button',
                            class: store.project?.path === project.path ? 'active' : '',
                            title: project.path,
                            onclick: () => selectProject(project),
                        },
                        h('span.glyph', {
                            html: icon(project.exists ? 'folder' : 'terminal', 17),
                        }),
                        h('span.label', { text: project.name }),
                    ),
                    ...threads.slice(0, 6).map((thread) => threadRow(thread, true)),
                    threads.length ? null : h('div.sb-empty', { text: 'No chats' }),
                ]
            }),

            recents.length ? h('div.sb-section', { text: 'Recents' }) : null,
            ...recents.slice(0, 30).map((thread) => threadRow(thread, false)),

            store.threads.length || projects.length
                ? null
                : h('div.cat-empty', { text: 'No threads yet' }),
        ),

        h(
            'div.sb-foot',
            null,
            h(
                'button.model',
                {
                    type: 'button',
                    title: 'Model and effort',
                    onclick: () => go('settings'),
                },
                h('span', { html: icon('gear', 16) }),
                h('span.label', { text: store.config.model_name || 'Model' }),
            ),
            h('button.sb-icon', {
                type: 'button',
                title: 'Help',
                html: icon('help', 17),
                onclick: () =>
                    globalThis.__TAURI__?.opener
                        ?.openUrl('https://tripplet.lol/computer')
                        .catch(() => {}),
            }),
        ),
    )
}

async function selectProject(project) {
    if (!project.exists) {
        toast(`${project.name} is no longer on disk.`, 'error')
        return
    }
    try {
        store.project = await api.openProject(project.path)
        pages.chat?.refreshComposer()
        renderSidebar()
        toast(`Opened ${store.project.name}`)
    } catch (err) {
        toast(String(err), 'error')
    }
}

function openWorkspaceMenu(anchor) {
    openPopover({
        anchor,
        align: 'start',
        minWidth: 240,
        build: (close) => [
            ...(store.projects || []).slice(0, 10).map((project) =>
                popItem({
                    glyph: project.exists ? 'folder' : 'x',
                    title: project.name,
                    checked: store.project?.path === project.path,
                    onClick: () => {
                        close()
                        selectProject(project)
                    },
                }),
            ),
            popSeparator(),
            popItem({
                glyph: 'plus',
                title: 'Open a project…',
                onClick: async () => {
                    close()
                    try {
                        const picked = await api.chooseProject()
                        if (!picked) return
                        store.project = await api.openProject(picked)
                        store.projects = await api.listProjects()
                        pages.chat?.refreshComposer()
                        renderSidebar()
                    } catch (err) {
                        toast(String(err), 'error')
                    }
                },
            }),
        ],
    })
}

function openThreadSearch(anchor) {
    let query = ''
    const build = (close) => {
        const q = query.trim().toLowerCase()
        const matches = store.threads
            .filter((t) => !q || t.title.toLowerCase().includes(q))
            .slice(0, 12)
        return [
            popSearch('Search threads', query, (value) => {
                query = value
                refreshPopover(0, build)
            }),
            ...(matches.length
                ? matches.map((thread) =>
                      popItem({
                          glyph: 'compose',
                          title: thread.title,
                          onClick: () => {
                              close()
                              openThread(thread.id)
                          },
                      }),
                  )
                : [popEmpty('No threads match')]),
        ]
    }
    openPopover({ anchor, build, align: 'start', minWidth: 260 })
}

function openThreadMenu(anchor, thread) {
    openPopover({
        anchor,
        align: 'start',
        minWidth: 190,
        build: (close) => [
            popItem({
                glyph: 'pencil',
                title: 'Rename…',
                onClick: async () => {
                    close()
                    const title = prompt('Rename thread', thread.title)
                    if (!title || !title.trim()) return
                    try {
                        await api.renameThread(thread.id, title.trim())
                        await refreshThreads()
                    } catch (err) {
                        toast(String(err), 'error')
                    }
                },
            }),
            popSeparator(),
            popItem({
                glyph: 'trash',
                title: 'Delete thread',
                onClick: async () => {
                    close()
                    try {
                        await api.deleteThread(thread.id)
                        if (store.threadId === thread.id) {
                            store.threadId = null
                            store.messages = []
                            pages.chat?.render()
                        }
                        await refreshThreads()
                    } catch (err) {
                        toast(String(err), 'error')
                    }
                },
            }),
        ],
    })
}

// ─────────────────────────── Routing ───────────────────────────

function go(view, { record = true } = {}) {
    closeAll()
    current = view
    if (record) pushHistory(view)
    renderToolbar()
    const page = pages[view]
    if (!page) return
    mount(viewHost, page.el)
    page.load?.()
    if (view === 'chat') pages.chat.focus()
}

function goBack() {
    if (history.index <= 0) return
    history.index -= 1
    go(history.stack[history.index], { record: false })
}

function goForward() {
    if (history.index >= history.stack.length - 1) return
    history.index += 1
    go(history.stack[history.index], { record: false })
}

store.go = go

// ─────────────────────────── Threads ───────────────────────────

async function refreshThreads() {
    try {
        store.threads = await api.listThreads()
    } catch (err) {
        toast(String(err), 'error')
    }
    renderSidebar()
    renderToolbar()
    pages.chat?.renderHead()
}

store.onThreadsChanged = refreshThreads

async function openThread(id) {
    store.threadId = id
    try {
        store.messages = await api.getThread(id)
    } catch (err) {
        toast(String(err), 'error')
        store.messages = []
    }
    go('chat')
    pages.chat.render()
    renderSidebar()
}

async function newThread() {
    try {
        const thread = await api.createThread()
        store.threadId = thread.id
        store.messages = []
        go('chat')
        pages.chat.render()
        await refreshThreads()
    } catch (err) {
        toast(String(err), 'error')
    }
}

// ─────────────────────────── Boot ───────────────────────────

async function boot() {
    document.body.append(app)

    if (!api.isNative()) {
        mount(
            viewHost,
            h('div.view-pad', null, h('div.notice', {
                html:
                    '<strong>Tripplet Computer is a desktop app.</strong> This page is the app’s ' +
                    'interface — run it with <code>npm run dev</code> inside ' +
                    '<code>apps/tripplet-computer</code>.',
            })),
        )
        return
    }

    let data
    try {
        data = await api.bootstrap()
    } catch (err) {
        mount(viewHost, h('div.view-pad', null, h('div.msg.error', { text: String(err) })))
        return
    }

    Object.assign(store, {
        config: data.config,
        models: data.models,
        efforts: data.efforts,
        approvals: data.approvals,
        project: data.project,
        installId: data.install_id,
        appVersion: data.app_version,
    })

    pages = {
        chat: createChat({
            store,
            onOpenPlugins: () => go('plugins'),
            onThreadMenu: (anchor) => {
                const thread = store.threads.find((t) => t.id === store.threadId)
                if (thread) openThreadMenu(anchor, thread)
                else toast('Send a message first — this thread has not been saved yet.')
            },
        }),
        plugins: createPluginsPage({ store }),
        skills: createSkillsPage({ store }),
        settings: createSettingsPage({ store }),
    }

    // Wire live events before anything can produce them.
    api.listen(api.EVENTS.agent, (event) => pages.chat.onAgentEvent(event))
    api.listen(api.EVENTS.renamed, async () => {
        await refreshThreads()
        pages.chat.renderHead()
    })
    api.listen(api.EVENTS.approval, async (prompt) => {
        const allow = await showApproval(prompt)
        api.respondToApproval(prompt.id, allow).catch(() => {})
    })

    go('chat')

    // Background loads — none of these should delay first paint.
    api.listProjects()
        .then((projects) => {
            store.projects = projects
        })
        .catch(() => {})
    api.listPlugins()
        .then((plugins) => {
            store.plugins = plugins
            store.installedPlugins = plugins.filter((p) => p.installed)
            pages.chat.refreshComposer()
        })
        .catch(() => {})
    refreshThreads()

}

// ── Global shortcuts ──
document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) return
    if (event.key === 'n') {
        event.preventDefault()
        newThread()
    } else if (event.key === ',') {
        event.preventDefault()
        go('settings')
    } else if (event.key === 'b') {
        event.preventDefault()
        toggleSidebar()
    }
})

// Links inside assistant messages open in the real browser, not the webview.
document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href^="http"]')
    if (!anchor) return
    event.preventDefault()
    globalThis.__TAURI__?.opener?.openUrl(anchor.href).catch(() => {})
})

boot()
