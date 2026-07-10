"use client";

import { ArrowRight, Bot, Check, ChevronDown, Paperclip } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "framer-motion";

interface UseAutoResizeTextareaProps {
    minHeight: number;
    maxHeight?: number;
}

function useAutoResizeTextarea({
    minHeight,
    maxHeight,
}: UseAutoResizeTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustHeight = useCallback(
        (reset?: boolean) => {
            const textarea = textareaRef.current;
            if (!textarea) return;

            if (reset) {
                textarea.style.height = `${minHeight}px`;
                return;
            }

            textarea.style.height = `${minHeight}px`;

            const newHeight = Math.max(
                minHeight,
                Math.min(
                    textarea.scrollHeight,
                    maxHeight ?? Number.POSITIVE_INFINITY
                )
            );

            textarea.style.height = `${newHeight}px`;
        },
        [minHeight, maxHeight]
    );

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = `${minHeight}px`;
        }
    }, [minHeight]);

    useEffect(() => {
        const handleResize = () => adjustHeight();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [adjustHeight]);

    return { textareaRef, adjustHeight };
}

const TRIPPLET_ICON = (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
);

interface CoderAIInputProps {
    onSubmit?: (prompt: string) => void;
}

export function CoderAIInput({ onSubmit }: CoderAIInputProps) {
    const [value, setValue] = useState("");
    const { textareaRef, adjustHeight } = useAutoResizeTextarea({
        minHeight: 72,
        maxHeight: 300,
    });
    const [selectedModel, setSelectedModel] = useState("Tripplet Coder");

    const AI_MODELS = [
        "Tripplet Coder",
        "Tripplet Coder Pro",
        "Tripplet Coder v1.5",
    ];

    const MODEL_ICONS: Record<string, React.ReactNode> = {
        "Tripplet Coder": TRIPPLET_ICON,
        "Tripplet Coder Pro": TRIPPLET_ICON,
        "Tripplet Coder v1.5": TRIPPLET_ICON,
    };

    const handleSubmit = () => {
        if (!value.trim()) return;
        onSubmit?.(value.trim());
        setValue("");
        adjustHeight(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && value.trim()) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="w-full py-4">
            <div className="relative max-w-xl w-full mx-auto">
                <div className="relative flex flex-col">
                    <div
                        className="overflow-hidden rounded-xl transition shadow-lg
                        bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-800
                        border border-white/20
                        focus-within:ring-2 focus-within:ring-primary/50"
                    >
                        <div className="relative px-3 py-3 min-h-[100px]">
                            <Textarea
                                ref={textareaRef}
                                value={value}
                                placeholder="Describe what you want to build..."
                                className="w-full px-2 py-2 bg-transparent border-none resize-none text-white 
                                placeholder:text-white/50 text-base leading-[1.6] focus-visible:ring-0 min-h-[72px]"
                                onKeyDown={handleKeyDown}
                                onChange={(e) => {
                                    setValue(e.target.value);
                                    adjustHeight();
                                }}
                            />
                        </div>

                        <div className="h-14 bg-white/5 rounded-b-xl flex items-center">
                            <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between w-[calc(100%-24px)]">
                                <div className="flex items-center gap-2">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            className="flex items-center gap-1 h-8 pl-1 pr-2 text-xs rounded-md text-white hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-primary transition-colors focus:outline-none"
                                        >
                                            <AnimatePresence mode="wait">
                                                <motion.div
                                                    key={selectedModel}
                                                    initial={{
                                                        opacity: 0,
                                                        y: -5,
                                                    }}
                                                    animate={{
                                                        opacity: 1,
                                                        y: 0,
                                                    }}
                                                    exit={{
                                                        opacity: 0,
                                                        y: 5,
                                                    }}
                                                    transition={{
                                                        duration: 0.15,
                                                    }}
                                                    className="flex items-center gap-1"
                                                >
                                                    {MODEL_ICONS[selectedModel]}
                                                    <span className="max-w-[140px] truncate">{selectedModel}</span>
                                                    <ChevronDown className="w-3 h-3 opacity-50" />
                                                </motion.div>
                                            </AnimatePresence>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            className={cn(
                                                "min-w-[14rem]",
                                                "border-white/10",
                                                "bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-800"
                                            )}
                                        >
                                            {AI_MODELS.map((model) => (
                                                <DropdownMenuItem
                                                    key={model}
                                                    onSelect={() =>
                                                        setSelectedModel(model)
                                                    }
                                                    className="flex items-center justify-between gap-2"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {MODEL_ICONS[model] || (
                                                            <Bot className="w-4 h-4 opacity-50" />
                                                        )}
                                                        <span className="text-sm">{model}</span>
                                                    </div>
                                                    {selectedModel === model && (
                                                        <Check className="w-4 h-4 text-primary" />
                                                    )}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <div className="h-4 w-px bg-white/10 mx-0.5" />
                                    <label
                                        className={cn(
                                            "rounded-lg p-2 bg-white/5 cursor-pointer",
                                            "hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-primary",
                                            "text-white/40 hover:text-white"
                                        )}
                                        aria-label="Attach file"
                                    >
                                        <input type="file" className="hidden" />
                                        <Paperclip className="w-4 h-4 transition-colors" />
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    className={cn(
                                        "rounded-lg p-2 bg-white/5",
                                        "hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-primary"
                                    )}
                                    aria-label="Send message"
                                    disabled={!value.trim()}
                                    onClick={handleSubmit}
                                >
                                    <ArrowRight
                                        className={cn(
                                            "w-4 h-4 text-white transition-opacity duration-200",
                                            value.trim()
                                                ? "opacity-100"
                                                : "opacity-30"
                                        )}
                                    />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
