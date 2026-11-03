# @nuasite/astro-fragments

Astro integration that extracts marked components out of page HTML at build time. Each page keeps a `<x-fragment id="<hash>">` placeholder, and the
component's HTML is written once to `dist/_fragments/<hash>.html`. An edge layer (for example a Worker using `HTMLRewriter`) stitches the fragments back
into the page at request time.

The point: when a shared block changes (a "latest posts" listing, a footer), you upload one HTML snippet instead of every page that includes it. The
site build itself does the same work; the saving is in deploy and CDN traffic.

## Installation

```bash
bun add @nuasite/astro-fragments
# or: npm install @nuasite/astro-fragments
```

## Usage

Register the integration. It requires `output: 'static'`:

```ts
import fragments from '@nuasite/astro-fragments'
import { defineConfig } from 'astro/config'

export default defineConfig({
	output: 'static',
	integrations: [fragments()],
})
```

Wrap a component in the bundled component and pass its props through `props`:

```astro
---
import NuaFragment from '@nuasite/astro-fragments/Fragment.astro'
import LatestPosts from '../fragments/LatestPosts.astro'
import RelatedPosts from '../fragments/RelatedPosts.astro'
---
<NuaFragment of={LatestPosts} props={{}} />
<NuaFragment of={RelatedPosts} props={{ slug: post.slug }} />
```

Import the component under any name except `Fragment`: Astro's compiler already declares `Fragment` in every component, so a local import with that
name does not parse. `props` is typed from the target component's `Props`, so `astro check` reports missing or mistyped props.

## Behaviour

- **Dev (`astro dev`)**: `<NuaFragment of={X} props={p} />` renders `<X {...p} />` inline. No placeholder, no extra request.
- **Build (`astro build`)**: the page gets `<x-fragment id="<hash>"></x-fragment>`, the component is rendered once per distinct `(component, props)` pair
  into `_fragments/<hash>.html`, and `_fragments/manifest.json` describes every fragment.
- **Identity**: the id is the first 12 hex characters of `sha1(projectRelativeModuleId + "::" + JSON of the props with sorted keys)`. The same
  component with the same props on any number of pages gives one id and one file.
- **Props** must be plain JSON values. `Date`, `Map`, `Set`, class instances, functions, symbols, bigints and circular references are rejected with
  the offending key path.
- **Placeholders without a fragment** (a stale `dist/`, a hand-written `<x-fragment>`) fail the build.
- SSR and hybrid output are rejected in `astro:config:setup`.

## Manifest

```json
{
	"version": 1,
	"generatedAt": "2026-01-01T00:00:00.000Z",
	"outputDir": "_fragments",
	"fragments": {
		"3f1c0a9b2e4d": {
			"id": "3f1c0a9b2e4d",
			"file": "_fragments/3f1c0a9b2e4d.html",
			"moduleId": "src/fragments/RelatedPosts.astro",
			"props": { "slug": "hello-world" },
			"usedBy": ["blog/hello-world/index.html"],
			"size": 281
		}
	}
}
```

`file` is relative to the build output directory, `moduleId` to the project root, and `usedBy` lists the `dist/`-relative HTML files that contain
the placeholder. Entries and `usedBy` are sorted, so the manifest is stable between builds of the same content (apart from `generatedAt`).

## Options

| Option         | Default           | Description                                           |
| -------------- | ----------------- | ----------------------------------------------------- |
| `outputDir`    | `'_fragments'`    | Directory inside the build output for fragment files. |
| `manifestName` | `'manifest.json'` | Manifest file name, written inside `outputDir`.       |
| `concurrency`  | `8`               | How many fragments are rendered at the same time.     |

## Incremental hosts

A build host that skips unchanged pages (such as `pletivo build --incremental`) can keep the fragment manifest correct through the programmatic API
exported from the package root:

- `runInRenderPass(pageId, render)` runs a page render and returns the fragment ids it registered, so the host can cache them per page.
- `registerFragment({ moduleId, props, pageUrl })` replays a cached registration for a page the host did not render. The integration reuses the
  fragment file already in `dist/`, or imports `moduleId` and renders it when the file is missing.
- Fragments listed in the previous `manifest.json` whose files are still on disk are kept even when no page registered them in this build.

The host is expected to keep `dist/` (including `_fragments/`) between builds. A stock `astro build` cleans `dist/`, so none of this applies there.

## Out of scope

- The edge composition layer that replaces `<x-fragment>` placeholders.
- Tracking which data a fragment depends on; every build renders every registered fragment.
