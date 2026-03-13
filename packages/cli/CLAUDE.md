# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Commands

```bash
# Build standalone binary
bun run build       # bun build src/index.ts → dist/

# Run locally
bun packages/cli/src/index.ts build
```

## Architecture

CLI wrapper around `astro build` with integrated `@nuasite/agent-summary` and enhanced error reporting via stack traces with source context.

### How it Works

1. Entry point (`src/index.ts`) parses `build|dev|preview|help` commands
2. Detects `astro.config.*` and checks if it references the Nua integration
3. If Nua config found, proxies to `npx astro` (preserves existing setup)
4. Otherwise, runs Astro inline with `agentsSummary()` integration injected
5. On build errors, formats stack traces with source context using Stacktracey

### Key Files

- `src/index.ts` — CLI entry point (shebang `#!/usr/bin/env bun`), command parsing and Astro invocation
- `src/build.ts` — Error formatting helper with source context display

### CLI Arguments

- `build` — Runs Astro build
- `dev [--port N] [--host]` — Starts dev server
- `preview [--port N] [--host]` — Starts preview server
- `help` — Shows usage

## Key Entry Point

`src/index.ts` is both the library export and the CLI binary entry (`bin.nua` in package.json).
