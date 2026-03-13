# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Commands

```bash
# Run tests
bun test packages/agent-summary
```

## Architecture

Astro integration that generates `AGENTS.md` — a machine-readable catalog of site pages for LLM/agentic tooling consumption.

### How it Works

1. Hooks into `astro:routes:resolved` to track redirect routes
2. Hooks into `astro:build:done` to read all built HTML files
3. Extracts title, description, and headings from HTML using regex
4. Serializes as JSONL records between `<page_summary>` markers in `AGENTS.md`
5. Creates/updates only the generated block, preserving user content around it

### Key Files

- `src/agent-summary-integration.ts` — Core integration logic with Astro lifecycle hooks
- `src/utils.ts` — HTML parsing, text sanitization, route normalization, and `AGENTS.md` file management
- `src/types.ts` — `PageMeta` and `RedirectMeta` types

## Key Entry Point

`src/index.ts` exports:

- `agentsSummary(options)` — the Astro integration (default export)
- Types: `PageMeta`, `RedirectMeta`
