import { describe, it, expect } from 'vitest';
import { sameRedirectUri, matchRedirectUri } from '@/lib/mcp/oauth';

describe('sameRedirectUri', () => {
  it('matches loopback host spellings', () => {
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'http://localhost:9271/callback')).toBe(true);
    expect(sameRedirectUri('http://localhost:9271/callback', 'http://127.0.0.1:9271/callback')).toBe(true);
    expect(sameRedirectUri('http://[::1]:9271/callback', 'http://127.0.0.1:9271/callback')).toBe(true);
  });
  it('still requires port, path and scheme to match', () => {
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'http://localhost:9272/callback')).toBe(false);
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'http://localhost:9271/evil')).toBe(false);
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'https://localhost:9271/callback')).toBe(false);
  });
  it('never widens matching to non-loopback hosts', () => {
    expect(sameRedirectUri('https://example.com/cb', 'https://evil.com/cb')).toBe(false);
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'http://evil.com:9271/callback')).toBe(false);
    expect(sameRedirectUri('http://127.0.0.1:9271/callback', 'http://127.0.0.1.evil.com:9271/callback')).toBe(false);
    expect(sameRedirectUri('https://example.com/cb', 'https://example.com/cb')).toBe(true);
  });
  it('rejects junk without throwing', () => {
    expect(sameRedirectUri('not a url', 'http://localhost:9271/callback')).toBe(false);
    expect(sameRedirectUri('', '')).toBe(true);
  });
  it('matchRedirectUri returns the registered spelling', () => {
    const reg = ['http://127.0.0.1:9271/callback', 'http://127.0.0.1:9272/callback'];
    expect(matchRedirectUri(reg, 'http://localhost:9272/callback')).toBe('http://127.0.0.1:9272/callback');
    expect(matchRedirectUri(reg, 'http://localhost:9999/callback')).toBeUndefined();
    expect(matchRedirectUri(reg, null)).toBeUndefined();
  });
});
