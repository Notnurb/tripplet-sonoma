// Inline SVG icons. Bundled as source rather than fetched so the strict CSP
// needs no image host, and so icons inherit `currentColor` for free.

const PATHS = {
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    forward: '<path d="M9 5l7 7-7 7"/>',
    compose:
        '<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z"/><path d="M13.5 7.5l3 3"/>',
    refresh:
        '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
    gear:
        '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"/>',
    chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    // Approval-mode glyphs.
    shield: '<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6L12 3z"/><circle cx="9.6" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="14.4" cy="11" r=".9" fill="currentColor" stroke="none"/>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-.5V4.5a1.5 1.5 0 0 1 3 0V11m0-.8V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2.5a1.5 1.5 0 0 1 3 0"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    send: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    panelRight: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/>',
    folder:
        '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17V7.5z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 9.5l2.5 2.5-2.5 2.5M12.5 15h4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    globe:
        '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5z"/>',
    file: '<path d="M6 3.5h7L18.5 9v11.5H6z"/><path d="M13 3.5V9h5.5"/>',
    pencil: '<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z"/>',
    laptop: '<rect x="4" y="5.5" width="16" height="10.5" rx="1.8"/><path d="M2.5 19h19"/>',
    filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
    plug: '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9z"/><path d="M12 18v3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/>',
    spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    fleet: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="M7.6 9.1l3 5.9M16.4 9.1l-3 5.9"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14.5H5.5A1.5 1.5 0 0 0 4 20V5.5z"/><path d="M4 18.5h15"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.2.8 4.7 1.6 5.6.4.4.1 1.1-.5 1.1H5.4c-.6 0-.9-.7-.5-1.1.8-.9 1.6-2.4 1.6-5.6z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.8c0 1.5-2.2 1.9-2.2 3.3"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
    puzzle:
        '<path d="M10 4.5a1.8 1.8 0 0 1 3.6 0V6H17a1 1 0 0 1 1 1v3.4h1.5a1.8 1.8 0 0 1 0 3.6H18V18a1 1 0 0 1-1 1h-3.4v-1.5a1.8 1.8 0 0 0-3.6 0V19H6a1 1 0 0 1-1-1v-3.5h1.4a1.8 1.8 0 0 0 0-3.6H5V7a1 1 0 0 1 1-1h4V4.5z"/>',
}

/**
 * @param {keyof typeof PATHS} name
 * @param {number} size
 */
export function icon(name, size = 16) {
    const body = PATHS[name]
    if (!body) return ''
    return (
        `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
        `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true">${body}</svg>`
    )
}

/** Deterministic tile colour for an app with no logo, derived from its slug. */
export function slugColor(slug) {
    let hash = 0
    for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
    const hue = hash % 360
    return `linear-gradient(150deg, hsl(${hue} 62% 52%), hsl(${(hue + 32) % 360} 58% 42%))`
}

export const ICON_NAMES = Object.keys(PATHS)
