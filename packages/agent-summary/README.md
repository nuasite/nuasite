# @nuasite/agent-summary

`@nuasite/agent-summary` is a tiny Astro integration that turns your built site into a machine-readable catalog (`AGENTS.md`) for agentic or LLM-driven tooling. During `astro build` it walks every generated HTML page, extracts lightweight metadata, captures redirects, and keeps several machine-friendly blocks in `AGENTS.md` up to date.

## What it does

- Discovers every concrete page emitted by Astro (skipping redirect-only routes).
- Reads the built HTML, normalizes the title/description, and records prominent headings as contextual breadcrumbs.
- Serializes each page (and redirect) into JSONL blocks bounded by dedicated `<page_summary*>` markers.
- Creates `AGENTS.md` if it does not exist, or replaces only the generated blocks when they already exist.

The resulting file can be fed directly into embeddings, vector stores, or custom command palettes so an agent always has a fresh summary of your documentation surface.

## Installation

```bash
bun add -D @nuasite/agent-summary
# or: npm install -D @nuasite/agent-summary
```

## Usage

1. Ensure there is an `AGENTS.md` at the project root (the integration will create one if it is missing).
2. Register the integration in your `astro.config.mjs`:

```ts
import { agentsSummary } from '@nuasite/agent-summary'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [
		agentsSummary(),
	],
})
```

3. Run your normal build (`bun run astro build`, `npm run build`, etc.). When the build finishes you should see a log similar to:

```
[agents-summary] Updated AGENTS.md with 42 page entries and 3 redirects.
```

### Generated blocks

`updateAgentsSummary` writes (or updates) sections inside `AGENTS.md`. You can keep anything you like before/between/after them; only the content between `<page_summary>` marker pair is ever rewritten.

JSONL excerpt:

```
<page_summary>
{"kind":"page","route":"/docs/getting-started","title":"Getting started","description":"Overview of the quickstart workflow.","headlines":[{"level":"h1","text":"Getting started"},{"level":"h2","text":"Install"}]}
{"kind":"redirect","route":"/old-path","to":"/docs/getting-started","status":"302"}
</page_summary>
```

## Development

The package is written in TypeScript and tested with Bun:

```bash
bun install
bun test packages/agent-summary/tests/cases/unit/utils.test.ts
```

`src/agent-summary-integration.ts` contains the integration entry point, while `src/utils.ts` focuses on parsing HTML, detecting redirects, and keeping `AGENTS.md` synchronized.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
