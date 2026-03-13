# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Commands

```bash
# Build the editor bundle (Preact → dist/editor.js)
bun run build                    # runs: vite build --config vite.config.editor.ts

# Run all CMS tests
bun test packages/cms

# Run a single test file
bun test packages/cms/tests/cases/source-finder/search-index.test.ts

# Update snapshots
bun test --update-snapshots
```

Tests run with `--conditions=typescript` — no build step needed, they import `.ts` source directly.

## Architecture

The CMS is a **bidirectional visual editor** for Astro sites with two core phases:

### Phase 1: Mark (HTML Processing)

Astro hook (`astro:server:setup`) → `html-processor.ts` parses rendered HTML into an AST with `node-html-parser` → walks the AST to mark editable elements with `data-cms-id` attributes → `manifest-writer.ts` generates a per-page `cms-manifest.json` mapping each ID to its source location, text, tag, attributes, colors, and images.

Supporting subsystems:

- **Component Registry** (`component-registry.ts`) — scans `src/components/*.astro`, parses each into an AST via `@astrojs/compiler`, then extracts props from the frontmatter AST via Babel
- **Collection Scanner** (`collection-scanner.ts`) — auto-detects Astro content collections
- **SEO Processor** (`seo-processor.ts`) — extracts title, meta tags, JSON-LD from the HTML AST
- **Tailwind Colors** (`tailwind-colors.ts`) — parses Tailwind config for color editing

### Phase 2: Edit (Dev Server API)

Vite middleware at `/_nua/cms/*` receives edit requests → **source finder** locates the exact file/line → **source writer** applies changes → Vite HMR reloads.

#### Source Finder (`src/source-finder/`)

AST-driven discovery pipeline: `@astrojs/compiler` parses `.astro` files into ASTs (`ast-parser.ts` caches results), then `ast-extractors.ts` walks the ASTs to extract text nodes, image sources, and element metadata into a **search index** (`search-index.ts`) for fast lookups.

Key flow: manifest entry → normalized text + tag → search index match → `element-finder.ts` locates the element in the template AST → if prop/import-based, `cross-file-tracker.ts` parses the frontmatter AST (via Babel) and follows the value to its definition across files.

Caching: parsed ASTs, directory listings, and search indexes are cached and cleared on file watcher changes.

#### Source Writer (`src/handlers/source-writer.ts`)

Line-based text replacement. Changes are grouped by file, sorted by line descending (to avoid offset shifts), then written back with file locking. Handles text, image (`src`/`alt`/`srcset`), color (Tailwind class replacement), and attribute changes.

#### Other Handlers (`src/handlers/`)

- `component-ops.ts` — insert/remove component invocations in page files
- `array-ops.ts` — add/remove elements in `[...array]` spread patterns
- `markdown-ops.ts` — CRUD for content collection entries (YAML frontmatter + body)

### Editor UI (`src/editor/`)

Preact + Preact Signals for state, Milkdown (ProseMirror) for markdown editing. Built separately via `vite.config.editor.ts` into a single `dist/editor.js` bundle.

Two delivery modes:

- **Monorepo dev**: source files served directly, Vite transforms TSX on the fly
- **npm installed**: pre-built `dist/editor.js` read from package

Injected as `<script type="module">` into every dev page.

### Media Storage (`src/media/`)

Pluggable adapter pattern (`MediaStorageAdapter` interface):

- `local.ts` — filesystem (`public/uploads/`)
- `s3.ts` — S3/R2 direct
- `contember.ts` — R2 + database

### Vite Plugins (`src/vite-plugin.ts`)

- Virtual manifest module (`/@cms/manifest`)
- File watcher for cache invalidation
- `vite-plugin-array-transform.ts` — transforms `[...array]` literals for editing support

## Development Guidelines

Prefer AST-based approaches when building new CMS functionality. Use `@astrojs/compiler` for `.astro` template analysis, Babel for frontmatter/JS extraction, and `node-html-parser` for rendered HTML — rather than regex or string matching. The existing `ast-parser.ts` and `ast-extractors.ts` utilities provide cached parsing and node walking to build on.

## Testing

Test utilities in `tests/utils/`:

- `cmsDescribe()` — wraps `describe()` with automatic CMS ID generator reset
- `withTempDir()` — creates temp directory with full Astro project structure (`src/components/`, `src/pages/`, etc.) for integration tests
- `setupCacheReset()` — isolates caches between tests
- Custom assertions: `expectMarked()`, `expectEntry()`, etc.

Pattern: unit tests use `cmsDescribe()` with HTML fixtures; integration tests use `withTempDir()` to write real `.astro` files and run the source finder pipeline against them.

## Key Entry Point

`src/index.ts` exports:

- `nuaCms(options)` — the Astro integration (default export)
- Media adapters: `localMedia()`, `s3Media()`, `contemberMedia()`
- `scanCollections()`, `getProjectRoot()`, `parseMarkdownContent()`
- All types for manifest, components, collections, SEO
