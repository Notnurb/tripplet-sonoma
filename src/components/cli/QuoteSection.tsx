'use client'

import { useEffect, useRef } from 'react'

const RAINBOW_SRC = 'https://soft-zoom-63098134.figma.site/_assets/v11/8d520a7515d06cbfc403d0125e3d05b1a7ccd29c.png'
const CLOUD_SRC = 'https://soft-zoom-63098134.figma.site/_assets/v11/0d6dfd3f90b930f21726f2ed56a3320d79b7a797.png'

/** Rainbow drifts from +120px down to -160px across the section's scroll. */
const RAINBOW_FROM = 120
const RAINBOW_TO = -160
/** How far off-screen the clouds park before they slide in. */
const CLOUD_OFFSET = 200

const lerp = (current: number, target: number, factor: number) => current + (target - current) * factor
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function QuoteSection() {
    const sectionRef = useRef<HTMLElement>(null)
    const rainbowRef = useRef<HTMLImageElement>(null)
    const leftCloudRef = useRef<HTMLImageElement>(null)
    const rightCloudRef = useRef<HTMLImageElement>(null)

    useEffect(() => {
        const section = sectionRef.current
        const rainbow = rainbowRef.current
        const leftCloud = leftCloudRef.current
        const rightCloud = rightCloudRef.current
        if (!section || !rainbow || !leftCloud || !rightCloud) return

        const paint = (rainbowY: number, leftX: number, rightX: number, cloudY: number) => {
            rainbow.style.transform = `translate3d(0, ${rainbowY}px, 0)`

            leftCloud.style.transform = `translate3d(${leftX}px, ${cloudY}px, 0)`
            leftCloud.style.opacity = `${1 - clamp01(Math.abs(leftX) / CLOUD_OFFSET)}`

            // The mirror is part of the transform string rather than a
            // `scale-x-[-1]` class: CSS applies the standalone `scale` property
            // outside `transform`, which would flip the slide-in direction too.
            rightCloud.style.transform = `translate3d(${rightX}px, ${cloudY}px, 0) scaleX(-1)`
            rightCloud.style.opacity = `${1 - clamp01(Math.abs(rightX) / CLOUD_OFFSET)}`
        }

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            paint(0, 0, 0, -25)
            return
        }

        const current = {
            rainbowY: RAINBOW_FROM,
            leftX: -CLOUD_OFFSET,
            rightX: CLOUD_OFFSET,
            cloudY: 0,
        }

        let frame = requestAnimationFrame(function tick() {
            const rect = section.getBoundingClientRect()
            const viewportHeight = window.innerHeight
            const progress = clamp01((viewportHeight - rect.top) / (viewportHeight + rect.height))
            const inView = progress > 0.12 && progress < 0.92

            current.rainbowY = lerp(current.rainbowY, RAINBOW_FROM + (RAINBOW_TO - RAINBOW_FROM) * progress, 0.06)
            current.leftX = lerp(current.leftX, inView ? 0 : -CLOUD_OFFSET, 0.04)
            current.rightX = lerp(current.rightX, inView ? 0 : CLOUD_OFFSET, 0.04)
            current.cloudY = lerp(current.cloudY, progress * -50, 0.04)

            paint(current.rainbowY, current.leftX, current.rightX, current.cloudY)
            frame = requestAnimationFrame(tick)
        })

        return () => cancelAnimationFrame(frame)
    }, [])

    return (
        <section
            ref={sectionRef}
            className="relative h-screen w-full overflow-hidden"
            style={{
                background: 'linear-gradient(180deg, #010A17 0%, #0A4267 30%, #20658E 60%, #6BADC4 100%)',
            }}
        >
            <img
                ref={rainbowRef}
                src={RAINBOW_SRC}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute inset-x-0 top-0 z-30 w-full will-change-transform"
                style={{ transform: `translate3d(0, ${RAINBOW_FROM}px, 0)` }}
            />

            <img
                ref={leftCloudRef}
                src={CLOUD_SRC}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute bottom-[10%] left-0 z-10 hidden w-[500px] will-change-transform sm:block md:w-[650px]"
                style={{ marginLeft: '-50%', opacity: 0, transform: `translate3d(${-CLOUD_OFFSET}px, 0, 0)` }}
            />

            <img
                ref={rightCloudRef}
                src={CLOUD_SRC}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute bottom-[15%] right-0 z-10 hidden w-[500px] will-change-transform sm:block md:w-[650px]"
                style={{ marginRight: '-75%', opacity: 0, transform: `translate3d(${CLOUD_OFFSET}px, 0, 0) scaleX(-1)` }}
            />

            <div className="relative z-20 mx-auto flex h-full max-w-4xl flex-col items-center justify-center px-6 text-center">
                <p className="font-instrument text-xl leading-[1.45] text-white sm:text-2xl md:text-4xl md:leading-[1.5] lg:text-[42px]">
                    “Serene was founded on a belief in beauty that honors your nature. We pursue refined outcomes,
                    considered approaches, and lasting vitality. We spend time learning what matters to you before
                    deciding what serves you best. No rushing, no excess — just support that lets you feel radiant.”
                </p>

                <p className="mt-6 text-sm tracking-wide text-white/80 md:mt-8 md:text-base">
                    Dr. Mia Callahan — Founder
                </p>
            </div>
        </section>
    )
}
