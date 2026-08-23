// A static recreation of Tripplet Computer's empty state, built in DOM rather
// than shipped as a screenshot: it stays crisp at every density, respects the
// visitor's theme-independent dark framing, and costs a few kilobytes instead
// of a megabyte PNG.

const TRAFFIC = ['#ff5f57', '#febc2e', '#28c840']

function Glyph({ d, size = 15 }: { d: string; size?: number }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={d} />
        </svg>
    )
}

const PATH = {
    back: 'M15 5l-7 7 7 7',
    forward: 'M9 5l7 7-7 7',
    compose: 'M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z',
    plus: 'M12 5v14M5 12h14',
    send: 'M12 19V5M6 11l6-6 6 6',
    folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17V7.5z',
}

export function AppWindow() {
    return (
        <div className="tc-window mx-auto w-full max-w-3xl select-none" aria-hidden="true">
            {/* Toolbar */}
            <div className="flex h-11 items-center gap-1.5 px-3.5">
                <div className="mr-3 flex items-center gap-2">
                    {TRAFFIC.map((color) => (
                        <span key={color} className="tc-light" style={{ background: color }} />
                    ))}
                </div>
                <div className="flex items-center gap-0.5 text-white/35">
                    <span className="grid h-6 w-6 place-items-center">
                        <svg
                            viewBox="0 0 24 24"
                            width={15}
                            height={15}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.6}
                        >
                            <rect x="3" y="4" width="18" height="16" rx="2.5" />
                            <path d="M9.5 4v16" />
                        </svg>
                    </span>
                    <span className="grid h-6 w-6 place-items-center">
                        <Glyph d={PATH.back} />
                    </span>
                    <span className="grid h-6 w-6 place-items-center">
                        <Glyph d={PATH.forward} />
                    </span>
                    <span className="grid h-6 w-6 place-items-center">
                        <Glyph d={PATH.compose} />
                    </span>
                </div>
            </div>

            {/* Canvas */}
            <div className="flex flex-col items-center justify-center px-6 pb-7 pt-12 sm:pt-16">
                <p className="mb-6 text-[19px] font-normal tracking-tight text-white/90 sm:text-[23px]">
                    What should we work on?
                </p>

                <div className="w-full max-w-md">
                    <div className="tc-composer px-3.5 pb-2.5 pt-3">
                        <p className="min-h-[30px] text-[13px] text-white/25">Work with Tripplet</p>
                        <div className="flex items-center gap-1.5">
                            <span className="tc-chip grid h-6 w-6 place-items-center">
                                <Glyph d={PATH.plus} size={14} />
                            </span>
                            <span className="tc-chip flex h-6 items-center gap-1.5 px-2 text-[11.5px]">
                                <svg
                                    viewBox="0 0 24 24"
                                    width={13}
                                    height={13}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={1.6}
                                >
                                    <path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6L12 3z" />
                                </svg>
                                Approve for me
                            </span>
                            <span className="flex-1" />
                            <span className="text-[11.5px] text-white/45">Astro 5.1</span>
                            <span className="text-[11.5px] text-white/30">Ultra</span>
                            <span className="tc-send">
                                <Glyph d={PATH.send} size={13} />
                            </span>
                        </div>
                    </div>

                    <div className="tc-foot mx-5 mt-1.5 flex h-8 items-center gap-2 px-2.5">
                        <span className="flex items-center gap-1.5 text-[11.5px] text-white/45">
                            <Glyph d={PATH.folder} size={13} />
                            tripplet-sonoma
                        </span>
                        <span className="flex items-center">
                            {['#4285f4', '#ea4335', '#34a853'].map((color, index) => (
                                <span
                                    key={color}
                                    className="h-3 w-3 rounded-[3px]"
                                    style={{
                                        background: color,
                                        marginLeft: index ? -3 : 0,
                                        boxShadow: '0 0 0 1.5px #232325',
                                    }}
                                />
                            ))}
                            <span className="ml-2 text-[11.5px] text-white/45">Plugins</span>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}
