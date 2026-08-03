# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Build all packages (TypeScript declarations + CMS editor bundle)
bun run build

# TypeScript only
bun run ts:build
bun run ts:watch
bun run ts:clean

# Lint (Biome)
bun run lint
bun run lint:fix

# Format (dprint)
bun run format
bun run format:check

# Test (Bun test runner with happy-dom)
bun test
bun test packages/cms/tests/cases/source-finder/search-index.test.ts  # single file
bun test --update-snapshots

# Run a script in a specific package
bun workspace @nuasite/cms run build
```

## Architecture

Bun monorepo with 16 publishable packages under `packages/`, all revolving around the Astro framework.

### Astro integrations

- **`@nuasite/nua`** — Meta-integration that composes all other integrations into a single `defineConfig()` call.
- **`@nuasite/cms`** — By far the largest package (~42k LOC). Astro integration for inline visual editing. Two core phases:
  1. **HTML processing** — intercepts rendered HTML, parses it with `node-html-parser`, injects `data-cms-id` attributes on editable elements, and generates a per-page manifest (`cms-manifest.json`) mapping IDs to source locations.
  2. **Dev server API** — Vite middleware at `/_nua/cms/*` that reads manifest entries, locates source files, applies edits (text/image/color/component/markdown), and writes them back. Vite HMR picks up changes.
- **`@nuasite/notes`** — Comment + suggestion overlay (Google Docs style) that runs alongside `@nuasite/cms`.
- **`@nuasite/agent-summary`** — Generates `AGENTS.md`, a machine-readable catalog of site pages.
- **`@nuasite/llm-enhancements`** — Exposes pages as `.md` endpoints for LLM consumption.
- **`@nuasite/checks`** — SEO, GEO, performance, accessibility, and AI validation for Astro sites.

### Headless CMS stack

Framework-agnostic layers behind the collections editor. `@nuasite/cms` is the Astro-bound consumer; these are not.

- **`@nuasite/cms-types`** — Shared contract types (collections, fields, entries, pages, redirects, media). The wire model everything else agrees on.
- **`@nuasite/cms-core`** — The CMS brain (collection scan, content-config AST, CRUD, media adapters) over a `FileSystem` port. No Astro, no DOM.
- **`@nuasite/cms-sidecar`** — Standalone Bun HTTP server exposing `cms-core` over `/cms/v1`, decoupled from the site's own version.
- **`@nuasite/cms-client`** — Headless TypeScript SDK over the sidecar contract, plus the pure entry-draft form model. Zero React.
- **`@nuasite/collections-admin`** — Host-agnostic React SPA for browsing and editing collections over the sidecar contract.
- **`@nuasite/cms-mdx-editor`** — React MDX body editor (Milkdown) that round-trips component blocks, props, children, and imports.
- **`@nuasite/cms-studio`** — Batteries-included `bunx` process: sidecar API + prebuilt collections admin UI for the project it launches in.

### Support

- **`@nuasite/cli`** — Thin wrapper around `astro build` with agent-summary integration and improved stack traces.
- **`@nuasite/components`** — Reusable Astro components (Form, Image, ReservationCheckout, etc.).
- **`@nuasite/core`** — Dependency manifest that pins shared Astro integration versions.

**Playground** (`packages/playground/`) is an example Astro site for local development against the packages. It's the one private (unpublished) workspace.

### CMS internals

The CMS editor UI is built with **Preact** + **Milkdown** (ProseMirror-based markdown editor). It's compiled separately via `vite build --config vite.config.editor.ts` and injected into dev pages as a script.

Source finding uses a two-stage pipeline: `@astrojs/compiler` parses `.astro` files into ASTs, then a search index enables fast lookups during editing.

Media storage uses a pluggable adapter pattern (`MediaStorageAdapter`, defined in `@nuasite/cms-types`). The three implementations live in `packages/cms-core/src/media/` and are re-exported from `@nuasite/cms` as `localMedia()` (filesystem, the default), `s3Media()` (S3/R2 direct), and `contemberMedia()` (R2 + database). Pass one as the `media` option; `packages/cms/src/media/types.ts` is now only a re-export shim.

## Code Style

- **Formatter**: dprint — tabs, 150 char line width, semicolons with ASI
- **Linter**: Biome — TypeScript/TSX, imports organization enforced
- **TypeScript**: strict mode, ESNext target, bundler module resolution, `jsx: "react-jsx"` (CMS uses `jsxImportSource: "preact"`)
- Declarations are emit-only (`emitDeclarationOnly: true`); runtime code is consumed as TypeScript directly via `--conditions=typescript`

## Testing

Tests use **Bun's built-in test runner** with `happy-dom` for DOM simulation (preloaded via `happydom.ts`).

Key test helpers in `packages/cms/tests/utils/`:

- `cmsDescribe()` — wraps `describe()` with automatic CMS ID generator reset between tests
- `withTempDir()` — creates a temp directory for integration tests that need file system access
- `setupCacheReset()` — resets caches between tests for isolation
- Custom assertions: `expectMarked()`, `expectEntry()`, etc.

Tests run with `--conditions=typescript` so they import source `.ts` files directly (no build step needed).

## Release

Versions are tagged with `v*` tags. The `publish.yaml` workflow builds and publishes to npm on tag push. Use the `/release` skill to cut a new version.
