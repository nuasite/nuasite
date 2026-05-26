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

CLI wrapper that proxies `build`/`dev`/`preview` to `astro` and adds project-level commands (`init`, `clean`, `migrate`).

### How it Works

1. Entry point (`src/index.ts`) parses commands
2. `build`/`dev`/`preview` shell out to `npx astro <command>` so the user's Astro config (typically built via `@nuasite/nua`) is used
3. `init`/`clean`/`migrate` rewrite the project's Astro config and `package.json`

### Key Files

- `src/index.ts` — CLI entry point (shebang `#!/usr/bin/env bun`), command parsing and Astro invocation
- `src/init.ts` / `src/clean.ts` / `src/migrate.ts` — Project transformation commands

### CLI Arguments

- `build` — Proxies to `astro build`
- `dev` — Proxies to `astro dev`
- `preview` — Proxies to `astro preview`
- `init` / `clean` / `migrate` — Project transformations
- `help` — Shows usage

## Key Entry Point

`src/index.ts` is both the library export and the CLI binary entry (`bin.nua` in package.json).
