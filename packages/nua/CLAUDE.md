# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Architecture

Meta-integration that composes all Nua Site packages + official Astro integrations + Tailwind CSS into a single preconfigured stack.

### Key Files

- `src/integration.ts` — Composes sub-integrations in order: Tailwind CSS → CMS → LLM Enhancements → MDX → Sitemap. Also injects a script to hide the Astro dev toolbar (while preserving source annotations needed by CMS).
- `src/config.ts` — Wrapper around Astro's `defineConfig()` with defaults: `site: 'http://localhost:4321'`, `vite.build.sourcemap: true`, `legacy.collectionsBackwardsCompat: true`. Accepts a `nua` options object for per-integration configuration.
- Redirects: the build hook merges the config's `redirects` into the copy of `public/_redirects` (it used to write over it), and `@nuasite/cms` then merges `src/_redirects` on top. Both go through `@nuasite/cms` (`mergeConfigRedirectsInto`, `mergeRedirectsInto`, tested there) over `mergeRedirects` (`@nuasite/cms-core`), which is idempotent, so hook order only decides precedence. See the README's Redirects section.
- `src/types.ts` — `NuaIntegrationOptions` (per-feature toggles), `ResolvedIntegrationOptions`, `resolveOption()` helper that normalizes `boolean | Options` to `Options | false`.

### Composed Integrations

- `@nuasite/cms` — Visual editing in dev
- `@nuasite/llm-enhancements` — Markdown endpoints
- `@astrojs/mdx` — MDX support
- `@astrojs/sitemap` — Sitemap generation
- `@tailwindcss/vite` — Tailwind CSS 4

Each can be disabled or customized via the `nua` options in `defineConfig()`.

### Usage

```ts
// All defaults
import { defineConfig } from '@nuasite/nua/config'
export default defineConfig()

// With customization
import { defineConfig } from '@nuasite/nua/config'
export default defineConfig({
	site: 'https://example.com',
	nua: {
		cms: {/* CMS options */},
		sitemap: false, // disable sitemap
	},
})

// Direct integration usage
import nua from '@nuasite/nua/integration'
import { defineConfig } from 'astro/config'
export default defineConfig({ integrations: [nua()] })
```

## Key Entry Point

`src/index.ts` re-exports:

- Default: `defineConfig` from `./config`
- `/config`: `defineConfig(options)` — config wrapper
- `/integration`: `nua(options)` — raw Astro integration
