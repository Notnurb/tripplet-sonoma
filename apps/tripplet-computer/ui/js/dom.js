// Tiny DOM helpers. No framework: the app has three screens and a popover
// layer, and a virtual DOM would cost more than it saves.

/**
 * @param {string} tag  e.g. "button.chip" or "div#view.foo.bar"
 * @param {object|null} props
 * @param  {...(Node|string|null|undefined|false)} children
 */
export function h(tag, props = null, ...children) {
    const [name, ...rest] = tag.split(/(?=[.#])/)
    const node = document.createElement(name || 'div')
    for (const token of rest) {
        if (token[0] === '#') node.id = token.slice(1)
        else node.classList.add(token.slice(1))
    }
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value === null || value === undefined || value === false) continue
            if (key === 'class') node.className += (node.className ? ' ' : '') + value
            else if (key === 'html') node.innerHTML = value
            else if (key === 'text') node.textContent = value
            else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
            else if (key.startsWith('on') && typeof value === 'function') {
                node.addEventListener(key.slice(2).toLowerCase(), value)
            } else if (key === 'dataset') Object.assign(node.dataset, value)
            else node.setAttribute(key, value === true ? '' : String(value))
        }
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue
        node.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return node
}

export const qs = (sel, root = document) => root.querySelector(sel)
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel))

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
    return node
}

export function mount(node, ...children) {
    clear(node)
    node.append(...children.flat().filter(Boolean))
    return node
}

/** Grow a textarea to fit its content, up to its CSS max-height. */
export function autosize(textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
}

/** "3 minutes ago" / "Tue" / "12 Mar" — sidebar-grade relative time. */
export function relativeTime(iso) {
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return ''
    const seconds = Math.round((Date.now() - then) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

let toastHost = null

export function toast(message, kind = 'info') {
    if (!toastHost) {
        toastHost = h('div#toasts')
        document.body.append(toastHost)
    }
    const node = h('div.toast', { class: kind === 'error' ? 'error' : '', text: message })
    toastHost.append(node)
    setTimeout(() => {
        node.style.transition = 'opacity 200ms ease'
        node.style.opacity = '0'
        setTimeout(() => node.remove(), 220)
    }, kind === 'error' ? 5200 : 2600)
}
