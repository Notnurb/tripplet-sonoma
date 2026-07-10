-- ============================================================
-- Tripplet — Neon (PostgreSQL) schema for the non-Prisma tables
-- Run this once in the Neon SQL Editor (console.neon.tech → SQL Editor).
--
-- The relational core (User, Conversation, Message, PasswordResetToken,
-- UserMemory, FileUpload, AIUsage) is managed by Prisma — apply it with
-- `npx prisma migrate deploy`. The tables below are accessed via raw SQL and
-- are NOT in the Prisma schema, so create them with this file.
-- ============================================================

create extension if not exists pg_trgm;

-- ── Triplepedia articles ───────────────────────────────────────────────────
create table if not exists triplepedia_articles (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    slug text unique not null,
    summary text not null default '',
    sections jsonb not null default '[]'::jsonb,
    infobox jsonb not null default '[]'::jsonb,
    category text,
    tags text[] not null default '{}',
    view_count integer not null default 0,
    submitted_by text,
    fact_checked_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    status text not null default 'published'
        check (status in ('published', 'pending', 'rejected'))
);

create index if not exists triplepedia_articles_slug_idx on triplepedia_articles (slug);
create index if not exists triplepedia_articles_title_idx on triplepedia_articles using gin (title gin_trgm_ops);
create index if not exists triplepedia_articles_category_idx on triplepedia_articles (category) where status = 'published';
create index if not exists triplepedia_articles_view_count_idx on triplepedia_articles (view_count desc) where status = 'published';
create index if not exists triplepedia_articles_created_at_idx on triplepedia_articles (created_at desc) where status = 'published';

-- ── Triplepedia reactions ──────────────────────────────────────────────────
create table if not exists triplepedia_reactions (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references triplepedia_articles(id) on delete cascade,
    reaction_type text not null check (reaction_type in ('mind_blown', 'til', 'want_more', 'funny')),
    count integer not null default 0,
    unique (article_id, reaction_type)
);

create index if not exists triplepedia_reactions_article_idx on triplepedia_reactions (article_id);

-- ── Deployed projects (Epsilon code page share links) ──────────────────────
create table if not exists deployed_projects (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null default 'Untitled',
    html text not null,
    created_at timestamptz default now()
);

create index if not exists deployed_projects_slug_idx on deployed_projects (slug);

-- ── Developer API keys ─────────────────────────────────────────────────────
create table if not exists developer_api_keys (
    id uuid primary key default gen_random_uuid(),
    user_email text not null,
    key_hash text not null unique,
    key_prefix text not null,
    name text not null default 'Default',
    is_revoked boolean not null default false,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
);

create index if not exists developer_api_keys_user_email_idx on developer_api_keys (user_email);

-- ── MCP OAuth 2.1 (Authorization Server + Resource Server) ──────────────────
-- Backs the remote MCP server at /api/mcp. External AI clients (Claude, Codex,
-- Cursor, …) register dynamically, run the authorization-code + PKCE flow
-- against Sonoma, and present the resulting bearer token to /api/mcp.

-- Dynamically registered OAuth clients (RFC 7591). Public clients (PKCE), so
-- no client secret is stored.
create table if not exists oauth_clients (
    client_id text primary key,
    client_name text,
    redirect_uris text[] not null default '{}',
    grant_types text[] not null default '{authorization_code,refresh_token}',
    token_endpoint_auth_method text not null default 'none',
    created_at timestamptz not null default now()
);

-- Short-lived authorization codes. Stored hashed; single-use (deleted on
-- exchange). code_challenge is the PKCE S256 challenge.
create table if not exists oauth_authorization_codes (
    code_hash text primary key,
    client_id text not null,
    user_email text not null,
    redirect_uri text not null,
    code_challenge text not null,
    code_challenge_method text not null default 'S256',
    scope text not null default 'mcp',
    resource text,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

-- Access + refresh tokens (opaque, stored hashed). One row per access token;
-- refresh rotates the row in place.
create table if not exists oauth_access_tokens (
    token_hash text primary key,
    client_id text not null,
    user_email text not null,
    scope text not null default 'mcp',
    resource text,
    refresh_token_hash text,
    expires_at timestamptz not null,
    refresh_expires_at timestamptz,
    is_revoked boolean not null default false,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
);

create index if not exists oauth_access_tokens_refresh_idx on oauth_access_tokens (refresh_token_hash);
create index if not exists oauth_access_tokens_user_idx on oauth_access_tokens (user_email);
create index if not exists oauth_codes_expires_idx on oauth_authorization_codes (expires_at);
