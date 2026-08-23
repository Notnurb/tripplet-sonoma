// Minimal PNG read/write, dependency-free.
//
// The encoder writes 8-bit RGBA, no interlacing. The decoder handles the
// non-interlaced 8-bit colour types (grey, RGB, grey+alpha, RGBA), which
// covers anything a design tool exports. Palette and 16-bit images are
// rejected loudly rather than decoded wrongly.

import { deflateSync, inflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
    const table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c
    }
    return table
})()

function crc32(buf) {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, crc])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** @param {number} width @param {number} height @param {Buffer} rgba */
export function encodePng(width, height, rgba) {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // RGBA
    // 10..12 stay zero: deflate, adaptive filtering, no interlace.

    const stride = width * 4
    const raw = Buffer.alloc(height * (stride + 1))
    for (let y = 0; y < height; y++) {
        const at = y * (stride + 1)
        raw[at] = 0 // filter: none
        rgba.copy(raw, at + 1, y * stride, (y + 1) * stride)
    }

    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

function paeth(a, b, c) {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    return pb <= pc ? b : c
}

/**
 * @param {Buffer} file
 * @returns {{width: number, height: number, rgba: Buffer}}
 */
export function decodePng(file) {
    if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')

    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    let interlace = 0
    const idat = []

    let offset = 8
    while (offset < file.length) {
        const length = file.readUInt32BE(offset)
        const type = file.toString('ascii', offset + 4, offset + 8)
        const body = file.subarray(offset + 8, offset + 8 + length)
        if (type === 'IHDR') {
            width = body.readUInt32BE(0)
            height = body.readUInt32BE(4)
            bitDepth = body[8]
            colorType = body[9]
            interlace = body[12]
        } else if (type === 'IDAT') {
            idat.push(body)
        } else if (type === 'IEND') {
            break
        }
        offset += 12 + length
    }

    if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth} (need 8)`)
    if (interlace !== 0) throw new Error('interlaced PNGs are not supported')
    const channels = CHANNELS[colorType]
    if (!channels) throw new Error(`unsupported colour type ${colorType}`)

    const raw = inflateSync(Buffer.concat(idat))
    const bpp = channels
    const stride = width * bpp
    const out = Buffer.alloc(width * height * 4)
    const prev = Buffer.alloc(stride)
    const line = Buffer.alloc(stride)

    let at = 0
    for (let y = 0; y < height; y++) {
        const filter = raw[at++]
        raw.copy(line, 0, at, at + stride)
        at += stride

        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? line[i - bpp] : 0
            const b = prev[i]
            const c = i >= bpp ? prev[i - bpp] : 0
            switch (filter) {
                case 0:
                    break
                case 1:
                    line[i] = (line[i] + a) & 0xff
                    break
                case 2:
                    line[i] = (line[i] + b) & 0xff
                    break
                case 3:
                    line[i] = (line[i] + ((a + b) >> 1)) & 0xff
                    break
                case 4:
                    line[i] = (line[i] + paeth(a, b, c)) & 0xff
                    break
                default:
                    throw new Error(`unknown filter ${filter} on row ${y}`)
            }
        }

        for (let x = 0; x < width; x++) {
            const src = x * bpp
            const dst = (y * width + x) * 4
            if (colorType === 6) {
                out[dst] = line[src]
                out[dst + 1] = line[src + 1]
                out[dst + 2] = line[src + 2]
                out[dst + 3] = line[src + 3]
            } else if (colorType === 2) {
                out[dst] = line[src]
                out[dst + 1] = line[src + 1]
                out[dst + 2] = line[src + 2]
                out[dst + 3] = 255
            } else if (colorType === 4) {
                out[dst] = out[dst + 1] = out[dst + 2] = line[src]
                out[dst + 3] = line[src + 1]
            } else {
                out[dst] = out[dst + 1] = out[dst + 2] = line[src]
                out[dst + 3] = 255
            }
        }
        line.copy(prev)
    }

    return { width, height, rgba: out }
}

/**
 * Tight bounding box of pixels that are actually visible.
 *
 * The source mark sits in a large transparent canvas, so cropping to its ink
 * is what lets the glyph be centred and sized deliberately rather than
 * inheriting whatever padding the export happened to carry.
 */
export function inkBounds(image, alphaThreshold = 8) {
    const { width, height, rgba } = image
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            // A fully-opaque white background counts as empty too: some exports
            // flatten transparency, and treating white as ink would defeat the
            // crop entirely.
            const alpha = rgba[i + 3]
            if (alpha <= alphaThreshold) continue
            const isWhite = rgba[i] > 247 && rgba[i + 1] > 247 && rgba[i + 2] > 247
            if (isWhite) continue
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }
    }

    if (maxX < 0) throw new Error('image has no visible pixels to crop to')
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Coverage of the mark at a point in cropped-source space, sampled bilinearly
 * so the glyph edge stays smooth when scaled down to 16px.
 */
export function sampleInk(image, box, u, v) {
    const { width, height, rgba } = image
    const fx = box.x + u * (box.width - 1)
    const fy = box.y + v * (box.height - 1)
    if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return 0

    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(x0 + 1, width - 1)
    const y1 = Math.min(y0 + 1, height - 1)
    const tx = fx - x0
    const ty = fy - y0

    const ink = (x, y) => {
        const i = (y * width + x) * 4
        const alpha = rgba[i + 3] / 255
        if (alpha === 0) return 0
        // The mark is dark-on-transparent, so darkness is the signal. A white
        // pixel that survived flattening contributes nothing.
        const luma = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) / 255
        return alpha * (1 - luma)
    }

    const top = ink(x0, y0) * (1 - tx) + ink(x1, y0) * tx
    const bottom = ink(x0, y1) * (1 - tx) + ink(x1, y1) * tx
    return top * (1 - ty) + bottom * ty
}
