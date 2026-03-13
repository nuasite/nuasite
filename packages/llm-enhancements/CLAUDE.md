# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Commands

```bash
# Run tests
bun test packages/llm-enhancements
```

## Architecture

Astro integration that exposes pages as markdown endpoints (`.md` URLs) for LLM consumption, plus generates `/.well-known/llm.md` and `/llms.txt` discovery endpoints.

### Two Modes

**Dev middleware** (`dev-middleware.ts`):

- Intercepts `.md` URL requests and generates markdown on the fly
- Serves `/.well-known/llm.md` and `/llms.txt` discovery endpoints
- Injects `<link rel="alternate" type="text/markdown">` into HTML responses
- Discovers pages via content collection files + homepage fetch

**Build processor** (`build-processor.ts`):

- Iterates all built pages after `astro:build:done`
- For collections: reads original `.md` source from `src/content`
- For static pages: converts rendered HTML to markdown
- Writes `.md` files alongside HTML in dist
- Generates static `/.well-known/llm.md` and `/llms.txt`

### Key Files

- `src/index.ts` — Integration entry point, registers dev middleware and build processor
- `src/html-to-markdown.ts` — HTML → markdown conversion using `node-html-parser`; excludes nav, footer, header, scripts, forms; handles headings, lists, code blocks, tables, links, images
- `src/markdown-generator.ts` — Adds YAML frontmatter (url, type, generatedAt, source) to markdown output
- `src/llm-endpoint.ts` — Generates `/.well-known/llm.md` with page list
- `src/llms-txt-endpoint.ts` — Generates `/llms.txt` following the llms.txt convention
- `src/cms-marker.ts` — Optional CMS integration, reads content collection metadata from CMS manifest
- `src/paths.ts` — URL/path normalization and `.md` URL ↔ page path conversion

### Configuration Options

- `contentDir` — Location of content collections (default: `src/content`)
- `includeStaticPages` — Generate markdown for non-collection pages (default: `true`)
- `includeFrontmatter` — Include YAML frontmatter in output (default: `true`)
- `llmEndpoint` — Enable `/.well-known/llm.md` (default: `true`)
- `llmsTxt` — Enable `/llms.txt` (default: `true`)

## Key Entry Point

`src/index.ts` exports:

- `llmEnhancements(options)` — the Astro integration (default export)
- Types: `LlmEnhancementsOptions`
