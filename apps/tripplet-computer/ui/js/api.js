// Thin wrapper over the Tauri IPC surface.
//
// Every call the UI can make lives here, so the set of things the webview is
// allowed to ask the Rust side for is one readable list. `withGlobalTauri` is
// on, so this needs no npm dependency.

const tauri = () => globalThis.__TAURI__

/** True when running inside the app rather than a plain browser. */
export const isNative = () => Boolean(tauri()?.core?.invoke)

async function call(command, args) {
    if (!isNative()) {
        throw new Error(`Not running inside Tripplet Computer (tried to call ${command}).`)
    }
    return tauri().core.invoke(command, args)
}

export function listen(event, handler) {
    if (!isNative()) return () => {}
    let dispose = () => {}
    let cancelled = false
    tauri()
        .event.listen(event, (payload) => handler(payload.payload))
        .then((off) => {
            if (cancelled) off()
            else dispose = off
        })
    return () => {
        cancelled = true
        dispose()
    }
}

// ── Settings ──
export const bootstrap = () => call('bootstrap')
export const setModel = (model) => call('set_model', { model })
export const setEffort = (effort) => call('set_effort', { effort })
export const setApproval = (approval) => call('set_approval', { approval })
export const setApiBaseUrl = (url) => call('set_api_base_url', { url })
export const openConfigFile = () => call('open_config_file')

// ── Projects ──
export const listProjects = () => call('list_projects')
export const openProject = (path) => call('open_project', { path })
export const chooseProject = () => call('choose_project')
export const forgetProject = (path) => call('forget_project', { path })
export const closeProject = () => call('close_project')

// ── Threads ──
export const listThreads = () => call('list_threads')
export const createThread = () => call('create_thread')
export const getThread = (threadId) => call('get_thread', { threadId })
export const deleteThread = (threadId) => call('delete_thread', { threadId })
export const renameThread = (threadId, title) => call('rename_thread', { threadId, title })

// ── Skills & plugins ──
export const listSkills = () => call('list_skills')
export const setSkillEnabled = (slug, enabled) => call('set_skill_enabled', { slug, enabled })
export const openSkillsFolder = () => call('open_skills_folder')
export const listPlugins = (search) => call('list_plugins', { search: search || null })
export const setPluginEnabled = (slug, enabled) => call('set_plugin_enabled', { slug, enabled })
export const connectPlugin = (slug) => call('connect_plugin', { slug })
export const disconnectPlugin = (slug) => call('disconnect_plugin', { slug })

// ── Turns ──
export const sendMessage = (threadId, text) => call('send_message', { threadId, text })
export const cancelTurn = (threadId) => call('cancel_turn', { threadId })
export const respondToApproval = (id, allow) => call('respond_to_approval', { id, allow })

/** Event channels emitted by the Rust side. */
export const EVENTS = {
    agent: 'agent-event',
    approval: 'approval-request',
    renamed: 'thread-renamed',
}
