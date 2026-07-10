"use client"

import { useState } from 'react';
import {
    Settings,
    Menu,
    X,
    Bot,
    User,
    Send,
    Loader2,
    Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

// Mock types
interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export default function AIStudio() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Settings
    const [model, setModel] = useState('spark-3');
    const [temperature, setTemperature] = useState([0.7]);
    const [maxTokens, setMaxTokens] = useState([2048]);
    const [streamResponse, setStreamResponse] = useState(true);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isGenerating) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsGenerating(true);

        // Simulate AI response
        setTimeout(() => {
            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `I am running on ${model} with temperature ${temperature}. This is a simulated response for the AI Studio.`
            };
            setMessages(prev => [...prev, aiMsg]);
            setIsGenerating(false);
        }, 1500);
    };

    return (
        <div className="flex h-screen bg-black overflow-hidden">
            {/* Sidebar - Settings */}
            <div className={cn(
                "w-80 border-r border-white/10 bg-neutral-900/50 flex flex-col transition-all duration-300 absolute md:relative z-20 h-full",
                !isSidebarOpen && "-ml-80"
            )}>
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                        <Settings className="w-4 h-4" />
                        Studio Settings
                    </h2>
                    <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="md:hidden">
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    <div className="space-y-4">
                        <label className="text-sm font-medium text-white/70">Model</label>
                        <Select value={model} onValueChange={(val) => val && setModel(val)}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                                <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent className="bg-neutral-900 border-white/10 text-white">
                                <SelectItem value="spark-3">Spark 3 (Latest)</SelectItem>
                                <SelectItem value="spark-4-preview">Spark 4 Preview (Beta)</SelectItem>
                                <SelectItem value="spark-2">Spark 2 (Legacy)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-white/70">Temperature</label>
                            <span className="text-xs text-white/40">{temperature}</span>
                        </div>
                        <Slider
                            value={temperature}
                            min={0}
                            max={1}
                            step={0.1}
                            onValueChange={setTemperature}
                            className="py-4"
                        />
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-white/70">Max Tokens</label>
                            <span className="text-xs text-white/40">{maxTokens}</span>
                        </div>
                        <Slider
                            value={maxTokens}
                            min={256}
                            max={4096}
                            step={256}
                            onValueChange={setMaxTokens}
                            className="py-4"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-white/70">Stream Response</label>
                        <Switch checked={streamResponse} onCheckedChange={setStreamResponse} />
                    </div>
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-black relative">
                <header className="h-14 border-b border-white/10 flex items-center px-4 justify-between bg-neutral-900/30">
                    <div className="flex items-center gap-3">
                        {!isSidebarOpen && (
                            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)}>
                                <Menu className="w-4 h-4" />
                            </Button>
                        )}
                        <span className="font-medium text-white">Playground</span>
                        <Badge variant="secondary" className="bg-primary/20 text-primary hover:bg-primary/30 border-0">
                            {model}
                        </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Clear
                        </Button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                            <Bot className="w-12 h-12 mb-4" />
                            <p>Start chatting to test your model settings</p>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div key={msg.id} className={cn("flex gap-4 max-w-3xl mx-auto", msg.role === 'user' ? "flex-row-reverse" : "")}>
                                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", msg.role === 'user' ? "bg-primary text-white" : "bg-white/10 text-white")}>
                                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                </div>
                                <div className={cn("rounded-2xl px-4 py-2 max-w-[80%]", msg.role === 'user' ? "bg-primary text-white" : "bg-white/10 text-white")}>
                                    {msg.content}
                                </div>
                            </div>
                        ))
                    )}
                    {isGenerating && (
                        <div className="flex gap-4 max-w-3xl mx-auto">
                            <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4" />
                            </div>
                            <div className="bg-white/10 rounded-2xl px-4 py-2 text-white flex items-center">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Thinking...
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-neutral-900/30">
                    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
                        <Textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            className="resize-none pr-12 bg-white/5 border-white/10 text-white focus:ring-primary min-h-[50px] max-h-[200px]"
                            rows={1}
                        />
                        <Button
                            type="submit"
                            size="icon"
                            className="absolute right-2 bottom-2 h-8 w-8"
                            disabled={!input.trim() || isGenerating}
                        >
                            <Send className="w-4 h-4" />
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
