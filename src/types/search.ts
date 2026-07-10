// ─── Web Search ──────────────────────────────────────────────────────────────

export interface SearchResult {
    title: string;
    url: string;
    highlights: string[];
    score?: number;
    published_date?: string;
    source: 'exa' | 'firecrawl';
    raw_content?: string;
}

export interface SearchResponse {
    query: string;
    results: SearchResult[];
    sources: { exa: number; firecrawl?: number };
    timestamp: string;
}
