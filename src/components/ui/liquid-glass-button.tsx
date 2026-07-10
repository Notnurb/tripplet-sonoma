"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const liquidbuttonVariants = cva(
    "inline-flex items-center transition-colors justify-center cursor-pointer gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    {
        variants: {
            variant: {
                default: "bg-transparent hover:scale-105 duration-300 transition text-primary",
                destructive:
                    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
                outline:
                    "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                secondary:
                    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-accent hover:text-accent-foreground",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                sm: "h-8 text-xs gap-1.5 px-4 has-[>svg]:px-4",
                lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
                xl: "h-12 rounded-md px-8 has-[>svg]:px-6",
                xxl: "h-14 rounded-md px-10 has-[>svg]:px-8",
                icon: "size-9",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "xxl",
        },
    }
)

function GlassFilter() {
    return (
        <svg className="absolute w-0 h-0" aria-hidden="true">
            <defs>
                <filter id="glass-distortion" x="-50%" y="-50%" width="200%" height="200%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.01 0.01"
                        numOctaves="3"
                        seed="5"
                        result="noise"
                    />
                    <feGaussianBlur in="noise" stdDeviation="1.5" result="blurredNoise" />
                    <feDisplacementMap
                        in="SourceGraphic"
                        in2="blurredNoise"
                        scale="25"
                        xChannelSelector="R"
                        yChannelSelector="G"
                        result="displaced"
                    />
                    <feGaussianBlur in="displaced" stdDeviation="0.6" result="finalBlur" />
                    <feMerge>
                        <feMergeNode in="finalBlur" />
                    </feMerge>
                </filter>
            </defs>
        </svg>
    );
}

export interface LiquidButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidbuttonVariants> {
    asChild?: boolean
}

function LiquidButton({
    className,
    variant,
    size,
    asChild = false,
    children,
    ...props
}: LiquidButtonProps) {
    const Comp = asChild ? Slot : "button"

    return (
        <>
            <Comp
                className={cn(liquidbuttonVariants({ variant, size, className }), "relative")}
                {...props}
            >
                <GlassFilter />

                <span
                    className="absolute inset-0 rounded-xl bg-white/5 backdrop-blur-xs"
                    style={{ filter: "url(#glass-distortion)" }}
                />

                <span className="relative z-10 flex items-center gap-2 text-white font-medium">
                    {children}
                </span>

                <span className="absolute inset-0 rounded-xl border border-white/20 pointer-events-none" />
            </Comp>
        </>
    )
}

export { LiquidButton, liquidbuttonVariants }
