import { useState } from 'react';
import { ChatSidebar, AI_MODELS } from './ChatSidebar';
import { CodePreview } from './CodePreview';
import { useCodeGeneration } from '@/hooks/useCodeGeneration';

export function CoderWorkspace() {
    const [selectedModel, setSelectedModel] = useState(AI_MODELS[0]);
    const {
        messages,
        generatedFiles,
        isGenerating,
        currentFileIndex,
        streamedContent,
        sendMessage,
        clearConversation,
    } = useCodeGeneration();

    return (
        <div className="h-screen flex overflow-hidden bg-neutral-950">
            {/* Chat sidebar */}
            <div className="w-80 flex-shrink-0">
                <ChatSidebar
                    messages={messages}
                    isGenerating={isGenerating}
                    onSendMessage={(content, model) => sendMessage(content, model)}
                    onClear={clearConversation}
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                />
            </div>

            {/* Code preview */}
            <div className="flex-1">
                <CodePreview
                    files={generatedFiles}
                    streamedContent={streamedContent}
                    currentFileIndex={currentFileIndex}
                    isGenerating={isGenerating}
                />
            </div>
        </div>
    );
}
