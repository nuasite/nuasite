import type { Attribute, CmsManifest, CollectionDefinition, ComponentInstance } from '../types'

// Re-export shared types from @nuasite/cms-marker (source of truth)
export type {
	Attribute,
	AvailableColors,
	AvailableTextStyles,
	CanonicalUrl,
	CmsManifest,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	ComponentInstance,
	FieldDefinition,
	FieldType,
	JsonLdEntry,
	ManifestEntry,
	OpenGraphData,
	PageSeoData,
	SeoFavicon,
	SeoKeywords,
	SeoMetaTag,
	SeoOptions,
	SeoSourceInfo,
	SeoTitle,
	TailwindColor,
	TextStyleValue,
	TwitterCardData,
} from '../types'

export interface CmsThemeConfig {
	// Colors
	primary?: string
	secondary?: string
	background?: string
	card?: string

	// Style presets
	borderRadius?: 'sharp' | 'soft' | 'rounded'
	shadowStyle?: 'none' | 'soft' | 'brutalist'
}

export type CmsThemePreset = 'soft' | 'brutalist' | 'minimal'

export interface CmsConfig {
	apiBase: string
	highlightColor: string
	debug: boolean
	theme?: CmsThemeConfig
	themePreset?: CmsThemePreset
}

export interface ComponentProp {
	name: string
	type: string
	required: boolean
	defaultValue?: string
	description?: string
}

export interface ChildCmsElement {
	id: string
	placeholder: string
	currentHTML?: string
}

export interface PendingChange {
	element: HTMLElement
	originalHTML: string
	originalText: string
	newText: string
	currentHTML: string
	isDirty: boolean
	childCmsElements?: ChildCmsElement[]
	hasStyledContent?: boolean
}

export interface PendingImageChange {
	element: HTMLImageElement
	originalSrc: string
	newSrc: string
	originalAlt: string
	newAlt: string
	originalSrcSet: string
	isDirty: boolean
}

export interface PendingColorChange {
	element: HTMLElement
	cmsId: string
	originalClasses: Record<string, Attribute>
	newClasses: Record<string, Attribute>
	isDirty: boolean
}

export interface ColorEditorState {
	isOpen: boolean
	targetElementId: string | null
	targetRect: DOMRect | null
}

export interface SavedEdit {
	originalText: string
	newText: string
	currentHTML: string
	hasStyledContent?: boolean
}

export interface SavedEdits {
	[cmsId: string]: SavedEdit
}

export interface SavedImageEdit {
	originalSrc: string
	newSrc: string
	originalAlt: string
	newAlt: string
	originalSrcSet: string
}

export interface SavedImageEdits {
	[cmsId: string]: SavedImageEdit
}

export interface SavedColorEdit {
	originalClasses: Record<string, Attribute>
	newClasses: Record<string, Attribute>
}

export interface SavedColorEdits {
	[cmsId: string]: SavedColorEdit
}

/** Color change details for updating element color classes */
export interface ColorChangePayload {
	/** The color class to replace (e.g., 'bg-blue-500') */
	oldClass: string
	/** The new color class (e.g., 'bg-red-500') */
	newClass: string
	/** Type of color change: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText' */
	type: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText'
	/** Path to the source file where the color class is defined */
	sourcePath?: string
	/** Line number where the color class is defined */
	sourceLine?: number
	/** The source code snippet containing the color class */
	sourceSnippet?: string
}

export interface ChangePayload {
	cmsId: string
	newValue: string
	/** Original value to find and replace within the source snippet */
	originalValue: string
	/** Path to the source file */
	sourcePath: string
	/** Line number in the source file (for disambiguation) */
	sourceLine: number
	/** The source code snippet containing the text to replace */
	sourceSnippet: string
	/** HTML content when the element contains styled text (spans with Tailwind classes) */
	htmlValue?: string
	childCmsIds?: string[]
	/** Whether this change contains styled inline text */
	hasStyledContent?: boolean
	/** Image change details when replacing an image */
	imageChange?: {
		newSrc: string
		newAlt?: string
	}
	/** Color class change (for buttons, etc.) */
	colorChange?: ColorChangePayload
	/** Attribute changes (for links, forms, etc.) */
	attributeChanges?: AttributeChangePayload[]
}

export interface SaveBatchRequest {
	changes: ChangePayload[]
	meta: {
		source: string
		url: string
	}
}

export interface SaveBatchResponse {
	updated: number
	errors?: Array<{ cmsId: string; error: string }>
}

export interface ChatMessage {
	id: string
	role: 'user' | 'assistant'
	content: string
	elementId?: string
	timestamp: number
}

export type AIStatusType =
	| 'thinking'
	| 'coding'
	| 'building'
	| 'deploying'
	| 'complete'
	| null

export interface AIState {
	isPromptVisible: boolean
	isProcessing: boolean
	targetElementId: string | null
	streamingContent: string | null
	error: string | null
	isChatOpen: boolean
	chatMessages: ChatMessage[]
	chatContextElementId: string | null
	currentStatus: AIStatusType
	statusMessage: string | null
}

export interface BlockEditorState {
	isOpen: boolean
	currentComponentId: string | null
	mode: 'edit' | 'add' | 'picker'
}

// Component insertion types
export type InsertPosition = 'before' | 'after'

export interface PendingComponentInsert {
	id: string // Temporary ID for preview
	position: InsertPosition
	referenceComponentId: string // The component we're inserting relative to
	componentName: string
	props: Record<string, any>
	previewElement?: HTMLElement // The DOM element created for preview
}

export interface ComponentInsertRequest {
	position: InsertPosition
	referenceComponentId: string
	componentName: string
	props: Record<string, any>
}

export interface ComponentInsertResponse {
	success: boolean
	insertedId?: string
	error?: string
	diff?: {
		file: string
		before: string
		after: string
	}
}

export interface ComponentInsertOperation {
	position: InsertPosition
	referenceComponentId: string
	componentName: string
	props: Record<string, any>
}

export interface EditorState {
	isEnabled: boolean
	isEditing: boolean
	showingOriginal: boolean
	currentEditingId: string | null
	currentComponentId: string | null
	pendingChanges: Map<string, PendingChange>
	pendingComponentChanges: Map<string, ComponentInstance>
	pendingInserts: Map<string, PendingComponentInsert>
	manifest: CmsManifest
	ai: AIState
	blockEditor: BlockEditorState
}

// Text styling types for inline Tailwind class application
export interface TextStyleDefinition {
	class: string
	label: string
}

export interface TextStyleCategory {
	[key: string]: TextStyleDefinition
}

// ============================================================================
// Markdown CMS Types
// ============================================================================

export interface BlogFrontmatter {
	title: string
	date: string
	author?: string
	categories?: string[]
	excerpt?: string
	featuredImage?: string
	draft?: boolean
	[key: string]: unknown
}

export interface MarkdownPageEntry {
	filePath: string
	slug: string
	frontmatter: Record<string, unknown>
	content: string
	isDirty: boolean
}

export interface MarkdownEditorState {
	isOpen: boolean
	currentPage: MarkdownPageEntry | null
	activeElementId: string | null
	mode: 'edit' | 'create'
	collectionDefinition?: CollectionDefinition
	createOptions?: {
		collectionName: string
		collectionDefinition: CollectionDefinition
	}
}

export interface MediaItem {
	id: string
	url: string
	filename: string
	annotation?: string
	contentType: string
	width?: number
	height?: number
	uploadedAt?: string
}

export interface MediaLibraryState {
	isOpen: boolean
	items: MediaItem[]
	isLoading: boolean
	selectedItem: MediaItem | null
	insertCallback: ((url: string, alt: string) => void) | null
}

export interface CreatePageState {
	isOpen: boolean
	isCreating: boolean
	selectedCollection: string | null
}

export interface CollectionsBrowserState {
	isOpen: boolean
	selectedCollection: string | null
}

// API Request/Response types for markdown operations
export interface CreateMarkdownPageRequest {
	/** Collection name (e.g., 'blog', 'services') */
	collection: string
	/** URL-friendly slug for the page */
	slug: string
	/** Page title */
	title: string
	/** Optional frontmatter fields */
	frontmatter?: Partial<BlogFrontmatter>
	/** Optional markdown content */
	content?: string
}

export interface CreateMarkdownPageResponse {
	success: boolean
	filePath?: string
	slug?: string
	url?: string
	error?: string
}

export interface UpdateMarkdownPageRequest {
	filePath: string
	frontmatter?: Partial<BlogFrontmatter>
	content?: string
}

export interface UpdateMarkdownPageResponse {
	success: boolean
	commit?: string
	commitMessage?: string
	error?: string
}

export interface MediaUploadResponse {
	success: boolean
	url?: string
	filename?: string
	annotation?: string
	id?: string
	error?: string
}

// ============================================================================
// Deployment Status Types
// ============================================================================

export type DeploymentStatusType =
	| 'pending'
	| 'queued'
	| 'running'
	| 'completed'
	| 'failed'
	| 'cancelled'

export interface DeploymentStatusResponse {
	currentDeployment: {
		id: string
		status: DeploymentStatusType
		createdAt: string
		startedAt: string | null
		commitMessage: string | null
	} | null
	lastSuccessfulDeployment: {
		completedAt: string
		publishedUrl: string
	} | null
	pendingCount: number
}

export interface DeploymentState {
	status: DeploymentStatusType | null
	lastDeployedAt: string | null
	isPolling: boolean
	error: string | null
}

// ============================================================================
// Confirm Dialog Types
// ============================================================================

export interface ConfirmDialogState {
	isOpen: boolean
	title: string
	message: string
	confirmLabel: string
	cancelLabel: string
	variant: 'danger' | 'warning' | 'info'
	onConfirm: (() => void) | null
	onCancel: (() => void) | null
}

// ============================================================================
// CMS Settings Types
// ============================================================================

export interface CmsSettings {
	showEditableHighlights: boolean
}

// ============================================================================
// SEO Editor Types
// ============================================================================

export interface SeoEditorState {
	isOpen: boolean
}

/** Represents a pending SEO field change */
export interface PendingSeoChange {
	/** The SEO element's id */
	id: string
	/** Original value */
	originalValue: string
	/** New value */
	newValue: string
	/** Whether this change is dirty (modified) */
	isDirty: boolean
}

// ============================================================================
// Attribute Editor Types
// ============================================================================

/** Represents a pending attribute change */
export interface PendingAttributeChange {
	element: HTMLElement
	cmsId: string
	/** Original attribute values from manifest */
	originalAttributes: Record<string, Attribute>
	/** Current (possibly modified) attribute values */
	newAttributes: Record<string, Attribute>
	/** Whether this change is dirty */
	isDirty: boolean
}

/** Attribute change payload for API */
export interface AttributeChangePayload {
	/** The attribute name being changed */
	attributeName: string
	/** Old value */
	oldValue: string | undefined
	/** New value */
	newValue: string | undefined
	/** Path to the source file where the attribute is defined */
	sourcePath?: string
	/** Line number where the attribute is defined */
	sourceLine?: number
	/** The source code snippet containing the attribute */
	sourceSnippet?: string
}

/** Editor state for attribute editor */
export interface AttributeEditorState {
	isOpen: boolean
	targetElementId: string | null
	targetRect: DOMRect | null
}

/** Saved attribute edit for storage persistence */
export interface SavedAttributeEdit {
	originalAttributes: Record<string, Attribute>
	newAttributes: Record<string, Attribute>
}

/** Saved attribute edits indexed by CMS ID */
export interface SavedAttributeEdits {
	[cmsId: string]: SavedAttributeEdit
}

// ============================================================================
// Undo/Redo Types
// ============================================================================

export interface UndoTextAction {
	type: 'text'
	cmsId: string
	element: HTMLElement
	previousHTML: string
	previousText: string
	currentHTML: string
	currentText: string
	wasDirty: boolean
}

export interface UndoImageAction {
	type: 'image'
	cmsId: string
	element: HTMLImageElement
	previousSrc: string
	previousAlt: string
	currentSrc: string
	currentAlt: string
	wasDirty: boolean
}

export interface UndoColorAction {
	type: 'color'
	cmsId: string
	element: HTMLElement
	previousClassName: string
	currentClassName: string
	previousStyleCssText: string
	currentStyleCssText: string
	previousClasses: Record<string, Attribute>
	currentClasses: Record<string, Attribute>
	wasDirty: boolean
}

export interface UndoAttributeAction {
	type: 'attribute'
	cmsId: string
	element: HTMLElement
	previousAttributes: Record<string, Attribute>
	currentAttributes: Record<string, Attribute>
	wasDirty: boolean
}

export interface UndoSeoAction {
	type: 'seo'
	cmsId: string
	previousValue: string
	currentValue: string
	originalValue: string
	wasDirty: boolean
}

export type UndoAction =
	| UndoTextAction
	| UndoImageAction
	| UndoColorAction
	| UndoAttributeAction
	| UndoSeoAction

declare global {
	interface Window {
		NuaCmsConfig?: Partial<CmsConfig>
	}
}
