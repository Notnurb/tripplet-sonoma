// Sonoma icons — Hugeicons where available, custom inline SVGs otherwise.
import type { SVGProps } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
    Navigation03Icon,
    CodesandboxIcon,
    AirplaneTakeOff01Icon,
    SidebarLeft01Icon,
    BubbleChatAddIcon,
    BubbleChatIcon,
    Cancel01Icon,
    ArrowDown01Icon,
    Tick02Icon,
    Attachment01Icon,
    Globe02Icon,
    Brain01Icon,
    StopCircleIcon,
    ThumbsUpIcon,
    ThumbsDownIcon,
    Refresh01Icon,
    Copy01Icon,
    File01Icon,
    FileBracesIcon,
} from '@hugeicons/core-free-icons';

type IconProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
};

function HI({
    icon,
    size = 18,
    color,
    strokeWidth,
    ...rest
}: {
    icon: IconSvgElement;
    size?: number;
    color?: string;
    strokeWidth?: number;
} & React.HTMLAttributes<HTMLSpanElement>) {
    return (
        <span
            {...rest}
            style={{
                display: 'inline-flex',
                color: color || 'currentColor',
                ...(rest.style || {}),
            }}
        >
            <HugeiconsIcon
                icon={icon}
                size={size}
                color={color || 'currentColor'}
                strokeWidth={strokeWidth ?? 1.7}
            />
        </span>
    );
}

export function SonomaLogo({ size = 22, color, ...rest }: IconProps) {
    return <HI icon={CodesandboxIcon} size={size} color={color} {...(rest as object)} />;
}

export function SonomaSend({ size = 18, ...rest }: IconProps) {
    return <HI icon={Navigation03Icon} size={size} strokeWidth={1.8} {...(rest as object)} />;
}

export function SonomaNewChat({ size = 18, ...rest }: IconProps) {
    return <HI icon={BubbleChatAddIcon} size={size} {...(rest as object)} />;
}

export function SonomaSidebar({ size = 18, ...rest }: IconProps) {
    return <HI icon={SidebarLeft01Icon} size={size} {...(rest as object)} />;
}

export function SonomaChat({ size = 18, ...rest }: IconProps) {
    return <HI icon={BubbleChatIcon} size={size} {...(rest as object)} />;
}

// Custom inline Codepen-style mark — Hugeicons free set does not ship Codepen.
export function SonomaCode({ size = 18, color, ...rest }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            {...rest}
        >
            {/* Codepen-style hexagonal frame */}
            <path d="M12 2.5 22 8.5v7L12 21.5 2 15.5v-7L12 2.5Z" />
            <path d="M2 8.5 12 15l10-6.5" />
            <path d="M22 15.5 12 9 2 15.5" />
            <path d="M12 2.5V9" />
            <path d="M12 15v6.5" />
        </svg>
    );
}

export function SonomaAgent({ size = 18, ...rest }: IconProps) {
    return <HI icon={AirplaneTakeOff01Icon} size={size} {...(rest as object)} />;
}

export function SonomaRefresh({ size = 16, ...rest }: IconProps) {
    return <HI icon={Refresh01Icon} size={size} {...(rest as object)} />;
}

export function SonomaCopy({ size = 16, ...rest }: IconProps) {
    return <HI icon={Copy01Icon} size={size} {...(rest as object)} />;
}

export function SonomaCheck({ size = 16, ...rest }: IconProps) {
    return <HI icon={Tick02Icon} size={size} strokeWidth={2} {...(rest as object)} />;
}

export function SonomaProjectFiles({ size = 18, ...rest }: IconProps) {
    return <HI icon={FileBracesIcon} size={size} {...(rest as object)} />;
}

export function SonomaThumbUp({ size = 16, ...rest }: IconProps) {
    return <HI icon={ThumbsUpIcon} size={size} {...(rest as object)} />;
}

export function SonomaThumbDown({ size = 16, ...rest }: IconProps) {
    return <HI icon={ThumbsDownIcon} size={size} {...(rest as object)} />;
}

export function SonomaStop({ size = 14, ...rest }: IconProps) {
    return <HI icon={StopCircleIcon} size={size} {...(rest as object)} />;
}

export function SonomaClip({ size = 18, ...rest }: IconProps) {
    return <HI icon={Attachment01Icon} size={size} {...(rest as object)} />;
}

export function SonomaBrowse({ size = 16, ...rest }: IconProps) {
    return <HI icon={Globe02Icon} size={size} {...(rest as object)} />;
}

export function SonomaReason({ size = 16, ...rest }: IconProps) {
    return <HI icon={Brain01Icon} size={size} {...(rest as object)} />;
}

export function SonomaChevron({ size = 14, ...rest }: IconProps) {
    return <HI icon={ArrowDown01Icon} size={size} strokeWidth={2} {...(rest as object)} />;
}

export function SonomaX({ size = 14, ...rest }: IconProps) {
    return <HI icon={Cancel01Icon} size={size} strokeWidth={2} {...(rest as object)} />;
}

export function SonomaFile({ size = 14, ...rest }: IconProps) {
    return <HI icon={File01Icon} size={size} {...(rest as object)} />;
}

// Plug / connector mark — used by the chat Connectors menu (Composio apps).
export function SonomaPlug({ size = 16, color, ...rest }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            {...rest}
        >
            <path d="M9 7V3.5" />
            <path d="M15 7V3.5" />
            <path d="M6.5 7h11v4a5.5 5.5 0 0 1-11 0V7Z" />
            <path d="M12 16.5V19a2.5 2.5 0 0 1-2.5 2.5H8" />
        </svg>
    );
}

// Penguin mark (Tux-style) — used by the Tripplet Sandboxed Linux (run_bash)
// activity card so it reads as "a real Linux VM", not just a generic shell.
export function SonomaPenguin({ size = 16, color, ...rest }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            {...rest}
        >
            <path d="M12 2.5c-2.6 0-4.4 2-4.4 4.6 0 1.1.2 1.9.5 2.7-1.6 1.4-2.6 3.7-2.6 6.4 0 3 1.7 5.3 3.2 5.3.6 0 .8-.4 1-1l.3-1.1c.3-.9.6-1.2 2-1.2s1.7.3 2 1.2l.3 1.1c.2.6.4 1 1 1 1.5 0 3.2-2.3 3.2-5.3 0-2.7-1-5-2.6-6.4.3-.8.5-1.6.5-2.7 0-2.6-1.8-4.6-4.4-4.6Z" />
            <circle cx="10.2" cy="8.3" r="0.6" fill={color || 'currentColor'} stroke="none" />
            <circle cx="13.8" cy="8.3" r="0.6" fill={color || 'currentColor'} stroke="none" />
            <path d="M11 10.3h2l-1 1.3-1-1.3Z" fill={color || 'currentColor'} stroke="none" />
            <path d="M8.6 13.2c-1 .5-1.7 1.4-2 2.6M15.4 13.2c1 .5 1.7 1.4 2 2.6" />
        </svg>
    );
}

// Terminal / command-line mark — used by the Tripplet Sandboxed Linux (bash) skill.
export function SonomaTerminal({ size = 16, color, ...rest }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            {...rest}
        >
            <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
            <path d="m6.5 9 3 3-3 3" />
            <path d="M12.5 15h5" />
        </svg>
    );
}
