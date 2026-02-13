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
      colorChange: { oldClass: 'bg-blue-500', newClass: 'bg-red-500', type: 'bg' },
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

## Component Operations

Components in `componentDirs` (default: `src/components/`) are scanned for props and registered as insertable/removable elements. The editor can:

- **Insert** a component before or after any existing component on the page
- **Remove** a component from the page

Both operations find the invocation site (the page file, not the component file itself), locate the correct JSX tag using occurrence indexing, and modify the source with proper indentation.

## Exports

```typescript
// Default export
import nuaCms from '@nuasite/cms'

// Media adapters
import { contemberMedia, localMedia, s3Media } from '@nuasite/cms'

// Types
import type { MediaItem, MediaStorageAdapter } from '@nuasite/cms'
import type {
	CmsManifest,
	ComponentDefinition,
	ManifestEntry,
} from '@nuasite/cms'

// Utilities
import { getProjectRoot, scanCollections, setProjectRoot } from '@nuasite/cms'
import { findCollectionSource, parseMarkdownContent } from '@nuasite/cms'
```
