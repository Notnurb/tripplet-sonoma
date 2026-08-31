// Anchored popovers and menus.
//
// One shared layer holds every open popover as a stack, so a submenu closes
// with its parent, Escape closes the innermost, and an outside click closes
// the lot. Positioning flips and clamps against the viewport rather than
// letting a menu run off the window.

import { h, clear } from './dom.js'
import { icon } from './icons.js'

const GAP = 6
const EDGE = 10

let layer = null
/** @type {{node: HTMLElement, anchor: HTMLElement|null, onClose?: Function}[]} */
const stack = []

function ensureLayer() {
    if (!layer) {
        layer = document.getElementById('layer') || h('div#layer')
        if (!layer.isConnected) document.body.append(layer)
        layer.addEventListener('pointerdown', (event) => {
            // A click on the backdrop itself (not a popover) closes everything.
            if (event.target === layer) closeAll()
        })
    }
    return layer
}

/**
 * @param {object} options
 * @param {HTMLElement} options.anchor       element to position against
 * @param {(close: Function) => (Node|Node[])} options.build
 * @param {'start'|'end'|'center'} [options.align]
 * @param {'bottom'|'top'|'left'} [options.side]
 * @param {number} [options.depth]           stack level; children pass parent depth + 1
 * @param {number} [options.minWidth]
 * @param {Function} [options.onClose]
 */
export function openPopover(options) {
    const {
        anchor,
        build,
        align = 'start',
        side = 'bottom',
        depth = 0,
        minWidth,
        onClose,
    } = options

    // Opening at a given depth replaces anything at or below it.
    closeToDepth(depth)

    const host = ensureLayer()
    host.classList.add('open')

    const node = h('div.popover')
    if (minWidth) node.style.minWidth = `${minWidth}px`
    const close = () => closeToDepth(depth)
    const content = build(close)
    node.append(...(Array.isArray(content) ? content : [content]))
    host.append(node)

    position(node, anchor, align, side)
    stack.push({ node, anchor, onClose })

    if (anchor) anchor.setAttribute('aria-expanded', 'true')

    // Focus the first text input, if the menu has one (search menus).
    const search = node.querySelector('input')
    if (search) setTimeout(() => search.focus(), 0)

    return { node, close }
}

function position(node, anchor, align, side) {
    if (!anchor) return
    const a = anchor.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top
    let left

    if (side === 'left') {
        left = a.left - box.width - GAP
        top = a.top
        // Not enough room to the left — put it on the right instead.
        if (left < EDGE) left = a.right + GAP
    } else {
        const below = a.bottom + GAP
        const above = a.top - box.height - GAP
        const wantsTop = side === 'top'
        top = wantsTop ? above : below
        // Flip when the preferred side would overflow.
        if (!wantsTop && below + box.height > vh - EDGE && above > EDGE) top = above
        if (wantsTop && above < EDGE && below + box.height < vh - EDGE) top = below

        if (align === 'end') left = a.right - box.width
        else if (align === 'center') left = a.left + a.width / 2 - box.width / 2
        else left = a.left
    }

    node.style.left = `${Math.round(Math.min(Math.max(left, EDGE), Math.max(EDGE, vw - box.width - EDGE)))}px`
    node.style.top = `${Math.round(Math.min(Math.max(top, EDGE), Math.max(EDGE, vh - box.height - EDGE)))}px`
}

export function closeToDepth(depth) {
    while (stack.length > depth) {
        const entry = stack.pop()
        entry.node.remove()
        entry.anchor?.setAttribute('aria-expanded', 'false')
        entry.onClose?.()
    }
    if (!stack.length && layer) layer.classList.remove('open')
}

export function closeAll() {
    closeToDepth(0)
}

export function isOpen() {
    return stack.length > 0
}

/** Re-render an open popover in place — used by search-as-you-type menus. */
export function refreshPopover(depth, build) {
    const entry = stack[depth]
    if (!entry) return
    const scroll = entry.node.scrollTop
    const focused = entry.node.querySelector('input')
    const caret = focused ? [focused.selectionStart, focused.value] : null

    clear(entry.node)
    const content = build(() => closeToDepth(depth))
    entry.node.append(...(Array.isArray(content) ? content : [content]))
    entry.node.scrollTop = scroll

    if (caret) {
        const next = entry.node.querySelector('input')
        if (next) {
            next.value = caret[1]
            next.focus()
            next.setSelectionRange(caret[0], caret[0])
        }
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && stack.length) {
        event.preventDefault()
        closeToDepth(stack.length - 1)
    }
})

window.addEventListener('resize', closeAll)

// ── Row builders ──────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} [o.glyph]     icon name
 * @param {string} o.title
 * @param {string} [o.sub]       second line
 * @param {string} [o.value]     right-aligned muted value
 * @param {boolean} [o.checked]
 * @param {boolean} [o.chevron]
 * @param {Function} [o.onClick]
 * @param {Node} [o.art]         custom leading node (e.g. an app logo)
 */
export function popItem(o) {
    const row = h(
        'button.pop-item',
        {
            type: 'button',
            class: [o.sub ? 'stacked' : '', o.highlight ? 'highlight' : ''].filter(Boolean).join(' '),
            onclick: (event) => {
                event.preventDefault()
                o.onClick?.(event)
            },
        },
        o.art || (o.glyph ? h('span.glyph', { html: icon(o.glyph, 17) }) : null),
        h(
            'span.text',
            null,
            h('span.title', { text: o.title }),
            o.sub ? h('span.sub', { text: o.sub }) : null,
        ),
        o.value ? h('span.value', { text: o.value }) : null,
        o.checked ? h('span.check', { html: icon('check', 15) }) : null,
        o.chevron ? h('span.check', { html: icon('chevronRight', 15) }) : null,
    )
    // A submenu opens on hover, the way the model/effort menu does.
    if (o.onHover) row.addEventListener('pointerenter', () => o.onHover(row))
    return row
}

export const popSeparator = () => h('div.pop-sep')
export const popLabel = (text) => h('div.pop-label', { text })
export const popEmpty = (text) => h('div.pop-empty', { text })

export function popHeader(title, linkText, onLink) {
    return h(
        'div.pop-head',
        null,
        h('span', { text: title }),
        linkText
            ? h('a', {
                  href: '#',
                  text: linkText,
                  onclick: (event) => {
                      event.preventDefault()
                      onLink?.()
                  },
              })
            : null,
    )
}

export function popSearch(placeholder, value, onInput) {
    return h(
        'div.pop-search',
        null,
        h('span', { html: icon('search', 15) }),
        h('input', {
            type: 'text',
            placeholder,
            value: value || '',
            spellcheck: 'false',
            oninput: (event) => onInput(event.target.value),
        }),
    )
}
