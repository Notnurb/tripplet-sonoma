// The Plugins and Skills catalogue pages, and Settings.

import * as api from './api.js'
import { h, mount, toast } from './dom.js'
import { icon, slugColor } from './icons.js'
import { openPopover, popItem, popSeparator } from './popover.js'
import { tileNode } from './composer.js'

/** Section order for the plugin catalogue; anything else sorts after. */
const SECTION_ORDER = ['Built in', 'Featured']

function sectionRank(name) {
    const index = SECTION_ORDER.indexOf(name)
    return index === -1 ? SECTION_ORDER.length : index
}

function groupByCategory(plugins) {
    const groups = new Map()
    for (const plugin of plugins) {
        if (!groups.has(plugin.category)) groups.set(plugin.category, [])
        groups.get(plugin.category).push(plugin)
    }
    return [...groups.entries()].sort(
        (a, b) => sectionRank(a[0]) - sectionRank(b[0]) || a[0].localeCompare(b[0]),
    )
}

function sectionHead(title, { pill = false, tools = [] } = {}) {
    return h(
        'div.section-head',
        null,
        h('h2', { class: pill ? 'pill' : '', text: title }),
        tools.length
            ? h(
                  'div.tools',
                  null,
                  ...tools.map((tool) =>
                      h('button', {
                          type: 'button',
                          title: tool.title,
                          html: icon(tool.glyph, 16),
                          onclick: tool.onClick,
                      }),
                  ),
              )
            : null,
    )
}

function artFor(entry) {
    const art = h('div.art')
    if (entry.logo) {
        art.append(h('img', { src: entry.logo, alt: '', loading: 'lazy' }))
    } else if (entry.glyph) {
        art.innerHTML = icon(entry.glyph, 22)
        art.style.color = 'var(--ink-dim)'
    } else {
        const letter = h('span.letter', { text: (entry.name || '?').slice(0, 1).toUpperCase() })
        letter.style.background = slugColor(entry.slug)
        art.append(letter)
    }
    return art
}

function itemRow({ entry, end, onClick }) {
    return h(
        'button.item',
        { type: 'button', onclick: onClick, title: entry.description || entry.name },
        artFor(entry),
        h(
            'div.text',
            null,
            h('div.name', { text: entry.name }),
            h('div.desc', { text: entry.description || '' }),
        ),
        h('div.end', null, ...(Array.isArray(end) ? end.filter(Boolean) : [end].filter(Boolean))),
    )
}

// ─────────────────────────── Plugins ───────────────────────────

export function createPluginsPage({ store }) {
    const body = h('div')
    const el = h('div.view-pad', null, body)
    let search = ''
    let scope = 'public'
    let busy = new Set()

    async function load() {
        try {
            store.plugins = await api.listPlugins(search)
        } catch (err) {
            toast(String(err), 'error')
            store.plugins = store.plugins || []
        }
        store.installedPlugins = (store.plugins || []).filter((p) => p.installed)
        render()
        store.onPluginsChanged?.()
    }

    function render() {
        const plugins = store.plugins || []
        const installed = plugins.filter((p) => p.installed)
        const visible =
            scope === 'personal' ? plugins.filter((p) => p.kind === 'builtin') : plugins

        const sections = groupByCategory(visible.filter((p) => !p.installed || p.kind === 'builtin'))

        mount(
            body,
            h('h1.cat-title', { text: 'Plugins' }),
            h('p.cat-sub', { text: 'Work with Tripplet across your favorite tools' }),
            h(
                'div.cat-search',
                null,
                h('span', { html: icon('search', 16) }),
                h('input', {
                    type: 'text',
                    placeholder: 'Search plugins',
                    value: search,
                    spellcheck: 'false',
                    oninput: (event) => {
                        search = event.target.value
                        clearTimeout(render.timer)
                        render.timer = setTimeout(load, 220)
                    },
                }),
            ),

            h(
                'div.section',
                null,
                sectionHead('Installed', {
                    tools: [
                        {
                            glyph: 'gear',
                            title: 'Connector settings',
                            onClick: () => store.go('settings'),
                        },
                    ],
                }),
                installed.length
                    ? h(
                          'div.installed-row',
                          null,
                          ...installed.map((plugin) => {
                              const tile = h('button.tile', {
                                  type: 'button',
                                  class: plugin.enabled === false ? 'off' : '',
                                  title: `${plugin.name}${plugin.enabled === false ? ' (off)' : ''}`,
                                  onclick: (event) => openPluginMenu(event.currentTarget, plugin),
                              })
                              tile.append(tileNode(plugin, 44))
                              return tile
                          }),
                      )
                    : h('div.cat-empty', {
                          text: 'Nothing installed yet — connect an app below.',
                      }),
            ),

            h(
                'div.filter-row',
                null,
                h(
                    'div.segmented',
                    null,
                    ...[
                        ['public', 'Public'],
                        ['personal', 'Personal'],
                    ].map(([id, label]) =>
                        h('button', {
                            type: 'button',
                            text: label,
                            'aria-selected': String(scope === id),
                            onclick: () => {
                                scope = id
                                render()
                            },
                        }),
                    ),
                ),
                h('button.more', {
                    type: 'button',
                    title: 'Filter',
                    html: icon('filter', 16),
                    onclick: () => toast('Showing every catalogue app'),
                }),
            ),

            ...sections.map(([name, items]) =>
                h(
                    'div.section',
                    null,
                    sectionHead(name),
                    h('div.grid', null, ...items.map(renderPlugin)),
                ),
            ),

            sections.length ? null : h('div.cat-empty', { text: `No plugins match “${search}”` }),
        )
    }

    function renderPlugin(plugin) {
        const working = busy.has(plugin.slug)
        let end
        if (plugin.kind === 'builtin') {
            end = h('span.check', {
                html: icon('check', 17),
                style: { opacity: plugin.enabled === false ? '0.25' : '1' },
            })
        } else if (working) {
            end = h('span.spinner')
        } else if (plugin.installed) {
            end = h('span.check', { html: icon('check', 17) })
        } else if (plugin.connection_status && plugin.connection_status !== 'ACTIVE') {
            end = h('span.desc', { text: 'Pending…' })
        } else {
            end = h('button.install', {
                type: 'button',
                text: 'Install',
                onclick: (event) => {
                    event.stopPropagation()
                    connect(plugin)
                },
            })
        }

        return itemRow({
            entry: plugin,
            end,
            onClick: (event) => openPluginMenu(event.currentTarget, plugin),
        })
    }

    function openPluginMenu(anchor, plugin) {
        const items = []
        if (plugin.kind === 'builtin' || plugin.installed) {
            items.push(
                popItem({
                    glyph: plugin.enabled === false ? 'check' : 'x',
                    title: plugin.enabled === false ? 'Enable' : 'Disable',
                    onClick: async () => {
                        try {
                            store.config = await api.setPluginEnabled(
                                plugin.slug,
                                plugin.enabled === false,
                            )
                            await load()
                        } catch (err) {
                            toast(String(err), 'error')
                        }
                    },
                }),
            )
        }
        if (plugin.kind === 'connector') {
            if (plugin.installed) {
                items.push(popSeparator())
                items.push(
                    popItem({
                        glyph: 'trash',
                        title: 'Disconnect',
                        onClick: async () => {
                            try {
                                await api.disconnectPlugin(plugin.slug)
                                toast(`Disconnected ${plugin.name}`)
                                await load()
                            } catch (err) {
                                toast(String(err), 'error')
                            }
                        },
                    }),
                )
            } else {
                items.push(
                    popItem({
                        glyph: 'plug',
                        title: 'Connect',
                        onClick: () => connect(plugin),
                    }),
                )
            }
        }
        if (!items.length) return
        openPopover({ anchor, align: 'end', build: () => items, minWidth: 180 })
    }

    async function connect(plugin) {
        busy.add(plugin.slug)
        render()
        try {
            const url = await api.connectPlugin(plugin.slug)
            toast(
                url
                    ? `Finish connecting ${plugin.name} in your browser, then refresh.`
                    : `${plugin.name} connected.`,
            )
        } catch (err) {
            toast(String(err), 'error')
        } finally {
            busy.delete(plugin.slug)
            await load()
        }
    }

    return { el, load, refresh: load }
}

// ─────────────────────────── Skills ───────────────────────────

export function createSkillsPage({ store }) {
    const body = h('div')
    const el = h('div.view-pad', null, body)
    let search = ''

    async function load() {
        try {
            store.skills = await api.listSkills()
        } catch (err) {
            toast(String(err), 'error')
            store.skills = store.skills || []
        }
        render()
    }

    function render() {
        const query = search.trim().toLowerCase()
        const matches = (store.skills || []).filter(
            (skill) =>
                !query ||
                skill.name.toLowerCase().includes(query) ||
                skill.description.toLowerCase().includes(query),
        )
        const custom = matches.filter((s) => !s.builtin)
        const system = matches.filter((s) => s.builtin)

        mount(
            body,
            h('h1.cat-title', { text: 'Skills' }),
            h('p.cat-sub', { text: 'Extend Tripplet with task-specific skills' }),
            h(
                'div.cat-search',
                null,
                h('span', { html: icon('search', 16) }),
                h('input', {
                    type: 'text',
                    placeholder: 'Search skills',
                    value: search,
                    spellcheck: 'false',
                    oninput: (event) => {
                        search = event.target.value
                        render()
                    },
                }),
            ),

            h(
                'div.section',
                null,
                sectionHead('Installed', {
                    tools: [
                        {
                            glyph: 'folder',
                            title: 'Open the skills folder',
                            onClick: () =>
                                api
                                    .openSkillsFolder()
                                    .catch((err) => toast(String(err), 'error')),
                        },
                    ],
                }),
                custom.length
                    ? h('div.grid', null, ...custom.map(renderSkill))
                    : h(
                          'div.notice',
                          null,
                          h('div', {
                              html:
                                  '<strong>No custom skills yet.</strong> Drop a Markdown file into ' +
                                  'the skills folder and it appears here — front-matter sets its name ' +
                                  'and description.',
                          }),
                          h(
                              'div.row',
                              null,
                              h('button.btn', {
                                  type: 'button',
                                  text: 'Open skills folder',
                                  onclick: () =>
                                      api
                                          .openSkillsFolder()
                                          .catch((err) => toast(String(err), 'error')),
                              }),
                          ),
                      ),
            ),

            system.length
                ? h(
                      'div.section',
                      null,
                      sectionHead('System', { pill: true }),
                      h('div.grid', null, ...system.map(renderSkill)),
                  )
                : null,

            matches.length ? null : h('div.cat-empty', { text: `No skills match “${search}”` }),
        )
    }

    function renderSkill(skill) {
        return itemRow({
            entry: { ...skill, glyph: skill.builtin ? 'book' : 'spark' },
            end: h('span.check', {
                html: icon('check', 17),
                style: { opacity: skill.enabled ? '1' : '0.25' },
            }),
            onClick: async () => {
                try {
                    store.skills = await api.setSkillEnabled(skill.slug, !skill.enabled)
                    render()
                    toast(`${skill.name} ${skill.enabled ? 'disabled' : 'enabled'}`)
                } catch (err) {
                    toast(String(err), 'error')
                }
            },
        })
    }

    return { el, load, refresh: load }
}

// ─────────────────────────── Settings ───────────────────────────

export function createSettingsPage({ store }) {
    const body = h('div')
    const el = h('div.view-pad', null, body)

    function field(label, hint, control) {
        return h(
            'div.field',
            null,
            h('div', null, h('div.label', { text: label }), hint ? h('div.hint', { text: hint }) : null),
            h('div.control', null, control),
        )
    }

    function render() {
        const config = store.config
        mount(
            body,
            h('h1.cat-title', { text: 'Settings' }),
            h('p.cat-sub', { text: 'Where this install talks to, and where its data lives' }),

            h(
                'div.settings-group',
                null,
                h('h2', { text: 'This install' }),
                field(
                    'Install ID',
                    'This copy of Tripplet Computer signs every request with its own key. ' +
                        'There is no API key to manage.',
                    h('code', {
                        text: store.installId || '—',
                        style: {
                            fontSize: '12px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--ink-dim)',
                            userSelect: 'text',
                        },
                    }),
                ),
                field(
                    'Gateway URL',
                    'OpenAI-compatible endpoint. Leave blank for the default.',
                    h(
                        'div.control',
                        null,
                        (() => {
                            const input = h('input', {
                                type: 'text',
                                value: config.api_base_url,
                                spellcheck: 'false',
                            })
                            input.addEventListener('change', async () => {
                                try {
                                    store.config = await api.setApiBaseUrl(input.value)
                                    toast('Gateway updated')
                                } catch (err) {
                                    toast(String(err), 'error')
                                }
                            })
                            return input
                        })(),
                    ),
                ),
            ),

            h(
                'div.settings-group',
                null,
                h('h2', { text: 'Connectors' }),
                field(
                    'Connected apps',
                    'Connectors run through Tripplet — no Composio key is stored on this Mac. ' +
                        'Accounts you connect are scoped to this install.',
                    h('button.btn', {
                        type: 'button',
                        text: 'Open Plugins',
                        onclick: () => store.go('plugins'),
                    }),
                ),
            ),

            h(
                'div.settings-group',
                null,
                h('h2', { text: 'Files' }),
                field(
                    'config.toml',
                    config.config_path,
                    h('button.btn', {
                        type: 'button',
                        text: 'Open',
                        onclick: () => api.openConfigFile().catch((err) => toast(String(err), 'error')),
                    }),
                ),
                field(
                    'Skills folder',
                    'Markdown playbooks the agent can follow.',
                    h('button.btn', {
                        type: 'button',
                        text: 'Open',
                        onclick: () =>
                            api.openSkillsFolder().catch((err) => toast(String(err), 'error')),
                    }),
                ),
            ),

            h(
                'div.settings-group',
                null,
                h('h2', { text: 'About' }),
                field('Version', `Tripplet Computer ${store.appVersion}`, h('span')),
            ),
        )
    }

    return { el, load: render, refresh: render }
}
