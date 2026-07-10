import { useState, useCallback } from 'react';

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isGenerating?: boolean;
}

export interface GeneratedFile {
    name: string;
    content: string;
    language: string;
}

const CODE_TEMPLATES: Record<string, GeneratedFile[]> = {
    'button': [
        {
            name: 'Button.tsx',
            language: 'tsx',
            content: `import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({ 
  variant = 'primary', 
  size = 'md', 
  className,
  children, 
  ...props 
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        {
          'bg-primary text-primary-foreground hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
          'border border-input bg-background hover:bg-accent': variant === 'outline',
        },
        {
          'h-8 px-3 text-sm': size === 'sm',
          'h-10 px-4 text-base': size === 'md',
          'h-12 px-6 text-lg': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}`
        }
    ],
    'card': [
        {
            name: 'Card.tsx',
            language: 'tsx',
            content: `import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

export function Card({ 
  title, 
  description, 
  children, 
  className,
  footer 
}: CardProps) {
  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm',
      'transition-all hover:shadow-md',
      className
    )}>
      {(title || description) && (
        <div className="p-6 pb-4">
          {title && (
            <h3 className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-muted-foreground mt-2">
              {description}
            </p>
          )}
        </div>
      )}
      {children && (
        <div className="p-6 pt-0">
          {children}
        </div>
      )}
      {footer && (
        <div className="flex items-center p-6 pt-0">
          {footer}
        </div>
      )}
    </div>
  );
}`
        }
    ],
    'form': [
        {
            name: 'ContactForm.tsx',
            language: 'tsx',
            content: `import React, { useState } from 'react';
import { Button } from './Button';

interface FormData {
  name: string;
  email: string;
  message: string;
}

export function ContactForm() {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Form submitted:', formData);
    setIsSubmitting(false);
    setFormData({ name: '', email: '', message: '' });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary"
          required
        />
      </div>
      
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary"
          required
        />
      </div>
      
      <div>
        <label htmlFor="message" className="block text-sm font-medium mb-1">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          value={formData.message}
          onChange={handleChange}
          rows={4}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary resize-none"
          required
        />
      </div>
      
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Sending...' : 'Send Message'}
      </Button>
    </form>
  );
}`
        }
    ],
    'default': [
        {
            name: 'Component.tsx',
            language: 'tsx',
            content: `import React from 'react';
import { cn } from '@/lib/utils';

interface ComponentProps {
  className?: string;
  children?: React.ReactNode;
}

export function Component({ className, children }: ComponentProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center p-8',
      'bg-gradient-to-br from-primary/10 to-secondary/10',
      'rounded-2xl border border-border/50',
      'shadow-lg backdrop-blur-sm',
      className
    )}>
      <h2 className="text-2xl font-bold text-foreground mb-4">
        Hello World
      </h2>
      <p className="text-muted-foreground text-center max-w-md">
        This is your custom component generated by Tripplet Coder.
        Customize it to fit your needs!
      </p>
      {children}
    </div>
  );
}

export default Component;`
        },
        {
            name: 'styles.css',
            language: 'css',
            content: `.component-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
  border-radius: 1rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
}

.component-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--foreground);
  margin-bottom: 1rem;
}

.component-description {
  color: var(--muted-foreground);
  text-align: center;
  max-width: 400px;
}`
        }
    ]
};

const ASSISTANT_RESPONSES: string[] = [
    "I'll create that component for you. Let me analyze the requirements and generate the code...",
    "Great choice! I'm generating the code now. This will include proper TypeScript types and styling...",
    "Working on it! I'll make sure to include best practices and clean code patterns...",
    "Generating your component with full TypeScript support and Tailwind CSS styling...",
];

function getTemplateKey(prompt: string): string {
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('button')) return 'button';
    if (lowerPrompt.includes('card')) return 'card';
    if (lowerPrompt.includes('form') || lowerPrompt.includes('contact')) return 'form';
    return 'default';
}

export function useCodeGeneration() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const [streamedContent, setStreamedContent] = useState('');

    const generateId = () => Math.random().toString(36).substring(2, 9);

    const simulateTyping = useCallback(async (text: string, onChar: (char: string) => void) => {
        for (let i = 0; i < text.length; i++) {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
            onChar(text[i]);
        }
    }, []);

    const sendMessage = useCallback(async (content: string, model: string) => {
        if (!content.trim() || isGenerating) return;

        const userMessage: Message = {
            id: generateId(),
            role: 'user',
            content: content.trim(),
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setIsGenerating(true);
        setStreamedContent('');
        setGeneratedFiles([]);
        setCurrentFileIndex(0);

        // Simulate thinking delay
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Add assistant response
        const assistantResponse = ASSISTANT_RESPONSES[Math.floor(Math.random() * ASSISTANT_RESPONSES.length)];
        const assistantMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: assistantResponse,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Simulate analysis delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get template files
        const templateKey = getTemplateKey(content);
        const files = CODE_TEMPLATES[templateKey];

        // Stream each file's content
        for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
            const file = files[fileIdx];
            setCurrentFileIndex(fileIdx);
            setStreamedContent('');

            // Simulate file creation delay
            await new Promise(resolve => setTimeout(resolve, 800));

            // Stream the content character by character
            let currentContent = '';
            await simulateTyping(file.content, (char) => {
                currentContent += char;
                setStreamedContent(currentContent);
            });

            // Add completed file
            setGeneratedFiles(prev => [...prev, file]);

            // Small delay between files
            if (fileIdx < files.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Final completion message
        await new Promise(resolve => setTimeout(resolve, 500));
        const completionMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: `Done! I've generated ${files.length} file${files.length > 1 ? 's' : ''} for you. You can see the code in the editor and preview on the right.`,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, completionMessage]);

        setIsGenerating(false);
    }, [isGenerating, simulateTyping]);

    const clearConversation = useCallback(() => {
        setMessages([]);
        setGeneratedFiles([]);
        setStreamedContent('');
        setCurrentFileIndex(0);
    }, []);

    return {
        messages,
        generatedFiles,
        isGenerating,
        currentFileIndex,
        streamedContent,
        sendMessage,
        clearConversation,
    };
}
