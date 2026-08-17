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

CLI wrapper that proxies `build`/`dev`/`preview` to `astro` and adds project-level commands (`check`, `init`, `clean`, `migrate`).

### How it Works

1. Entry point (`src/index.ts`) parses commands
2. `build`/`dev`/`preview` shell out to `npx astro <command>` so the user's Astro config (typically built via `@nuasite/nua`) is used
3. `init`/`clean`/`migrate` rewrite the project's Astro config and `package.json`
4. `check` validates content and parses source without a build (`checkContent` from `@nuasite/cms-core` + `checkCode` here)

### Key Files

- `src/index.ts` — CLI entry point (shebang `#!/usr/bin/env bun`), command parsing and Astro invocation
- `src/check.ts` — `nua check`: finds the Astro root(s), runs the checks, prints the report. `parseCheckArgs` is the exported pure argv parser (`index.ts` cannot be imported by a test — top-level await plus `process.exit`)
- `src/check-code.ts` — Syntax pass over the project's own `.astro`/`.ts`/`.tsx`
- `src/live-schema.ts` — Imports the project's `content.config.ts` behind an `astro:content` stub and hands `cms-core` real schemas through its port
- `src/init.ts` / `src/clean.ts` / `src/migrate.ts` — Project transformation commands

### CLI Arguments

- `build` — Proxies to `astro build`
- `dev` — Proxies to `astro dev`
- `preview` — Proxies to `astro preview`
- `check` — `--json`, `--strict`, `--content-only`, `--no-live`
- `init` / `clean` / `migrate` — Project transformations
- `help` — Shows usage

### Live schema rules

With the project's real schemas in hand, `checkContent` also reports `entry/schema-rejected` (what the build would
reject — refinements, unions, `.min()`, everything the AST rules stay silent on), `cms/empty-write` (the writes
the CMS editor would make when creating an entry or clicking "+ Add" in a repeater), and the two drift rules in
`cms-core`'s `check-shape.ts` (`cms/required-drift`, `cms/field-degraded` — where the parser's picture of a field
and the schema's disagree). It also stops reporting `entry/missing-required` for a collection whose real schema it
has: `required` there is only the parser's default, and the schema answers the question properly.

Getting them costs an import of the project's config, so three rules govern when they run:

- **Never under `--content-only`** — that flag means "do not look at code", and this executes the project's config.
  `--no-live` opts out without giving up the source parse.
- **Only for a single root.** `Bun.plugin` cannot be undone, so the `astro:content` stub is process-global and
  re-exports one project's `z`; a second project would be validated against the first project's zod. `astroRoots()`
  returning more than one root skips the live rules.
- **A skip is always reported** — one line in human output, the `liveSchemas` field in `--json` (`"ran"` or the
  reason). Never print a stray line in JSON mode; a consumer parses that output.

What they cannot see: the stub reproduces `reference()`'s shape but not the lookup that follows it, and `image()`
accepts anything, so a dangling reference and a missing image are invisible to the live schema.
`entry/dangling-reference` and `entry/missing-asset` in `cms-core` cover those, and must keep doing so.

Both rules attach a `hint` — the remedy, kept out of `message` because it is a proposal rather than something the
checker observed. It is decided by looking up the issue's path in the record that was actually parsed, not by reading
zod's issue code: a missing key and a rejected `''` both arrive as `invalid_type`, and they have opposite remedies.
Getting that backwards is worse than no hint at all, so a new hint needs a test pinning which case it lands on.

## Key Entry Point

`src/index.ts` is both the library export and the CLI binary entry (`bin.nua` in package.json).
