/**
 * Shared structural contract types for the Nua CMS.
 *
 * These describe the *data/structure* half of the CMS — collections, fields,
 * entries, page/redirect operations and the media storage adapter. They are
 * framework-agnostic (no Astro, Vite, manifest or SEO coupling) and are reused
 * 1:1 as the wire model across cms-core, the sidecar and webmaster.
 *
 * Render/manifest/SEO types (ManifestEntry, CmsManifest, SeoOptions, color/text
 * style types, ComponentInstance) intentionally stay in `@nuasite/cms`.
 */

// ============================================================================
// Fields & Collections
// ============================================================================

/** Canonical list of field types for collection schema inference. Single source of truth for `FieldType`. */
export const FIELD_TYPES = [
	'text',
	'textarea',
	'markdown',
	'date',
	'datetime',
	'time',
	'year',
	'month',
	'boolean',
	'number',
	'image',
	'file',
	'url',
	'email',
	'tel',
	'color',
	'select',
	'array',
	'object',
	'reference',
] as const

/** Field types for collection schema inference */
export type FieldType = (typeof FIELD_TYPES)[number]

/** Runtime guard: whether a string is a known `FieldType`. */
export function isFieldType(value: string): value is FieldType {
	return (FIELD_TYPES as readonly string[]).includes(value)
}

/** Editor hints for enhanced field rendering (extracted from `n.*()` options in content config) */
export interface FieldHints {
	min?: number | string
	max?: number | string
	step?: number
	placeholder?: string
	maxLength?: number
	minLength?: number
	rows?: number
	accept?: string
}

/** Definition of a single field in a collection's schema */
export interface FieldDefinition {
	/** Field name as it appears in frontmatter */
	name: string
	/** Inferred or specified field type */
	type: FieldType
	/** Whether the field is required (present in all entries) */
	required: boolean
	/** Default value for the field */
	defaultValue?: unknown
	/** Options for 'select' type fields */
	options?: string[]
	/** Item type for 'array' fields */
	itemType?: FieldType
	/** Nested fields for 'object' type */
	fields?: FieldDefinition[]
	/** Sample values seen across entries */
	examples?: unknown[]
	/** Where the field renders in the editor UI */
	position?: 'sidebar' | 'header'
	/** Group name for visual grouping with section headers */
	group?: string
	/** Human label shown instead of the raw field name. */
	label?: string
	/** Helper text shown under the field's label. */
	help?: string
	/** Column span in the editor's field grid. `half` lets two fields share a row. */
	width?: 'full' | 'half'
	/** Explicit ordering weight within a column/section (lower comes first). */
	order?: number
	/** Referenced collection name for 'reference' type fields */
	collection?: string
	/** Hide from the editor UI (e.g. derived/computed fields) */
	hidden?: boolean
	/** Source field name this field is derived from (e.g. categoryHref derived from category) */
	derivedFrom?: string
	/** Editor hints for enhanced field rendering */
	hints?: FieldHints
	/** True when the field uses Astro's `image()` schema (entry-relative paths through astro:assets). */
	astroImage?: boolean
	/** Semantic role used by the editor UI to position special fields without name matching.
	 *  - `publish-toggle`: boolean controlling whether the entry is published (e.g. `draft`, `isDraft`, `published`).
	 *  - `publish-date`: the publish/release date field (e.g. `date`, `publishDate`, `publishedAt`). */
	role?: 'publish-toggle' | 'publish-date'
}

/** One named section of an entry form, grouping a set of fields by name. */
export interface CollectionLayoutSection {
	/** Section heading (also the tab label when `display: 'tabs'`). */
	title: string
	/** Field names placed in this section, in order. */
	fields: string[]
	/** Render the section collapsed by default (ignored for tabs). */
	collapsed?: boolean
}

/**
 * Declarative form layout for a collection's entry editor, authored via
 * `defineCmsCollection({ cms: { … } })`. When absent the editor derives a layout
 * from per-field metadata + heuristics.
 */
export interface CollectionLayout {
	/** Stack the sections (`sections`, default) or show them as tabs (`tabs`). */
	display?: 'sections' | 'tabs'
	/** Field names pinned to the editor's side column. */
	sidebar?: string[]
	/** Ordered main-column sections. Fields not listed fall into a trailing default section. */
	sections?: CollectionLayoutSection[]
}

/** Per-entry metadata for collection browsing */
export interface CollectionEntryInfo {
	slug: string
	title?: string
	sourcePath: string
	draft?: boolean
	/** URL pathname of the rendered page for this entry */
	pathname?: string
	/** Full entry data for data collections (JSON/YAML) */
	data?: Record<string, unknown>
}

/** Definition of a content collection with inferred schema */
export interface CollectionDefinition {
	/** Collection identifier (directory name) */
	name: string
	/** Human-readable label for the collection */
	label: string
	/** Path to the collection directory */
	path: string
	/** Number of entries in the collection */
	entryCount: number
	/** Inferred field definitions */
	fields: FieldDefinition[]
	/** Whether the collection has draft support */
	supportsDraft?: boolean
	/** Collection type: 'content' for markdown, 'data' for JSON/YAML */
	type?: 'content' | 'data'
	/** File extension used by entries */
	fileExtension: 'md' | 'mdx' | 'json' | 'yaml' | 'yml'
	/** Per-entry metadata for browsing */
	entries?: CollectionEntryInfo[]
	/** Frontmatter field name to sort entries by (detected from `.orderBy()` in content config) */
	orderBy?: string
	/** Sort direction for orderBy field */
	orderDirection?: 'asc' | 'desc'
	/**
	 * Name of the collection this one is nested under in the CMS browser, when it shares a base
	 * directory with another collection (e.g. a nested `*​/otazky/*` collection grouped under the
	 * `*​/index.md` collection at the same base). Purely presentational grouping.
	 */
	parentCollection?: string
	/** Declarative entry-form layout (sections/tabs/sidebar), from `defineCmsCollection`. */
	layout?: CollectionLayout
}

/** Represents a content collection entry (markdown file) */
export interface CollectionEntry {
	/** Collection name (e.g., 'services', 'blog') */
	collectionName: string
	/** Entry slug (e.g., '3d-tisk') */
	collectionSlug: string
	/** Path to the markdown file relative to project root */
	sourcePath: string
	/** Frontmatter fields with their values and line numbers */
	frontmatter: Record<string, { value: string; line: number }>
	/** Full markdown body content */
	body: string
	/** Line number where body starts (1-indexed) */
	bodyStartLine: number
	/** ID of the wrapper element containing the rendered markdown */
	wrapperId?: string
}

// ============================================================================
// Mutation result
// ============================================================================

/** Result of a content/structure mutation. */
export interface MutationResult {
	success: boolean
	/** Touched file, for targeted HMR/invalidate. */
	sourcePath?: string
	/** Hash after write, for optimistic concurrency. */
	sourceHash?: string
	/** Page URL for the entry, when known. */
	pathname?: string
	error?: string
}

// ============================================================================
// Component definitions
// ============================================================================

export interface ComponentProp {
	name: string
	type: string
	required: boolean
	defaultValue?: string
	description?: string
}

export interface ComponentDefinition {
	name: string
	file: string
	props: ComponentProp[]
	description?: string
	slots?: string[]
	previewUrl?: string
	/** Viewport width (in px) used to render the preview iframe (default: 1280) */
	previewWidth?: number
}

// ============================================================================
// Project CMS config
// ============================================================================

/** One project-defined bullet-list style exposed to headless editors. */
export interface CmsListStyle {
	label: string
	class: string
}

/** Project-level CMS config safe to expose through the headless API. */
export interface CmsConfig {
	listStyles?: CmsListStyle[]
}

// ============================================================================
// Page Operations (shared between server handlers and editor UI)
// ============================================================================

export interface CreatePageRequest {
	title: string
	slug: string
	layoutPath?: string
}

export interface DuplicatePageRequest {
	sourcePagePath: string
	slug: string
	title?: string
	createRedirect?: boolean
}

export interface DeletePageRequest {
	pagePath: string
	createRedirect?: boolean
	redirectTo?: string
}

export interface PageOperationResponse {
	success: boolean
	filePath?: string
	slug?: string
	url?: string
	error?: string
}

export interface LayoutInfo {
	name: string
	path: string
}

// ============================================================================
// Redirect Operations (shared between server handlers and editor UI)
// ============================================================================

export interface RedirectRule {
	source: string
	destination: string
	statusCode: number
	lineIndex: number
}

export interface AddRedirectRequest {
	source: string
	destination: string
	statusCode?: number
}

export interface UpdateRedirectRequest {
	lineIndex: number
	source: string
	destination: string
	statusCode?: number
}

export interface DeleteRedirectRequest {
	lineIndex: number
}

export interface RedirectOperationResponse {
	success: boolean
	error?: string
}

export interface GetRedirectsResponse {
	rules: RedirectRule[]
}

// ============================================================================
// Media storage adapter
// ============================================================================

export interface MediaItem {
	id: string
	url: string
	filename: string
	annotation?: string
	contentType: string
	width?: number
	height?: number
	uploadedAt?: string
	/** Folder path relative to media root (e.g. 'photos') */
	folder?: string
}

export interface MediaFolderItem {
	/** Folder name (last segment) */
	name: string
	/** Full relative path from media root (e.g. 'photos/vacation') */
	path: string
}

export type MediaTypeFilter = 'all' | 'photo' | 'graphic' | 'video' | 'document'

export interface MediaListOptions {
	limit?: number
	cursor?: string
	/** List contents of this subfolder (relative to media root) */
	folder?: string
}

export interface MediaListResult {
	items: MediaItem[]
	/** Subfolders in the current directory */
	folders: MediaFolderItem[]
	hasMore: boolean
	cursor?: string
}

export interface MediaUploadResult {
	success: boolean
	url?: string
	filename?: string
	annotation?: string
	id?: string
	error?: string
}

export interface MediaStorageAdapter {
	list(options?: MediaListOptions): Promise<MediaListResult>
	upload(file: Buffer, filename: string, contentType: string, options?: { folder?: string }): Promise<MediaUploadResult>
	delete(id: string): Promise<{ success: boolean; error?: string }>
	/** Create an empty folder. Folders are also created implicitly on upload. */
	createFolder?(folder: string): Promise<{ success: boolean; error?: string }>
	/** Local filesystem info for direct file serving in dev (bypasses Vite's public dir cache) */
	staticFiles?: { urlPrefix: string; dir: string }
}
