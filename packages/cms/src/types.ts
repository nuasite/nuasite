import type {
	Attribute,
	AvailableColors,
	AvailableTextStyles,
	BackgroundImageMetadata,
	CollectionDefinition,
	CollectionEntry,
	ComponentDefinition,
	ContentConstraints,
	ImageMetadata,
	ManifestMetadata,
	PageEntry,
} from '@nuasite/cms-types'

// Structural contract types live in @nuasite/cms-types (the shared wire model).
// Re-exported here so existing `@nuasite/cms` imports keep working unchanged.
export type {
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	ComponentProp,
	FieldDefinition,
	FieldHints,
	FieldType,
	MutationResult,
	PathnameSegment,
	PathnameSpec,
} from '@nuasite/cms-types'
export type {
	AddRedirectRequest,
	CreatePageRequest,
	DeletePageRequest,
	DeleteRedirectRequest,
	DuplicatePageRequest,
	GetRedirectsResponse,
	LayoutInfo,
	PageOperationResponse,
	RedirectOperationResponse,
	RedirectRule,
	UpdateRedirectRequest,
} from '@nuasite/cms-types'
// Render/manifest model types now live in @nuasite/cms-types (the shared, DOM-free
// wire model). Re-exported here so existing `@nuasite/cms` imports keep working.
export type {
	Attribute,
	AvailableColors,
	AvailableTextStyles,
	BackgroundImageMetadata,
	CmsManifest,
	ComponentInstance,
	ContentConstraints,
	ImageMetadata,
	ManifestEntry,
	ManifestMetadata,
	PageEntry,
	TailwindColor,
	TextStyleValue,
} from '@nuasite/cms-types'

/** SEO tracking options */
export interface SeoOptions {
	/** Whether to track SEO elements (default: true) */
	trackSeo?: boolean
	/** Whether to mark the page title with a CMS ID (default: true) */
	markTitle?: boolean
	/** Whether to parse JSON-LD structured data (default: true) */
	parseJsonLd?: boolean
}

export interface CmsMarkerOptions {
	attributeName?: string
	includeTags?: string[] | null
	excludeTags?: string[]
	includeEmptyText?: boolean
	generateManifest?: boolean
	manifestFile?: string
	markComponents?: boolean
	componentDirs?: string[]
	/** Directory containing content collections (default: 'src/content') */
	contentDir?: string
	/** SEO tracking options */
	seo?: SeoOptions
}

/** Identifies the (collection, entry, field) destination for an editor upload. */
export interface MediaUploadContext {
	collection: string
	entry: string
	field: string
}

// === SEO Types ===

/** Source tracking information for SEO elements */
export interface SeoSourceInfo {
	/** CMS ID if element was marked for editing */
	id?: string
	/** Path to source file */
	sourcePath: string
	/** Line number in source file (1-indexed) */
	sourceLine: number
	/** Exact source code snippet for matching/replacement */
	sourceSnippet: string
}

/** SEO meta tag with source tracking */
export interface SeoMetaTag extends SeoSourceInfo {
	/** Meta tag name attribute (for name-based meta tags) */
	name?: string
	/** Meta tag property attribute (for Open Graph/Twitter tags) */
	property?: string
	/** Meta tag content value */
	content: string
}

/** Open Graph metadata */
export interface OpenGraphData {
	title?: SeoMetaTag
	description?: SeoMetaTag
	image?: SeoMetaTag
	url?: SeoMetaTag
	type?: SeoMetaTag
	siteName?: SeoMetaTag
}

/** Twitter Card metadata */
export interface TwitterCardData {
	card?: SeoMetaTag
	title?: SeoMetaTag
	description?: SeoMetaTag
	image?: SeoMetaTag
	site?: SeoMetaTag
}

/** JSON-LD structured data entry */
export interface JsonLdEntry extends SeoSourceInfo {
	/** Schema.org @type value */
	type: string
	/** Parsed JSON-LD data */
	data: Record<string, unknown>
}

/** Canonical URL link element */
export interface CanonicalUrl extends SeoSourceInfo {
	/** The canonical URL href value */
	href: string
}

/** Favicon link element */
export interface SeoFavicon extends SeoSourceInfo {
	/** The favicon href value */
	href: string
	/** The type attribute (e.g. "image/png", "image/svg+xml") */
	type?: string
	/** The sizes attribute (e.g. "32x32", "16x16") */
	sizes?: string
	/** The rel value (e.g. "icon", "apple-touch-icon") */
	rel: string
}

/** Page title element with optional CMS ID */
export interface SeoTitle extends SeoSourceInfo {
	/** Title text content */
	content: string
}

/** Meta keywords with parsed array */
export interface SeoKeywords extends SeoSourceInfo {
	/** Raw keywords string */
	content: string
	/** Parsed array of individual keywords */
	keywords: string[]
}

/** Complete SEO data for a page */
export interface PageSeoData {
	/** Page title */
	title?: SeoTitle
	/** Meta description */
	description?: SeoMetaTag
	/** Meta keywords */
	keywords?: SeoKeywords
	/** Canonical URL */
	canonical?: CanonicalUrl
	/** Favicons */
	favicons?: SeoFavicon[]
	/** Open Graph metadata */
	openGraph?: OpenGraphData
	/** Twitter Card metadata */
	twitterCard?: TwitterCardData
	/** Browser theme color (meta name="theme-color") */
	themeColor?: SeoMetaTag
	/** Robots directives (meta name="robots") */
	robots?: SeoMetaTag
	/** JSON-LD structured data blocks */
	jsonLd?: JsonLdEntry[]
}

// ============================================================================
// PostMessage Types (iframe communication)
// ============================================================================

/** Element data sent to parent when a CMS element is hovered/selected */
export interface CmsSelectedElement {
	/** CMS element ID (null for component-only selections) */
	cmsId: string | null
	/** Whether the selected element is a component root */
	isComponent: boolean
	/** Component name if applicable */
	componentName?: string
	/** Component instance ID */
	componentId?: string
	/** HTML tag name */
	tagName?: string
	/** Bounding rect relative to the iframe viewport */
	rect: { x: number; y: number; width: number; height: number } | null

	// --- Manifest entry data (text/image elements) ---

	/** Plain text content */
	text?: string
	/** HTML content with inline styling */
	html?: string
	/** Source file path */
	sourcePath?: string
	/** Line number in source file */
	sourceLine?: number
	/** Parent component ID */
	parentComponentId?: string
	/** Nested CMS element IDs */
	childCmsIds?: string[]
	/** Image metadata for img elements */
	imageMetadata?: ImageMetadata
	/** Background image metadata */
	backgroundImage?: BackgroundImageMetadata
	/** Color classes (bg, text, border, etc.) */
	colorClasses?: Record<string, Attribute>
	/** HTML attributes with source info */
	attributes?: Record<string, Attribute>
	/** Content validation constraints */
	constraints?: ContentConstraints
	/** Whether inline text styling is allowed */
	allowStyling?: boolean
	/** Collection name if from a content collection */
	collectionName?: string
	/** Collection entry slug */
	collectionSlug?: string
	/** Full element snippet from source */
	sourceSnippet?: string
	/** SHA256 hash of sourceSnippet for conflict detection */
	sourceHash?: string
	/** Stable ID derived from content + context hash */
	stableId?: string
	/** Path to the markdown content file */
	contentPath?: string

	// --- Component instance data ---

	/** Full component instance info (when isComponent is true) */
	component?: {
		name: string
		file: string
		sourcePath: string
		sourceLine: number
		props: Record<string, unknown>
		slots?: Record<string, string>
	}
}

/** Message sent when a CMS element is hovered/selected */
export interface CmsElementSelectedMessage {
	type: 'cms-element-selected'
	element: CmsSelectedElement
}

/** Message sent when no element is hovered */
export interface CmsElementDeselectedMessage {
	type: 'cms-element-deselected'
}

/** Data sent with the cms-ready message when the manifest first loads */
export interface CmsReadyData {
	pathname: string
	pageTitle?: string
	seo?: PageSeoData
	pages?: PageEntry[]
	collectionDefinitions?: Record<string, CollectionDefinition>
	componentDefinitions?: Record<string, ComponentDefinition>
	availableColors?: AvailableColors
	availableTextStyles?: AvailableTextStyles
	metadata?: ManifestMetadata
}

/** Message sent when the CMS manifest has loaded and the editor is ready */
export interface CmsReadyMessage {
	type: 'cms-ready'
	data: CmsReadyData
}

/** Snapshot of editor state sent on every meaningful change */
export interface CmsEditorState {
	isEditing: boolean
	hasChanges: boolean
	dirtyCount: {
		text: number
		image: number
		color: number
		bgImage: number
		attribute: number
		seo: number
		total: number
	}
	canUndo: boolean
	canRedo: boolean
}

/** Message sent when editor state changes (dirty counts, deployment, editing mode, undo/redo) */
export interface CmsStateChangedMessage {
	type: 'cms-state-changed'
	state: CmsEditorState
}

/** Message sent when the user navigates to a different page (manifest reload) */
export interface CmsPageNavigatedMessage {
	type: 'cms-page-navigated'
	page: {
		pathname: string
		title?: string
	}
}

/** All possible CMS postMessage types sent from the editor iframe to the parent */
export type CmsPostMessage =
	| CmsElementSelectedMessage
	| CmsElementDeselectedMessage
	| CmsReadyMessage
	| CmsStateChangedMessage
	| CmsPageNavigatedMessage

// ============================================================================
// Feature Flags
// ============================================================================

export interface CmsFeatures {
	selectElement?: boolean
	/**
	 * Controls the in-preview collection browser/management UI (browse collections,
	 * list/open entries). Defaults to enabled. When `false`, the widget hides this
	 * UI because collection editing is owned elsewhere (e.g. the webmaster
	 * Collections tab); inline text/image/color editing stays unaffected.
	 */
	collectionManagement?: boolean
}

// ============================================================================
// Inbound messages (parent → editor iframe)
// ============================================================================

/** Message sent from parent to deselect the currently selected element/component */
export interface CmsDeselectElementMessage {
	type: 'cms-deselect-element'
}

export interface CmsSetFeaturesMessage {
	type: 'cms-set-features'
	features: CmsFeatures
}

/** All possible CMS postMessage types sent from the parent to the editor iframe */
export type CmsInboundMessage = CmsDeselectElementMessage | CmsSetFeaturesMessage

// Page & Redirect operation request/response types now live in @nuasite/cms-types
// and are re-exported at the top of this file.
