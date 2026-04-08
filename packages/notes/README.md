# @nuasite/notes

Astro integration that adds a Pastel-style comment overlay and a Google Docs-style suggestion overlay alongside `@nuasite/cms`. Designed for content review with non-technical clients on a NuaSite project.

A reviewer opens any page with `?nua-notes` appended to the URL, sees a sidebar of existing notes, can click any element to leave a comment, can select any text to suggest a replacement (with a strikethrough/insertion diff), and can apply accepted suggestions back to the source files in one click. The CMS editor chrome is hidden in review mode and reappears the moment the flag goes away.

## Status

**v0.1 — first usable release.** All five build phases of the original plan are shipped except Phase 5 polish (proxy/sandbox forwarding through the CMS Cloudflare Worker, replies, the agency inbox view, theming, and i18n). The local-first dev flow is feature-complete and verified end-to-end with puppeteer.

## Quick start

```ts
// astro.config.mjs
import { defineConfig } from '@nuasite/nua/config'
import nuaNotes from '@nuasite/notes'

export default defineConfig({
	integrations: [nuaNotes()],
})
```

```bash
bun add -D @nuasite/notes
bun run dev
```

Then:

- `http://localhost:4321/` — normal CMS editor view, notes is invisible
- `http://localhost:4321/?nua-notes` — review mode: sidebar visible, CMS chrome hidden, click "Pick element" to comment or select text to suggest

The `?nua-notes` flag sets a session cookie so subsequent navigation stays in review mode. Click "Exit" in the toolbar to drop back into CMS editing.

## What ships in v0.1

| Feature | Status |
|---|---|
| Dev API at `/_nua/notes/*` (list, create, update, resolve, reopen, delete, apply) | ✓ |
| Local JSON storage at `data/notes/pages/<slug>.json` (atomic writes, per-slug mutex) | ✓ |
| Preact overlay mounted in a shadow DOM (zero CSS leakage either direction) | ✓ |
| `?nua-notes` URL flag + cookie persistence + Exit toggle | ✓ |
| Hide `@nuasite/cms` editor chrome in review mode (mode exclusivity) | ✓ |
| **Pick mode** — hover any `data-cms-id` element, click to comment | ✓ |
| **Selection mode** — select text inside any element, leave a comment OR a range suggestion | ✓ |
| Diff preview (− original / + suggested) on suggestion items in the sidebar | ✓ |
| Anchor re-attachment after page reload — falls back to whitespace-collapsed match | ✓ |
| Stale badge when an anchor can't be found (source drifted) | ✓ |
| **Apply flow** — write the suggestion's replacement back to the source file | ✓ |
| Resolve / reopen / delete actions on every item | ✓ |
| Item author persisted in `localStorage` | ✓ |
| Pre-built bundle (~16 kB gzipped) for npm consumers; source mode for monorepo dev | ✓ |
| Sandbox / proxy mode (Cloudflare Worker forwarding) | Phase 5 |
| Replies / threaded comments | Phase 5 |
| Agency inbox view (cross-page list) | Phase 5 |
| Theming via CSS variables, i18n, screenshot attachments | Phase 5 |

## How it works

`@nuasite/notes` is a sibling Astro integration to `@nuasite/cms`. It does not import a single function from CMS — it only consumes CMS's public surface:

1. **`data-cms-id` attributes** that CMS already injects on every editable element. Notes uses them as anchors for comments and suggestions.
2. **The per-page manifest endpoint** `/<page>.json` that CMS already serves in dev. Notes reads it at create time to capture each anchor's `sourcePath`, `sourceLine`, and `sourceSnippet`.
3. **Vite's HMR full-reload signal** — when notes writes a source file via Apply, CMS's own watcher picks up the change and reloads the page through the standard HMR path.

That's the entire integration surface. Notes does **not** patch, fork, or peer-import CMS internals.

### When the reviewer visits a page with `?nua-notes`

1. The notes loader script (injected on every dev page) reads the URL, sees the flag, and sets the `nua-notes-mode=1` session cookie so subsequent navigation stays in review mode.
2. A single `<style>` element is injected into the host document hiding `#cms-app-host` and `[data-nuasite-cms]`. CMS's DOM is still there, just `display: none`.
3. The Preact overlay mounts inside a shadow DOM attached to `<body>`. Its CSS lives entirely inside the shadow root and never touches the host page.
4. The overlay fetches `/_nua/notes/list?page=<slug>` for existing notes and `/<slug>.json` for the CMS manifest, then renders the toolbar, sidebar, and any range highlights.

### When the reviewer visits a page without the flag

The loader script runs, sees no flag and no cookie, and returns immediately. The shadow DOM is never created. CMS works exactly as it did before notes was installed.

### Production builds

Notes is dev-only, gated on `if (command !== 'dev') return` in every hook. Production builds are unaffected: zero JS, zero CSS, zero middleware. Reviewers use the same dev URL the editor uses, just with a query flag.

## Suggestion data model

One JSON file per page at `<notesDir>/pages/<slug>.json`:

```jsonc
{
	"page": "/inspekce-nemovitosti",
	"lastUpdated": "2026-04-08T12:00:00Z",
	"items": [
		{
			"id": "n-2026-04-08-a3f2b1",
			"type": "comment",
			"targetCmsId": "cms-42",
			"targetSourcePath": "src/content/pages/inspekce-nemovitosti.md",
			"targetSourceLine": 14,
			"targetSnippet": "Kupujete starší byt nebo dům?",
			"range": null,
			"body": "Should be 'Kupujete byt nebo dům', not 'starší'.",
			"author": "Tomáš",
			"createdAt": "2026-04-08T10:23:14Z",
			"status": "open",
			"replies": []
		},
		{
			"id": "n-2026-04-08-7b8c9d",
			"type": "suggestion",
			"targetCmsId": "cms-43",
			"targetSourcePath": "src/content/pages/inspekce-nemovitosti.md",
			"targetSourceLine": 18,
			"targetSnippet": "Detailně prověříme technický stav nemovitosti",
			"range": {
				"anchorText": "Detailně prověříme",
				"originalText": "Detailně prověříme",
				"suggestedText": "Profesionálně prověříme",
				"rationale": "Stronger framing"
			},
			"body": "",
			"author": "Eliška",
			"createdAt": "2026-04-08T11:05:00Z",
			"status": "open",
			"replies": []
		}
	]
}
```

Comments require a non-empty `body`. Suggestions may have an empty body — the diff itself is the message.

### Range survival across edits

Suggestions don't store character offsets. They store the original substring as `range.anchorText`. On reload, the overlay walks the text nodes inside the target element and looks for the anchor:

1. Exact substring match — preferred.
2. Whitespace-collapsed fallback — handles HTML re-flowing.
3. If neither finds the anchor, the suggestion is marked stale and surfaces in the sidebar with a warning badge.

## Apply flow

When the agency clicks **Apply** on an open, non-stale suggestion:

1. The overlay POSTs `/_nua/notes/apply` with the page + item id.
2. The dev API loads the suggestion, resolves `targetSourcePath` against the project root (with a path-traversal guard), reads the file, and finds `range.originalText`.
   - Exactly one occurrence → replace it.
   - Multiple occurrences → pick the one nearest `targetSourceLine` within an 8-line window.
   - Zero occurrences → return 409, mark the suggestion `stale`, leave the file untouched.
3. On success the file is rewritten atomically (`.tmp` + `rename`) and the suggestion's `status` flips to `applied`.
4. Vite's file watcher picks up the source change → HMR reload → the page shows the new text.

The apply module lives in `src/apply/apply-suggestion.ts` and is fully self-contained — it only uses `node:fs`. It does not peer-import `@nuasite/cms`.

## Coexistence with @nuasite/cms

Both packages inject scripts into the same `astro:scripts/page.js` bundle. Mode exclusivity solves the clash:

- Without the URL flag: notes' loader returns early, mounts nothing, doesn't touch the DOM. CMS behaves byte-for-byte the same as before notes was installed.
- With the URL flag: notes injects a stylesheet hiding CMS chrome and mounts its own UI inside a shadow DOM. Click handlers, focus, and z-index never collide because only one of the two UIs is visible at a time.

A future version may negotiate via PostMessage so the two can coexist on screen (e.g. notes visible while CMS edit is active). For v0.1 the toggle is good enough.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. Set `false` to skip injection entirely. Ignored in production builds. |
| `notesDir` | `string` | `'data/notes'` | Project-relative directory where note JSON files live. |
| `urlFlag` | `string` | `'nua-notes'` | URL query parameter that activates review mode. |
| `hideCmsInReviewMode` | `boolean` | `true` | Hide CMS editor chrome when notes mode is active. (Reserved for v0.2; v0.1 always hides.) |
| `proxy` | `string?` | none | Forward `/_nua/notes/*` to this target. Mirrors the `proxy` option on `@nuasite/cms`. (Reserved for Phase 5.) |

## Hosting

No special hosting required. Notes runs entirely inside the same Astro dev server CMS already runs in. The reviewer uses the same URL the editor uses, just with `?nua-notes` appended. JSON files land in the project repo — commit them or `.gitignore` them, your call.

When the project's CMS is configured to forward writes through the existing nuasite Cloudflare Worker (sandbox mode), Phase 5 will add matching forwarding for `/_nua/notes/*`. v0.1 only supports the local-dev path.

## API reference (dev)

All endpoints are mounted under `/_nua/notes/`. Requests and responses are JSON.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/list?page=<page>` | — | `{ page, lastUpdated, items }` |
| `GET` | `/inbox` | — | `{ pages: [...] }` (all pages) |
| `POST` | `/create` | `{ page, type, targetCmsId, body, author, range?, ... }` | `{ item }` |
| `POST` | `/update` | `{ page, id, patch }` | `{ item }` |
| `POST` | `/resolve` | `{ page, id }` | `{ item }` (status → resolved) |
| `POST` | `/reopen` | `{ page, id }` | `{ item }` (status → open) |
| `POST` | `/delete` | `{ page, id }` | `{ ok: true }` |
| `POST` | `/apply` | `{ page, id }` | `{ item, file, before, after }` (200) or `{ item, error, reason }` (409 stale) |

## Architecture

```
NuaSite project (any consumer)
   │
   ├─ @nuasite/cms          → editor + manifest endpoints + data-cms-id markers
   └─ @nuasite/notes        → review overlay (this package)
        │
        ├─ overlay client    → Preact in a shadow DOM, mounted only on ?nua-notes
        │    ├─ reads /<page>.json from @nuasite/cms (read-only)
        │    ├─ talks to /_nua/notes/* via the dev middleware
        │    └─ on apply, the dev middleware rewrites the source file
        │
        └─ dev middleware   → /_nua/notes/* CRUD + apply, JSON storage, HMR full-reload
```

## License

Apache-2.0
