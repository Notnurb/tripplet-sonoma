import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Apple, Smartphone, Monitor } from 'lucide-react';
import Link from 'next/link';

interface CardButton {
    text: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'secondary' | 'ghost' | 'outline' | 'link';
    onClick?: () => void;
    href?: string;
    externalHref?: string;
    noBorder?: boolean;
}

interface DownloadCardProps {
    title: string;
    description: string;
    buttons: CardButton[];
}

const DownloadCard: React.FC<DownloadCardProps> = ({
    title,
    description,
    buttons,
}) => {
    return (
        <div className="group relative flex h-[280px] w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-black p-6 transition-all duration-300 hover:border-white/20">
            {/* Card Content */}
            <div className="relative z-10 mb-4">
                <h3 className="text-xl font-semibold text-white">{title}</h3>
                <p className="text-sm text-white/60">{description}</p>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action Buttons */}
            <div className="relative z-10 mt-4 flex flex-wrap gap-2">
                {buttons.map((button, index) => {
                    const buttonContent = (
                        <>
                            {button.icon && <span>{button.icon}</span>}
                            {button.text}
                        </>
                    );

                    const buttonClassName = cn(
                        "flex items-center gap-2 bg-black text-white hover:bg-white/10",
                        button.noBorder ? "border-0" : "border border-white/20"
                    );

                    if (button.externalHref) {
                        return (
                            <a key={index} href={button.externalHref} target="_blank" rel="noopener noreferrer">
                                <Button
                                    variant={button.variant || 'default'}
                                    className={buttonClassName}
                                >
                                    {buttonContent}
                                </Button>
                            </a>
                        );
                    }

                    if (button.href) {
                        return (
                            <Link key={index} href={button.href}>
                                <Button
                                    variant={button.variant || 'default'}
                                    className={buttonClassName}
                                >
                                    {buttonContent}
                                </Button>
                            </Link>
                        );
                    }

                    return (
                        <Button
                            key={index}
                            variant={button.variant || 'default'}
                            onClick={button.onClick}
                            className={buttonClassName}
                        >
                            {buttonContent}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
};

export const DownloadShowcase = () => {
    const downloadOptions: DownloadCardProps[] = [
        {
            title: 'Desktop App',
            description: 'Search on your desktop',
            buttons: [
                { text: 'Download on Mac', icon: <Apple className="h-4 w-4" />, externalHref: 'https://drive.google.com/file/d/1UIFQrYp8VHyt42RqMPODYWmlnzniAKtM/view?usp=sharing' },
                { text: 'Windows (ARM)', icon: <Monitor className="h-4 w-4" />, externalHref: 'https://drive.google.com/file/d/1xbKs8rscwQUe91ME46Jp44xwRekYL8Fp/view?usp=drive_link' },
            ],
        },
        {
            title: 'iOS & Android App',
            description: 'Take the experience on the go',
            buttons: [
                { text: 'iOS', icon: <Apple className="h-4 w-4" />, href: '#' },
                { text: 'Android', icon: <Smartphone className="h-4 w-4" />, href: '#' },
            ],
        },
        {
            title: 'Browser Extension',
            description: 'Integrate directly into your browser',
            buttons: [{ text: 'Coming Soon', variant: 'secondary' as const, noBorder: true }],
        },
    ];

    return (
        <>
            <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
      `}</style>

            <div className="w-full py-16">
                <div className="mx-auto max-w-6xl px-6">
                    <h2 className="mb-12 text-center text-3xl font-bold text-white md:text-4xl">
                        Use The Experience Anywhere You Ask Questions
                    </h2>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                        {downloadOptions.map((card, index) => (
                            <DownloadCard key={index} {...card} />
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
};
