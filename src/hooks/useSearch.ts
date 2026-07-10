'use client';

import { useState, useCallback } from 'react';
import { SearchResult } from '@/types';

/**
 * useSearch — Hook for web search via the Python backend proxy.
 */
export function useSearch() {
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [lastQuery, setLastQuery] = useState('');
    const [sources, setSources] = useState<{ exa: number }>({ exa: 0 });

    const search = useCallback(async (
        query: string,
        numResults = 10,
        source: 'combined' | 'exa' = 'combined',
        category?: string,
    ): Promise<SearchResult[]> => {
        setIsSearching(true);
        setLastQuery(query);

        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, num_results: numResults, source, category }),
            });

            if (!res.ok) {
                throw new Error(`Search failed: ${res.status}`);
            }

            const data = await res.json();
            const results = data.results || [];
            setSearchResults(results);
            setSources(data.sources || { exa: 0 });
            return results;
        } catch (e) {
            console.error('Search error:', e);
            return [];
        } finally {
            setIsSearching(false);
        }
    }, []);

    const clearResults = useCallback(() => {
        setSearchResults([]);
        setLastQuery('');
        setSources({ exa: 0 });
    }, []);

    /**
     * Format search results into a context string for injection into prompts.
     */
    const formatForContext = useCallback((results?: SearchResult[]): string => {
        const r = results || searchResults;
        if (r.length === 0) return '';

        const parts = ['Web search results:'];
        r.slice(0, 8).forEach((result, i) => {
            parts.push(`[${i + 1}] ${result.title}`);
            if (result.url) parts.push(`    ${result.url}`);
            if (result.highlights?.length) {
                parts.push(`    ${result.highlights[0].slice(0, 200)}`);
            }
        });
        return parts.join('\n');
    }, [searchResults]);

    return {
        searchResults,
        isSearching,
        lastQuery,
        sources,
        search,
        clearResults,
        formatForContext,
    };
}
