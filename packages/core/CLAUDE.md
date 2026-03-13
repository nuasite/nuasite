# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Architecture

Dependency manifest package — **no source code**. Pins versions of shared Astro integrations for consistency between local dev and Nua Site's build service.

### Pinned Dependencies

- `@astrojs/check` — Type checking for Astro
- `@astrojs/mdx` — MDX support
- `@astrojs/rss` — RSS feed generation
- `@astrojs/sitemap` — Sitemap generation

### How it Works

Versions are defined as `devDependencies` using Bun's catalog resolver (`catalog:astro` references). When installed, ensures all peer dependencies resolve to expected versions. Used by `@nuasite/nua` and downstream projects to lock the toolchain.
