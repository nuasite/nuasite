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

Numeric hints (`min`, `max`, `step`, `maxLength`, `minLength`) also apply Zod validation — out-of-range values will be rejected at content build time.

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

| Key      | Type     | Effect                                                                                                                |
| -------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `label`  | `string` | Display label. Overrides the name-derived default (`pripady-pripady` → "Pripady Pripady").                            |
| `order`  | `number` | Position in the list, lower first. Collections without an `order` follow all ordered ones, sorted by label.           |
| `group`  | `string` | Section heading the collection is listed under. Ungrouped collections come first, then each group as its own section. |
| `hidden` | `true`   | Leaves the collection out of collection browsers. It stays resolvable: reference pickers and entry URLs still work.   |

The block is read from the config **source**, so the values must be literals (or a top-level `const` holding one); anything else is ignored. Because they travel with the collection scan, they reach every consumer, including the standalone [`@nuasite/cms-sidecar`](../cms-sidecar) a hosted admin talks to. The `collections[name].label` option of the integration still wins over `cms.label`, but it is applied inside the Astro integration only and never reaches a sidecar.

Browsers arrange the list with `resolveCollectionNav` from `@nuasite/cms-types` (re-exported by `@nuasite/cms-client`), so a custom collections UI lists collections the same way:

```typescript
import { resolveCollectionNav } from '@nuasite/cms-client'

const sections = resolveCollectionNav(await client.getCollections(), {
	locale: 'cs',
})
// [{ items: [{ collection, children }] }, { group: 'English', items: [...] }]
```

Nested collections (`parentCollection`) come back as `children` of their parent. `locale` is the language the labels are compared in and defaults to the runtime's locale.

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

Sent when the user hovers or clicks a CMS element. Contains full element metadata from the manifest including `sourcePath`, `sourceLine`, `sourceSnippet`, `sourceHash`, `stableId`, `contentPath`, image/color/attribute data, and component instance info.

### `cms-element-deselected`

Sent when no element is hovered. No additional data.

### Inbound Messages (Parent → Iframe)

The parent window can send commands to the editor iframe using `postMessage`:

```typescript
const iframe = document.querySelector('iframe')

// Deselect the currently selected component
iframe.contentWindow.postMessage({ type: 'cms-deselect-element' }, '*')
```

All inbound message types are exported as TypeScript interfaces:

```typescript
import type { CmsDeselectElementMessage, CmsInboundMessage } from '@nuasite/cms'
```

#### `cms-deselect-element`

Deselects the currently selected component and closes the block editor. No additional data required.

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
