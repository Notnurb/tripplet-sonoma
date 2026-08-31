#!/usr/bin/env node
// Generates the macOS app icon set from code — no binary design assets of our
// own in the repo.
//
// The mark is the Tripplet logo (`public/logo.png`), auto-cropped to its ink
// and re-rendered in white over a red→black gradient in a macOS-style
// squircle. Cropping matters: the source sits in a mostly-empty 1920² canvas,
// so using it as-is would produce a tiny glyph floating in the middle.

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { encodePng, decodePng, inkBounds, sampleInk } from './png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ICONS = join(HERE, '..', 'src-tauri', 'icons')
// The repo root is four levels up from apps/tripplet-computer/scripts.
const LOGO = resolve(HERE, '..', '..', '..', 'public', 'logo.png')

// ── Palette ───────────────────────────────────────────────────────────────

const RED_HOT = [255, 66, 52] //  top-left, lit
const RED_DEEP = [156, 22, 18] //  midtone
const NEAR_BLACK = [12, 9, 10] //  bottom-right

const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (t) => t * t * (3 - 2 * t)

/**
 * Three-stop red→black ramp. The midpoint sits below centre so black occupies
 * more of the canvas than red — an even split reads as red-to-maroon rather
 * than red-to-black.
 */
const RAMP_MID = 0.44

function backdrop(t) {
    return t < RAMP_MID
        ? mix(RED_HOT, RED_DEEP, smoothstep(t / RAMP_MID))
        : mix(RED_DEEP, NEAR_BLACK, smoothstep((t - RAMP_MID) / (1 - RAMP_MID)))
}

/**
 * Coverage of a macOS-style squircle (superellipse, n = 5), with a soft edge
 * so the icon does not alias at 16px.
 */
function squircle(nx, ny, radius, feather) {
    const d = Math.pow(Math.abs(nx), 5) + Math.pow(Math.abs(ny), 5)
    const t = (Math.pow(Math.pow(radius, 5), 0.2) - Math.pow(d, 0.2)) / feather
    return clamp01(t)
}

// ── Render ────────────────────────────────────────────────────────────────

function render(size, logo, box) {
    const rgba = Buffer.alloc(size * size * 4)

    // The glyph is taller than it is wide, so fit it by its longest side and
    // let the other axis centre itself.
    const target = size * 0.58
    const scale = target / Math.max(box.width, box.height)
    const glyphW = box.width * scale
    const glyphH = box.height * scale
    const originX = (size - glyphW) / 2
    // Nudge up a hair: an optically centred mark sits slightly above true
    // centre, because the eye reads the mass, not the bounding box.
    const originY = (size - glyphH) / 2 - size * 0.012

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const x = px + 0.5
            const y = py + 0.5
            const nx = (x / size) * 2 - 1
            const ny = (y / size) * 2 - 1

            const shape = squircle(nx, ny, 0.98, 0.06)
            if (shape <= 0) continue

            // Diagonal ramp, top-left lit through to bottom-right black.
            const diagonal = clamp01((x / size) * 0.5 + (y / size) * 0.5)
            let [r, g, b] = backdrop(diagonal)

            // Radial hot spot near the top-left, so the red reads as lighting
            // rather than as a flat gradient fill.
            const glowX = x / size - 0.26
            const glowY = y / size - 0.2
            const glow = clamp01(1 - Math.hypot(glowX, glowY) / 0.72) ** 2 * 0.3
            r += (RED_HOT[0] - r) * glow
            g += (RED_HOT[1] - g) * glow
            b += (RED_HOT[2] - b) * glow

            // Hairline top highlight, the way macOS icons catch light.
            const highlight = clamp01(1 - y / (size * 0.2)) * 0.1
            r += (255 - r) * highlight
            g += (255 - g) * highlight
            b += (255 - b) * highlight

            // The mark, in white.
            const u = (x - originX) / glyphW
            const v = (y - originY) / glyphH
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
                const ink = sampleInk(logo, box, u, v)
                if (ink > 0) {
                    // A soft dark rim under the glyph keeps it legible where
                    // the backdrop is brightest.
                    const shade = clamp01(ink * 1.5) * 0.28
                    r = lerp(r, r * 0.55, shade)
                    g = lerp(g, g * 0.55, shade)
                    b = lerp(b, b * 0.55, shade)

                    r = lerp(r, 255, ink)
                    g = lerp(g, 250, ink)
                    b = lerp(b, 248, ink)
                }
            }

            const o = (py * size + px) * 4
            rgba[o] = Math.round(clamp01(r / 255) * 255)
            rgba[o + 1] = Math.round(clamp01(g / 255) * 255)
            rgba[o + 2] = Math.round(clamp01(b / 255) * 255)
            rgba[o + 3] = Math.round(shape * 255)
        }
    }
    return rgba
}

// ── Output ────────────────────────────────────────────────────────────────

if (!existsSync(LOGO)) {
    console.error(`Could not find the Tripplet mark at ${LOGO}`)
    process.exit(1)
}

const logo = decodePng(readFileSync(LOGO))
const box = inkBounds(logo)
console.log(
    `mark: ${logo.width}x${logo.height}, cropped to ${box.width}x${box.height} at (${box.x}, ${box.y})`,
)

mkdirSync(ICONS, { recursive: true })
const write = (size, path) => writeFileSync(path, encodePng(size, size, render(size, logo, box)))

for (const [size, name] of [
    [32, '32x32.png'],
    [128, '128x128.png'],
    [256, '128x128@2x.png'],
    [512, 'icon.png'],
]) {
    write(size, join(ICONS, name))
    console.log(`icons/${name}`)
}

// .icns via iconutil, which needs a fully populated .iconset.
const iconset = join(ICONS, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
for (const [size, name] of [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
]) {
    write(size, join(iconset, name))
}

try {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ICONS, 'icon.icns')])
    console.log('icons/icon.icns')
    rmSync(iconset, { recursive: true, force: true })
} catch (err) {
    console.error('iconutil failed (macOS only) — icon.icns not written:', err.message)
    process.exitCode = 1
}
