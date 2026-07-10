"use client"

import { useState } from 'react';
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { CoderAIInput } from "@/components/ui/coder-ai-input";
import { CoderWorkspace } from "@/components/coder";
import { LandingHeader } from "@/components/ui/landing-header";
import { ArrowRight } from "lucide-react";

export default function Coder() {
    const [isWorkspaceActive, setIsWorkspaceActive] = useState(false);
    const handleStartCoding = (prompt?: string) => {
        if (prompt) {
        }
        setIsWorkspaceActive(true);
    };

    if (isWorkspaceActive) {
        return <CoderWorkspace />; // Note: Initial prompt passing relies on Context or props update if we want to use it. 
        // The original code didn't pass initialPrompt to CoderWorkspace, so I will stick to the original logic for now 
        // but the state `initialPrompt` seems unused in the original `Coder.tsx` beyond setting it.
        // If `CoderWorkspace` needs it, I might need to update it. 
        // Checking `CoderWorkspace.tsx`, it doesn't accept props.
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-black">
            <WebGLShader />
            <LandingHeader />

            <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 pt-16">
                <div className="text-center max-w-2xl mx-auto mb-8">
                    <div className="flex items-center justify-center gap-2 mb-6">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-white/60 text-sm">Available for New Projects</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
                        What will you build?
                    </h1>

                    <p className="text-white/60 text-lg md:text-xl max-w-lg mx-auto">
                        Describe your project and let Tripplet Coder bring it to life with intelligent code generation.
                    </p>
                </div>

                <CoderAIInput onSubmit={handleStartCoding} />

                <div className="mt-8">
                    <LiquidButton size="xl" onClick={() => handleStartCoding()}>
                        Let's Go
                        <ArrowRight className="w-5 h-5" />
                    </LiquidButton>
                </div>
            </div>
        </div>
    );
}
