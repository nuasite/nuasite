# @nuasite/cms

Astro integration that adds inline visual editing to any Astro site. Scans your components, marks editable elements with CMS IDs, and serves a live editor overlay during development. All write operations (text, images, colors, components, markdown) are handled locally via a built-in dev server — no external backend required.

## Prerequisites

- **Tailwind CSS v4** — Your site must use Tailwind. The CMS color editor, text styling, and class-based editing features all operate on Tailwind utility classes. Without Tailwind, those features won't work.

## Quick Start

```typescript
// astro.config.mjs
import nuaCms from '@nuasite/cms'

export default defineConfig({
	integrations: [nuaCms()],
})
```

Run `astro dev` and the CMS editor loads automatically. Edits write directly to your source files, and Vite HMR picks up the changes instantly.

## How It Works

The integration operates in two phases:

**HTML Processing** — As Astro renders each page, the integration intercepts the HTML response, parses it, and injects `data-cms-id` attributes on editable elements (text, images, components). It generates a per-page manifest mapping each CMS ID to its source file, line number, and code snippet.

**Dev Server API** — When you save an edit in the visual editor, the request goes to `/_nua/cms/*` endpoints running inside Vite's dev middleware. These handlers read the source file, find the snippet, apply the change, and write the file back. Vite HMR triggers a reload.

## Options

```typescript
nuaCms({
	// --- Editor ---
	src: undefined, // Custom editor script URL (default: built-in @app/cms bundle)
	cmsConfig: { // Passed to window.NuaCmsConfig
		apiBase: '/_nua/cms', // API endpoint base (auto-set when using local dev server)
		highlightColor: undefined,
		debug: false,
		theme: undefined,
		themePreset: undefined,
		locale: undefined, // Project language for ordering collection labels; only takes effect as a string literal written in this file (see "Collection Browser")
	},

	// --- Backend ---
	proxy: undefined, // Proxy /_nua requests to a remote backend (e.g. 'http://localhost:8787')
	// When set, the local dev server API is disabled
	media: undefined, // Media storage adapter (default: localMedia() when no proxy)

	// --- Marker ---
	attributeName: 'data-cms-id',
	includeTags: null, // null = all tags
	excludeTags: ['html', 'head', 'body', 'script', 'style'],
	includeEmptyText: false,
	generateManifest: true,
	manifestFile: 'cms-manifest.json',
	markComponents: true,
	componentDirs: ['src/components'],
	contentDir: 'src/content',
	seo: { trackSeo: true, markTitle: true, parseJsonLd: true },
})
```

## Dev Server API

When no `proxy` is configured, the integration spins up a local API at `/_nua/cms/`. This handles all CMS operations without needing the Cloudflare Worker backend.

| Method  | Path                          | Description                                            |
| ------- | ----------------------------- | ------------------------------------------------------ |
| POST    | `/_nua/cms/update`            | Save text, image, color, and attribute changes         |
| POST    | `/_nua/cms/insert-component`  | Insert a component before/after a reference            |
| POST    | `/_nua/cms/remove-component`  | Remove a component from the page                       |
| GET     | `/_nua/cms/markdown/content`  | Read markdown file content + frontmatter               |
| POST    | `/_nua/cms/markdown/update`   | Update markdown file (partial frontmatter merge)       |
| POST    | `/_nua/cms/markdown/create`   | Create a new markdown file in a collection             |
| GET     | `/_nua/cms/media/list`        | List uploaded media files                              |
| POST    | `/_nua/cms/media/upload`      | Upload a file (multipart/form-data)                    |
| DELETE  | `/_nua/cms/media/:id`         | Delete an uploaded file                                |
| GET     | `/_nua/cms/deployment/status` | Returns `{ currentDeployment: null, pendingCount: 0 }` |
| OPTIONS | `/_nua/cms/*`                 | CORS preflight                                         |

### Update Payload

The `POST /update` endpoint accepts a batch of changes:

```typescript
{
  changes: [
    {
      cmsId: 'cms-0',
      newValue: 'Updated heading text',
      originalValue: 'Original heading text',
      sourcePath: 'src/pages/index.astro',
      sourceLine: 42,
      sourceSnippet: '<h1>Original heading text</h1>',
      // Optional for specific change types:
      styleChange: { oldClass: 'bg-blue-500', newClass: 'bg-red-500', type: 'bg' },
      imageChange: { newSrc: '/uploads/photo.webp', newAlt: 'A photo' },
      attributeChanges: [{ attributeName: 'href', oldValue: '/old', newValue: '/new' }],
    }
  ],
  meta: { source: 'cms-editor', url: 'http://localhost:4321/about' }
}
```

Changes are grouped by source file, sorted by line number (descending to avoid offset shifts), and applied in-place. The response returns `{ updated: number, errors?: [...] }`.

## Media Storage Adapters

Media uploads use a pluggable adapter pattern. Three adapters are included:

### Contember (R2 + Database) — Recommended

Files are stored in Cloudflare R2 with metadata tracked in the Contember database. This is the only adapter that gives you proper asset IDs, metadata, and AI-powered image annotation. Use this for production sites.

```typescript
import nuaCms, { contemberMedia } from '@nuasite/cms'

nuaCms({
	media: contemberMedia({
		apiBaseUrl: 'https://api.example.com',
		projectSlug: 'my-project',
		sessionToken: process.env.NUA_SESSION_TOKEN,
	}),
})
```

This adapter calls the worker's `/cms/:projectSlug/media/*` endpoints, which handle R2 upload, Asset record creation, and image annotation. Authentication uses the `NUA_SITE_SESSION_TOKEN` cookie.

### Local Filesystem (default)

Stores files in `public/uploads/`. Served directly by Vite's static file server. Zero configuration needed. Files are committed to your repo alongside your source code.

```typescript
import nuaCms, { localMedia } from '@nuasite/cms'

nuaCms({
	media: localMedia({
		dir: 'public/uploads', // default
		urlPrefix: '/uploads', // default
	}),
})
```

Files are named with UUIDs to avoid collisions. Listed by modification time (newest first).

### S3 / R2 Direct

Direct S3-compatible object storage. Works with AWS S3, Cloudflare R2, MinIO, or any S3-compatible provider. Listing, uploading, and deleting all work, but there is no database layer — content types are not preserved on list, and there are no image dimensions or annotations. Requires `@aws-sdk/client-s3` as a peer dependency.

```typescript
import nuaCms, { s3Media } from '@nuasite/cms'

nuaCms({
	media: s3Media({
		bucket: 'my-bucket',
		region: 'us-east-1',
		// Optional:
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
		endpoint: 'https://account.r2.cloudflarestorage.com', // for R2
		cdnPrefix: 'https://cdn.example.com', // public URL prefix
		prefix: 'uploads', // key prefix in bucket
	}),
})
```

Install the optional dependency:

```bash
npm install @aws-sdk/client-s3
```

### Custom Adapter

Implement the `MediaStorageAdapter` interface to use any storage backend:

```typescript
import type { MediaStorageAdapter } from '@nuasite/cms'

const myAdapter: MediaStorageAdapter = {
	async list(options) {
		// Return { items: MediaItem[], hasMore: boolean, cursor?: string }
	},
	async upload(file: Buffer, filename: string, contentType: string) {
		// Return { success: boolean, url?: string, filename?: string, id?: string, error?: string }
	},
	async delete(id: string) {
		// Return { success: boolean, error?: string }
	},
}

nuaCms({ media: myAdapter })
```

## Proxy Mode

To use the Contember worker backend for all CMS operations (not just media), set the `proxy` option. This disables the local dev server API and forwards all `/_nua` requests to the target:

```typescript
nuaCms({
	proxy: 'http://localhost:8787', // Worker dev server
})
```

In proxy mode, the integration only handles HTML processing and manifest serving. All write operations go through the worker (which uses GitHub API for commits and R2 for media).

## Content Collections

The integration auto-detects Astro content collections in `src/content/`. For each collection:

- Scans all `.md`/`.mdx` files to infer a field schema from frontmatter
- Marks collection pages with a wrapper element for body editing
- Provides markdown CRUD endpoints for creating/updating entries
- Parses frontmatter with `yaml` (no `gray-matter` dependency needed)

### Schema Helpers (`n`)

Use the `n` helper instead of `z` (Zod) in your content config. It provides CMS-aware field types that tell the editor which input to render, and accepts an options object that both validates data and configures the editor UI.

```typescript
import { n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
import { defineCollection, reference } from 'astro:content'

const tagsCollection = defineCollection({
	loader: glob({ pattern: '**/*.json', base: 'src/content/tags' }),
	schema: n.object({
		name: n.string(),
	}),
})

const blogCollection = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: 'src/content/blog' }),
	schema: n.object({
		title: n.text({ placeholder: 'Enter title', maxLength: 120 }),
		author: n.text(),
		date: n.date().orderBy('desc'),
		tags: n.array(reference('tags')),
		excerpt: n.textarea({ rows: 2, maxLength: 300 }),
		coverImage: n.image(),
		featured: n.boolean().default(false),
	}),
})
```

All `n` methods return standard Zod schemas, so `.optional()`, `.nullable()`, `.default()`, and other Zod chainable methods work as usual.

### Field Types

| Method            | Editor input   | Underlying Zod type               |
| ----------------- | -------------- | --------------------------------- |
| `n.text()`        | Text input     | `z.string()`                      |
| `n.textarea()`    | Multiline      | `z.string()`                      |
| `n.number()`      | Number input   | `z.number()`                      |
| `n.boolean()`     | Checkbox       | `z.boolean()`                     |
| `n.image()`       | Image picker   | `z.string()`                      |
| `n.file()`        | File picker    | `z.string()`                      |
| `n.video()`       | Video picker   | `z.string()`                      |
| `n.url()`         | URL input      | `z.string()`                      |
| `n.email()`       | Email input    | `z.string()`                      |
| `n.color()`       | Color picker   | `z.string()`                      |
| `n.date()`        | Date picker    | `z.string()` (coerces YAML dates) |
| `n.datetime()`    | Datetime input | `z.string()` (coerces YAML dates) |
| `n.time()`        | Time input     | `z.string()`                      |
| `n.string()`      | Auto-detected  | `z.string()` (no CMS hint)        |
| `n.object()`      | —              | `z.object()`                      |
| `n.array()`       | —              | `z.array()`                       |
| `n.enum()`        | —              | `z.enum()`                        |
| `n.coerce.date()` | —              | `z.coerce.date()`                 |

### Field Hints

Pass an options object to configure both Zod validation and editor input attributes in one place:

```typescript
n.number({ min: 1, max: 100, step: 1 }) // <input type="number" min="1" max="100" step="1">
n.text({ placeholder: 'Enter title', maxLength: 120 })
n.textarea({ rows: 5, maxLength: 500, placeholder: '...' })
n.date({ min: '2024-01-01', max: '2030-12-31' })
n.image({ accept: 'image/png,image/jpeg' })
```

| Field type     | Available hints                         |
| -------------- | --------------------------------------- |
| `n.number()`   | `min`, `max`, `step`, `placeholder`     |
| `n.text()`     | `placeholder`, `maxLength`, `minLength` |
| `n.textarea()` | `placeholder`, `maxLength`, `rows`      |
| `n.url()`      | `placeholder`, `maxLength`, `minLength` |
| `n.email()`    | `placeholder`, `maxLength`, `minLength` |
| `n.date()`     | `min`, `max`                            |
| `n.datetime()` | `min`, `max`                            |
| `n.time()`     | `min`, `max`                            |
| `n.image()`    | `accept`                                |
| `n.file()`     | `accept`                                |
| `n.video()`    | `accept` (defaults to MP4 and WebM)     |

Numeric hints (`min`, `max`, `step`, `maxLength`, `minLength`) also apply Zod validation — out-of-range values will be rejected at content build time.

An `n.video()` value is a URL or a path, like an image. Render it with `Video` from `@nuasite/components`, which sets the attributes autoplaying site video needs:

```astro
<Video src={entry.data.animation} autoplay loop />
```

### Collection Ordering

Chain `.orderBy()` on any scalar field to control entry order in the collections browser:

```typescript
n.number({ min: 1, max: 100 }).orderBy('asc') // ascending (default)
n.date().orderBy('desc') // descending (newest first)
```

The direction defaults to `'asc'` if omitted. Entries with a missing order field sort to the end.

### Collection Browser

`defineCmsCollection` is a drop-in for Astro's `defineCollection` that also accepts a `cms` block. Four of its keys describe how the collection appears wherever collections are listed:

```typescript
import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'

const cases = defineCmsCollection({
	loader: glob({ pattern: '**/*.md', base: 'src/content/pripady-pripady' }),
	schema: n.object({ title: n.text() }),
	cms: { label: 'Případy', order: 1 },
})

const casesEn = defineCmsCollection({
	loader: glob({ pattern: '**/*.md', base: 'src/content/pripady-en' }),
	schema: n.object({ title: n.text() }),
	cms: { label: 'Cases', group: 'English' },
})

const redirects = defineCmsCollection({
	loader: glob({ pattern: '**/*.yaml', base: 'src/content/redirects' }),
	schema: n.object({ from: n.text(), to: n.text() }),
	cms: { hidden: true },
})
```

| Key      | Type      | Effect                                                                                                                     |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `label`  | `string`  | Display label. Overrides the name-derived default (`pripady-pripady` → "Pripady Pripady").                                 |
| `order`  | `number`  | Position in the list, lower first. Collections without an `order` follow all ordered ones, sorted by label.                |
| `group`  | `string`  | Section heading the collection is listed under. Ungrouped collections come first, then each group as its own section.      |
| `hidden` | `boolean` | `true` leaves the collection out of collection browsers. It stays resolvable: reference pickers and entry URLs still work. |

The block is read from the config **source**, so the values must be literals (or a top-level `const` holding one); anything else is ignored. Because they travel with the collection scan, they reach every consumer, including the standalone [`@nuasite/cms-sidecar`](../cms-sidecar) a hosted admin talks to. The `collections[name].label` option of the integration wins over `cms.label` wherever the integration itself serves collections: the in-page editor and the local `/_nua/admin`. A standalone sidecar does not load the Astro config, so there `cms.label` is the label.

One limitation, shared with the other keys of the block: a collection the scanner cannot place at all (no inline `schema` object and no `loader: glob(...)`) is skipped together with its `cms` block, so `hidden` or `label` declared on it does nothing.

Browsers arrange the list with `resolveCollectionNav` from `@nuasite/cms-types` (re-exported by `@nuasite/cms-client`), so a custom collections UI lists collections the same way:

```typescript
import { resolveCollectionNav } from '@nuasite/cms-client'

const [collections, config] = await Promise.all([
	client.getCollections(),
	client.getConfig(),
])
const sections = resolveCollectionNav(collections, { locale: config.locale })
// [{ items: [{ collection, children }] }, { group: 'English', items: [...] }]
```

Nested collections (`parentCollection`) come back as `children` of their parent, and a nested collection follows its parent's section: its own `group` and `order` only apply when it is listed at the top level, which happens when its parent is hidden, missing or itself nested.

The order is the same for every viewer and in every browser of a project. Labels are compared in the project's language, declared in the Astro config:

```typescript
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig({
	nua: {
		cms: {
			cmsConfig: { locale: 'cs' },
		},
	},
})
```

Without `cmsConfig.locale`, Astro's `i18n.defaultLocale` is used, so a site that already declares its languages needs nothing more. A single-language site should set `cmsConfig.locale` rather than add an `i18n` block, which would change how Astro routes.

Both are read from the source of the Astro config, because that is all a standalone sidecar has. `cmsConfig` is found where the CMS options are passed: the `nua.cms` block above (not read when the config is a plain exported object, or is passed to a `defineConfig` imported by name from `astro/config`, where nothing uses a `nua` key), or the integration called in `integrations` (`nuaCms({ cmsConfig })` imported from `@nuasite/cms`, `nua({ cms: { cmsConfig } })` imported from `@nuasite/nua` or `@nuasite/nua/integration`). Either value only takes effect when written as a string literal (or a top-level `const` holding one) in the config file itself. A `cmsConfig.locale` built any other way (an env variable, a helper, an import, a spread, a conditional, `mergeConfig`) is ignored everywhere, the in-page editor included, and the dev server logs a warning saying so.

Pass the options in one place. Each of these runs its own CMS, and a page gets the configuration of only one of them. nua's CMS takes over from a `nuaCms()` listed next to it, and `defineConfig` from `@nuasite/nua/config` always runs nua (unless `nua: false`, or `nua: { cms: false }`), so under that wrapper `cmsConfig` belongs in the `nua.cms` block: one on a `nuaCms()` call is not what a page ends up with. Of several `nuaCms()` calls the last one counts. Two nua integrations in one config (the wrapper together with `nua()`, or `nua()` twice) are not supported. `defineConfig` and the integrations are recognised only when they are called by the identifier they are imported under, not through a namespace (`nc.defineConfig(…)`, `cmsNs.default(…)`).

The sidecar serves the result as `locale` in `GET /cms/v1/config`, and the in-page editor and the collections admin use the same value. Always pass that one, never the visitor's browser language.

A project that declares neither (or a value that is not a usable locale) is compared as English, where a diacritic only breaks a tie, so "Č" sorts with "C". Digits compare as numbers ("Sekce 2" before "Sekce 10").

## Component Operations

Components in `componentDirs` (default: `src/components/`) are scanned for props and registered as insertable/removable elements. The editor can:

- **Insert** a component before or after any existing component on the page
- **Remove** a component from the page

Both operations find the invocation site (the page file, not the component file itself), locate the correct JSX tag using occurrence indexing, and modify the source with proper indentation.

## PostMessage API (Iframe Communication)

When the editor runs inside an iframe, it sends `postMessage` events to the parent window. Listen for them with:

```typescript
window.addEventListener('message', (event) => {
	const msg = event.data // CmsPostMessage
	switch (msg.type) {
		case 'cms-ready': /* ... */
			break
		case 'cms-state-changed': /* ... */
			break
		case 'cms-page-navigated': /* ... */
			break
		case 'cms-element-selected': /* ... */
			break
		case 'cms-element-deselected': /* ... */
			break
		case 'cms-open-entry': /* ... */
			break
	}
})
```

All message types are exported as TypeScript interfaces:

```typescript
import type {
	CmsPostMessage,
	CmsReadyMessage,
	CmsStateChangedMessage,
} from '@nuasite/cms'
```

### `cms-ready`

Sent once when the manifest loads for the first time. Contains the full page context:

| Field                        | Type                                    | Description                                      |
| ---------------------------- | --------------------------------------- | ------------------------------------------------ |
| `data.pathname`              | `string`                                | Current page URL pathname                        |
| `data.pageTitle`             | `string?`                               | Page title from SEO data or pages array          |
| `data.seo`                   | `PageSeoData?`                          | Full SEO metadata (title, description, OG, etc.) |
| `data.pages`                 | `PageEntry[]?`                          | All site pages with pathname and title           |
| `data.collectionDefinitions` | `Record<string, CollectionDefinition>?` | Content collections with inferred schemas        |
| `data.componentDefinitions`  | `Record<string, ComponentDefinition>?`  | Registered component definitions                 |
| `data.availableColors`       | `AvailableColors?`                      | Tailwind color palette                           |
| `data.availableTextStyles`   | `AvailableTextStyles?`                  | Tailwind text style options                      |
| `data.metadata`              | `ManifestMetadata?`                     | Manifest version, build ID, content hash         |

### `cms-state-changed`

Sent whenever editor state changes (editing mode, dirty counts, deployment, undo/redo):

| Field                             | Type                           | Description                       |
| --------------------------------- | ------------------------------ | --------------------------------- |
| `state.isEditing`                 | `boolean`                      | Whether edit mode is active       |
| `state.hasChanges`                | `boolean`                      | Whether any unsaved changes exist |
| `state.dirtyCount.text`           | `number`                       | Pending text changes              |
| `state.dirtyCount.image`          | `number`                       | Pending image changes             |
| `state.dirtyCount.color`          | `number`                       | Pending color changes             |
| `state.dirtyCount.bgImage`        | `number`                       | Pending background image changes  |
| `state.dirtyCount.attribute`      | `number`                       | Pending attribute changes         |
| `state.dirtyCount.seo`            | `number`                       | Pending SEO changes               |
| `state.dirtyCount.total`          | `number`                       | Total pending changes             |
| `state.deployment.status`         | `DeploymentStatusType \| null` | Current deployment status         |
| `state.deployment.lastDeployedAt` | `string \| null`               | ISO timestamp of last deployment  |
| `state.canUndo`                   | `boolean`                      | Whether undo is available         |
| `state.canRedo`                   | `boolean`                      | Whether redo is available         |

### `cms-page-navigated`

Sent when the manifest reloads after navigating to a different page:

| Field           | Type      | Description       |
| --------------- | --------- | ----------------- |
| `page.pathname` | `string`  | New page pathname |
| `page.title`    | `string?` | Page title        |

### `cms-element-selected`

Sent when the user picks an element with Select Element (the `selectElement` feature). Hovering sends nothing. Contains full element metadata from the manifest including `sourcePath`, `sourceLine`, `sourceSnippet`, `sourceHash`, `stableId`, `contentPath`, image/color/attribute data, and component instance info.

### `cms-element-deselected`

Sent when the picked element is let go: Escape, a click on empty space, leaving Select Element, or [`cms-deselect-element`](#cms-deselect-element) from the parent. No additional data.

### `cms-open-entry`

Sent when the parent set `openEntriesInParent` (see [`cms-set-features`](#cms-set-features)) and the user does something that edits an entry of a content collection: Edit Content, or in edit mode a click on the markdown body or on a field read from an entry's file (frontmatter text, image). The entry is the one whose file the field was read from; for a reference, the entry whose field holds it. Entries of data (JSON/YAML) and hidden collections stay editable in the page:

| Field              | Type     | Description                                                    |
| ------------------ | -------- | -------------------------------------------------------------- |
| `entry.collection` | `string` | Collection name, as the collection scan (and sidecar) names it |
| `entry.slug`       | `string` | Entry slug, as the collection scan (and sidecar) knows it      |
| `entry.sourcePath` | `string` | Entry file, relative to the project root                       |
| `entry.pathname`   | `string` | The page the entry was opened from                             |

### Inbound Messages (Parent → Iframe)

The parent window can send commands to the editor iframe using `postMessage`:

```typescript
const iframe = document.querySelector('iframe')

// Deselect the currently selected component
iframe.contentWindow.postMessage({ type: 'cms-deselect-element' }, '*')
```

All inbound message types are exported as TypeScript interfaces:

```typescript
import type {
	CmsDeselectElementMessage,
	CmsInboundMessage,
	CmsSetFeaturesMessage,
} from '@nuasite/cms'
```

#### `cms-deselect-element`

Deselects the currently selected component and closes the block editor. No additional data required.

#### `cms-set-features`

Switches widget features on or off; `features` is merged into what was set before (`cmsConfig.features` in the integration options sets the same flags statically). Every flag is optional, and leaving one out keeps the widget's default behavior. The features last for the page: send them again after every `cms-ready`, which a full navigation inside the iframe sends anew.

```typescript
iframe.contentWindow.postMessage({
	type: 'cms-set-features',
	features: {
		selectElement: true,
		collectionManagement: false,
		openEntriesInParent: true,
	},
}, '*')
```

| Feature                | Default | Description                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectElement`        | `false` | Offers Select Element, which reports the clicked element with `cms-element-selected`                                                                                                                                                                                                                                 |
| `collectionManagement` | `true`  | The in-page collection browser. `false` hides it when collections are managed by the parent                                                                                                                                                                                                                          |
| `openEntriesInParent`  | `false` | Whatever edits an entry of a content collection posts `cms-open-entry` instead: Edit Content, the markdown body and entry fields in edit mode. Edit Page still edits the rest of an entry's page inline. New Page and the collection browser offer no new entry of such a collection, an entry's page no Delete Page |
| `inlineEditing`        | `true`  | `false` removes everything that edits: Edit Page, the markdown editor, New/Delete Page, SEO, redirects. `cms-ready`, `cms-page-navigated`, `cms-state-changed`, Select Element and (with `openEntriesInParent`) Edit Content keep working                                                                            |

## Exports

```typescript
// Default export
import nuaCms from '@nuasite/cms'

// Schema helpers
import { n } from '@nuasite/cms'
import type {
	DateHints,
	ImageHints,
	NumberHints,
	TextareaHints,
	TextHints,
} from '@nuasite/cms'

// Media adapters
import { contemberMedia, localMedia, s3Media } from '@nuasite/cms'

// Types
import type { MediaItem, MediaStorageAdapter } from '@nuasite/cms'
import type {
	CmsManifest,
	CollectionDefinition,
	ComponentDefinition,
	FieldDefinition,
	FieldHints,
	ManifestEntry,
} from '@nuasite/cms'

// Utilities
import { getProjectRoot, scanCollections, setProjectRoot } from '@nuasite/cms'
import { findCollectionSource, parseMarkdownContent } from '@nuasite/cms'
```

## Hosts Outside Node

Some hosts evaluate a project's content config and render its Markdown outside Node, for example in a Cloudflare Worker. For them the package has entries that import no Node built-in:

| Entry                                       | What it exports                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@nuasite/cms/fields`                       | The schema helpers: `n`, `defineCmsCollection`, `FIELD_TYPES`, `isFieldType` and their types                                        |
| `@nuasite/cms` with the `workerd` condition | The same as `@nuasite/cms/fields`. A content config that imports `n` from the package root therefore works in such a host unchanged |
| `@nuasite/cms/remark`                       | `cmsRemarkPlugins`, `remarkDirective`, `remarkListDirective`                                                                        |
| `@nuasite/cms/rehype`                       | `rehypeCmsMarker`                                                                                                                   |

Each Markdown plugin function carries a portable module reference: a non-enumerable property keyed `Symbol.for('pletivo.portableModule')` with the value `{ module, export }`, for example `{ module: '@nuasite/cms/remark', export: 'remarkListDirective' }`. A host that cannot take the function across a process boundary imports `export` from `module` where it renders instead. The plugins take no options.

`package.json` declares `"nuasite": { "portableApi": 1 }` when the package has all of the above, so a host can refuse an older version before it tries to load one.

### Visual Editor Without the Astro Dev Server

`@nuasite/cms/editor-host` runs the inline editor's server side for a host that renders pages itself:

```ts
import { createEditorHost } from '@nuasite/cms/editor-host'

const host = await createEditorHost({
	root: '/project', // how the HTML's source annotations spell the project root
	fs, // a CmsFileSystem rooted there; every read and write goes through it
	parseAstro, // `parse` of an initialized @astrojs/compiler
	commit, // optional CmsCommit: fences editor writes against other writers
	media, // optional MediaStorageAdapter
	editor: { src: editorBundleUrl, reloadUrl: '/_live' },
})

const html = await host.processPage(pagePath, renderedHtml, { revision })
const response = await host.fetch(request) // undefined → not an editor request
host.invalidate(['src/components/Card.astro']) // after a change made elsewhere
```

- The rendered HTML must carry the Astro compiler's source annotations (`annotateSourceFile`). `processPage` marks the editable elements, records the page manifest and, with `editor`, injects `window.NuaCmsConfig`, the editor bundle and the reload client.
- `fetch` answers `/_nua/cms/*`, `/cms-manifest.json` and `/<page>.json` of a processed page.
- Each host keeps its own caches and manifests, so one process can serve several projects.
- With `commit`, a write based on a file that changed meanwhile is refused: `409` for a single operation, a per-change error for that file in a batch save.
- The reload client (`reloadClientScript`) opens a WebSocket to `reloadUrl`. On a message `{ "revision": "…" }` that differs from the page's revision, it dispatches a cancelable `nua:external-change` event on `window` and reloads the page unless the event was cancelled.
