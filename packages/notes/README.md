# @nuasite/notes

Astro integration that adds a Pastel-style comment overlay and a Google Docs-style suggestion overlay alongside `@nuasite/cms`. Designed for content review with non-technical clients on a NuaSite project.

## Status

**Phase 0** of 5 (skeleton). The integration mounts and injects a Phase 0 marker script. The full overlay UI, dev API, range suggestions, and apply flow ship in subsequent phases. See `/Users/cross/.claude/plans/smooth-gathering-bunny.md` for the build plan.

## Quick start

```typescript
// astro.config.mjs
import { defineConfig } from '@nuasite/nua/config'
import nuaNotes from '@nuasite/notes'

export default defineConfig({
	integrations: [nuaNotes()],
})
```

Run `astro dev` and open the browser console. You should see a `[nuasite-notes] alive (idle)` log on every page. Append `?nua-notes` to any URL and the marker switches to `(review mode)`.

## How it works

`@nuasite/notes` is a sibling to `@nuasite/cms`. It piggybacks on three things CMS already provides:

1. **`data-cms-id` attributes** on every editable element, used as anchors for comments and suggestions.
2. **Two-tier manifest** (`/cms-manifest.json` global + `/{page}.json` per-page) served as plain JSON, used to map elements back to their source files.
3. **Source-finder utilities** exported from `@nuasite/cms` (used in Phase 4 to apply accepted suggestions back to source files).

When a reviewer visits a page with `?nua-notes` in the URL:

- Notes adds a CSS rule hiding `[data-nuasite-cms]` and the CMS editor toolbar.
- Notes mounts its own Preact overlay (built in Phase 2) in a separate DOM root.
- Comments and suggestions persist to local JSON files at `data/notes/pages/<slug>.json`.

When the reviewer visits a page without the flag, Notes does nothing visible and CMS works as normal.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. Set `false` to skip injection entirely. Ignored in build. |
| `notesDir` | `string` | `'data/notes'` | Project-relative directory where note JSON files live. |
| `hideCmsInReviewMode` | `boolean` | `true` | Hide CMS editor chrome when notes mode is active. |
| `urlFlag` | `string` | `'nua-notes'` | URL query parameter that activates review mode. |
| `proxy` | `string?` | none | Forward `/_nua/notes/*` to this target (sandbox mode). Mirrors the `proxy` option on `@nuasite/cms`. |

## Architecture (target, not Phase 0)

```
NuaSite project (any consumer)
   ↓
@nuasite/notes integration
   ↓ injects on every page
overlay client script (Preact, bundled separately)
   ↓ activates on URL flag
   ├── reads /cms-manifest.json + /{page}.json from @nuasite/cms
   ├── reads /_nua/notes/list?page=<slug> from notes dev middleware
   ├── renders sidebar + element highlights + selection tooltip
   └── on submit, POSTs to /_nua/notes/create
                  ↓
            notes dev middleware (in @nuasite/notes)
                  ↓
            data/notes/pages/<slug>.json (local) or proxy worker (sandbox)
```

## Coexistence with @nuasite/cms

Both packages inject scripts. The clash is solved by mode exclusivity: when the URL flag is absent, Notes mounts nothing visible. When the flag is present, Notes hides CMS chrome via CSS. The two never coexist on screen.

This is intentionally a v0.1 simplification. A future version may negotiate via PostMessage so they can coexist (e.g., comments visible while CMS edit is active).

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Package skeleton, integration entry, marker script | **shipped** |
| 1 | Dev API endpoints + JSON storage layer | next |
| 2 | Overlay v1 (comment-only) + URL flag handling | next |
| 3 | Range suggestions with diff preview | planned |
| 4 | Apply flow (peer-import @nuasite/cms source-finder) | planned |
| 5 | Proxy support, replies, agency inbox, polish | planned |

## License

Apache-2.0
