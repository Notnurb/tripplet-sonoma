'use client';

import { createContext, useContext } from 'react';

const StreamingContext = createContext(false);
export const StreamingProvider = StreamingContext.Provider;
export const useIsStreaming = () => useContext(StreamingContext);

export interface WebBlock {
    lang: string;
    code: string;
}

const BundleContext = createContext<WebBlock[]>([]);
export const BundleProvider = BundleContext.Provider;
export const useWebBundle = () => useContext(BundleContext);
