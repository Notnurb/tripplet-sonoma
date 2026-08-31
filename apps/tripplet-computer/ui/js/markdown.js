// A small Markdown renderer for assistant messages.
//
// Everything is HTML-escaped *first*, and only a fixed set of constructs is
// then re-introduced. Model output is not trusted input — it can quote a file
// that contains `<script>` — so the renderer must never pass source markup
// through, and there is no path here that inserts an attribute the caller did
// not construct.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

/** Only http(s) links survive; anything else renders as plain text. */
function safeHref(url) {
    const trimmed = url.trim()
    return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

function inline(text) {
    let out = text

    // Inline code first, so its contents are exempt from the rest. The slot
    // marker uses a raw `<`, which cannot survive escapeHtml above, so it can
    // never collide with real text the way a bare-digit marker would.
    const codeSlots = []
    out = out.replace(/`([^`\n]+)`/g, (_, code) => {
        codeSlots.push(`<code>${code}</code>`)
        return `<${codeSlots.length - 1}>`
    })

    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

    // [label](url)
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
        const href = safeHref(url)
        return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : whole
    })

    // Bare URLs.
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (whole, lead, url) => {
        const href = safeHref(url)
        return href ? `${lead}<a href="${href}" target="_blank" rel="noreferrer">${url}</a>` : whole
    })

    return out.replace(/<(\d+)>/g, (_, i) => codeSlots[Number(i)])
}

export function renderMarkdown(source) {
    const escaped = escapeHtml(source ?? '')
    const lines = escaped.split('\n')
    const out = []

    let listType = null
    let inCode = false
    let codeLines = []
    let paragraph = []

    const flushParagraph = () => {
        if (paragraph.length) {
            out.push(`<p>${inline(paragraph.join(' '))}</p>`)
            paragraph = []
        }
    }
    const flushList = () => {
        if (listType) {
            out.push(`</${listType}>`)
            listType = null
        }
    }

    for (const line of lines) {
        const fence = line.match(/^\s*```(\w*)\s*$/)
        if (fence) {
            if (inCode) {
                out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
                codeLines = []
                inCode = false
            } else {
                flushParagraph()
                flushList()
                inCode = true
            }
            continue
        }
        if (inCode) {
            codeLines.push(line)
            continue
        }

        if (!line.trim()) {
            flushParagraph()
            flushList()
            continue
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/)
        if (heading) {
            flushParagraph()
            flushList()
            const level = Math.min(heading[1].length + 1, 6)
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
            continue
        }

        const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
        if (bullet || numbered) {
            flushParagraph()
            const wanted = bullet ? 'ul' : 'ol'
            if (listType !== wanted) {
                flushList()
                out.push(`<${wanted}>`)
                listType = wanted
            }
            out.push(`<li>${inline((bullet || numbered)[1])}</li>`)
            continue
        }

        if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
            flushParagraph()
            flushList()
            out.push('<hr>')
            continue
        }

        paragraph.push(line.trim())
    }

    // An unterminated fence still renders as code rather than leaking markup.
    if (inCode && codeLines.length) {
        out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
    }
    flushParagraph()
    flushList()

    return out.join('')
}
