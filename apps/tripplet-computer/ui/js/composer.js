// The composer: input, approval chip, model/effort readout, send, and the
// project · plugins footer bar beneath it.

import * as api from './api.js'
import { h, autosize, toast } from './dom.js'
import { icon, slugColor } from './icons.js'
import {
    openPopover,
    popItem,
    popLabel,
    popSearch,
    popSeparator,
    popHeader,
    popEmpty,
    refreshPopover,
} from './popover.js'

/** Icon for the approval chip, matching the mode. */
const APPROVAL_GLYPH = {
    'ask-for-approval': 'hand',
    'approve-for-me': 'shield',
    custom: 'sliders',
}

export function createComposer({ store, onSend, onStop, onOpenPlugins }) {
    const textarea = h('textarea', {
        placeholder: 'Ask anything, / for commands, @ for context…',
        rows: '1',
        spellcheck: 'true',
        oninput: () => {
            autosize(textarea)
            syncSend()
        },
        onkeydown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault()
                submit()
            }
        },
    })

    const plusBtn = h('button.chip.chip-icon', {
        type: 'button',
        title: 'Plugins',
        'aria-expanded': 'false',
        html: icon('plus', 17),
        onclick: () => openPluginsMenu(plusBtn),
    })

    const approvalBtn = h('button.chip', { type: 'button', 'aria-expanded': 'false' })
    approvalBtn.addEventListener('click', () => openApprovalMenu(approvalBtn))

    const modelBtn = h('button.chip.chip-model', { type: 'button', 'aria-expanded': 'false' })
    modelBtn.addEventListener('click', () => openModelSubmenu(modelBtn, 0))

    const effortBtn = h('button.chip.chip-model', { type: 'button', 'aria-expanded': 'false' })
    effortBtn.addEventListener('click', () => openEffortSubmenu(effortBtn, 0))

    const sendBtn = h('button.send', {
        type: 'button',
        title: 'Send',
        html: icon('send', 16),
        onclick: () => (store.busy ? onStop?.() : submit()),
    })

    const projectBtn = h('button.foot-btn', { type: 'button', 'aria-expanded': 'false' })
    projectBtn.addEventListener('click', () => openProjectMenu(projectBtn))

    const pluginsBtn = h('button.foot-btn', {
        type: 'button',
        onclick: () => onOpenPlugins?.(),
    })

    const runtimeBtn = h('button.tb-btn', {
        type: 'button',
        title: 'Runtime',
        html: icon('laptop', 17),
        onclick: () => {
            const project = store.project
            toast(
                project
                    ? `Running locally in ${project.name}`
                    : 'No project open — choose one to give the agent files and a shell.',
            )
        },
    })

    const row = h(
        'div.composer-row',
        null,
        plusBtn,
        approvalBtn,
        modelBtn,
        effortBtn,
        h('div.spacer'),
        sendBtn,
    )
    const composer = h('div.composer', null, textarea, row)
    const foot = h(
        'div.composer-foot',
        null,
        projectBtn,
        pluginsBtn,
        h('div.spacer', { style: { flex: '1 1 auto' } }),
        runtimeBtn,
    )
    const el = h('div.composer-wrap', null, composer, foot)

    function submit() {
        const text = textarea.value.trim()
        if (!text || store.busy) return
        textarea.value = ''
        autosize(textarea)
        syncSend()
        onSend?.(text)
    }

    function syncSend() {
        const ready = textarea.value.trim().length > 0
        sendBtn.classList.toggle('ready', ready && !store.busy)
        sendBtn.classList.toggle('stop', store.busy)
        sendBtn.innerHTML = icon(store.busy ? 'stop' : 'send', 16)
        sendBtn.title = store.busy ? 'Stop' : 'Send'
    }

    function refresh() {
        const { config, project, installedPlugins } = store

        approvalBtn.innerHTML =
            icon(APPROVAL_GLYPH[config.approval] || 'shield', 16) +
            `<span>${approvalLabel(config.approval)}</span>`

        // Model and effort are separate controls, each with its own chevron,
        // so a click lands on the one the user aimed at.
        modelBtn.innerHTML =
            `<span>${escape(config.model_name)}</span>` + icon('chevronDown', 13)
        effortBtn.innerHTML =
            `<span>${escape(config.effort_label)}</span>` + icon('chevronDown', 13)

        projectBtn.innerHTML =
            icon('folder', 16) +
            `<span class="label">${escape(project ? project.name : 'Choose project')}</span>`

        const stack = (installedPlugins || []).slice(0, 3)
        pluginsBtn.innerHTML =
            `<span class="icon-stack">${stack.map(pluginTile).join('')}</span>` +
            `<span class="label">Plugins</span>`

        syncSend()
    }

    // ── Menus ──

    function openPluginsMenu(anchor) {
        let query = ''
        const build = (close) => {
            const all = store.plugins || []
            const installed = all.filter((p) => p.installed && p.enabled !== false)
            const matching = installed.filter((p) =>
                p.name.toLowerCase().includes(query.trim().toLowerCase()),
            )
            return [
                popSearch('Search plugins...', query, (value) => {
                    query = value
                    refreshPopover(0, build)
                }),
                ...(matching.length
                    ? matching.map((plugin) =>
                          popItem({
                              art: tileNode(plugin, 17),
                              title: plugin.name,
                              onClick: () => {
                                  close()
                                  onOpenPlugins?.(plugin.slug)
                              },
                          }),
                      )
                    : [popEmpty(installed.length ? 'No matches' : 'No plugins installed')]),
                popSeparator(),
                popItem({
                    glyph: 'plug',
                    title: 'Connect plugins',
                    chevron: true,
                    onClick: () => {
                        close()
                        onOpenPlugins?.()
                    },
                }),
            ]
        }
        openPopover({ anchor, build, side: 'top', align: 'start', minWidth: 250 })
    }

    function openApprovalMenu(anchor) {
        openPopover({
            anchor,
            side: 'bottom',
            align: 'start',
            minWidth: 340,
            build: (close) => [
                popHeader('How should Tripplet actions be approved?', 'Learn more', () =>
                    openExternal('https://tripplet.ai/computer#approvals'),
                ),
                ...store.approvals.map((mode) =>
                    popItem({
                        glyph: APPROVAL_GLYPH[mode.id] || 'shield',
                        title: mode.label,
                        sub: mode.description,
                        checked: store.config.approval === mode.id,
                        onClick: async () => {
                            close()
                            try {
                                store.config = await api.setApproval(mode.id)
                                refresh()
                            } catch (err) {
                                toast(String(err), 'error')
                            }
                        },
                    }),
                ),
            ],
        })
    }

    function openModelMenu(anchor) {
        openPopover({
            anchor,
            side: 'top',
            align: 'end',
            minWidth: 210,
            build: () => [
                popItem({
                    title: 'Model',
                    value: store.config.model_name,
                    chevron: true,
                    onHover: (row) => openModelSubmenu(row),
                    onClick: (event) => openModelSubmenu(event.currentTarget),
                }),
                popItem({
                    title: 'Effort',
                    value: store.config.effort_label,
                    chevron: true,
                    onHover: (row) => openEffortSubmenu(row),
                    onClick: (event) => openEffortSubmenu(event.currentTarget),
                }),
            ],
        })
    }

    function openModelSubmenu(anchor, depth = 1) {
        openPopover({
            anchor,
            side: depth === 0 ? 'top' : 'left',
            depth,
            minWidth: 230,
            build: (close) => [
                popLabel('Model'),
                ...store.models.map((model) =>
                    popItem({
                        title: model.name,
                        checked: store.config.model === model.id,
                        onClick: async () => {
                            close()
                            try {
                                store.config = await api.setModel(model.id)
                                refresh()
                            } catch (err) {
                                toast(String(err), 'error')
                            }
                        },
                    }),
                ),
            ],
        })
    }

    function openEffortSubmenu(anchor, depth = 1) {
        openPopover({
            anchor,
            side: depth === 0 ? 'top' : 'left',
            depth,
            minWidth: 250,
            build: (close) => [
                popLabel('Effort'),
                ...store.efforts.map((effort) =>
                    popItem({
                        title: effort.label,
                        // Naming the fleet size is the only honest way to show
                        // that Ultra is a different shape, not just "more".
                        value: effort.subagents ? `${effort.subagents} agents` : '',
                        checked: store.config.effort === effort.id,
                        onClick: async () => {
                            close()
                            try {
                                store.config = await api.setEffort(effort.id)
                                refresh()
                            } catch (err) {
                                toast(String(err), 'error')
                            }
                        },
                    }),
                ),
            ],
        })
    }

    function openProjectMenu(anchor) {
        let query = ''
        const build = (close) => {
            const projects = store.projects || []
            const matching = projects.filter((p) =>
                (p.name + p.path).toLowerCase().includes(query.trim().toLowerCase()),
            )
            return [
                popSearch('Search projects', query, (value) => {
                    query = value
                    refreshPopover(0, build)
                }),
                ...(matching.length
                    ? matching.map((project) =>
                          popItem({
                              glyph: project.exists ? 'folder' : 'x',
                              title: project.name,
                              highlight: store.project?.path === project.path,
                              onClick: async () => {
                                  close()
                                  if (!project.exists) {
                                      toast(`${project.name} is no longer on disk.`, 'error')
                                      return
                                  }
                                  await selectProject(project.path)
                              },
                          }),
                      )
                    : [popEmpty(projects.length ? 'No matches' : 'No recent projects')]),
                popSeparator(),
                popItem({
                    glyph: 'plus',
                    title: 'New project',
                    onClick: async () => {
                        close()
                        try {
                            const picked = await api.chooseProject()
                            if (picked) await selectProject(picked)
                        } catch (err) {
                            toast(String(err), 'error')
                        }
                    },
                }),
            ]
        }
        openPopover({ anchor, build, side: 'top', align: 'start', minWidth: 260 })
    }

    async function selectProject(path) {
        try {
            store.project = await api.openProject(path)
            store.projects = await api.listProjects()
            refresh()
            toast(`Opened ${store.project.name}`)
        } catch (err) {
            toast(String(err), 'error')
        }
    }

    refresh()
    return {
        el,
        refresh,
        focus: () => textarea.focus(),
        setBusy(busy) {
            store.busy = busy
            syncSend()
        },
    }
}

// ── helpers ──

function approvalLabel(id) {
    return (
        {
            'ask-for-approval': 'Ask for approval',
            'approve-for-me': 'Approve for me',
            custom: 'Custom',
        }[id] || 'Approve for me'
    )
}

function escape(text) {
    return String(text ?? '').replace(
        /[&<>"']/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    )
}

/** Small tile markup used in the overlapping icon stack. */
function pluginTile(plugin) {
    if (plugin.logo) {
        return `<span><img src="${escape(plugin.logo)}" alt="" loading="lazy"></span>`
    }
    if (plugin.glyph) {
        return `<span style="color:var(--ink-dim)">${icon(plugin.glyph, 11)}</span>`
    }
    return `<span style="background:${slugColor(plugin.slug)};color:#fff">${escape(
        plugin.name.slice(0, 1).toUpperCase(),
    )}</span>`
}

/** Node form of the same tile, for popover rows. */
export function tileNode(plugin, size = 18) {
    const box = h('span.glyph', {
        style: {
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            flex: '0 0 auto',
        },
    })
    if (plugin.logo) {
        box.append(
            h('img', {
                src: plugin.logo,
                alt: '',
                loading: 'lazy',
                style: { width: '100%', height: '100%', objectFit: 'cover' },
            }),
        )
    } else if (plugin.glyph) {
        box.innerHTML = icon(plugin.glyph, size - 4)
    } else {
        box.style.background = slugColor(plugin.slug)
        box.style.color = '#fff'
        box.style.fontSize = `${Math.round(size * 0.58)}px`
        box.textContent = (plugin.name || '?').slice(0, 1).toUpperCase()
    }
    return box
}

export function openExternal(url) {
    const opener = globalThis.__TAURI__?.opener
    if (opener?.openUrl) opener.openUrl(url).catch(() => {})
}
