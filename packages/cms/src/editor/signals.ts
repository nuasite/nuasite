import { batch, computed, type Signal, signal } from '@preact/signals'
import { fetchManifest, getMarkdownContent } from './api'
import type { ToastMessage, ToastType } from './components/toast/types'
import { getConfig } from './config'
import type {
	AIState,
	AIStatusType,
	AttributeEditorState,
	BlockEditorState,
	ChatMessage,
	CmsConfig,
	CmsManifest,
	CmsSettings,
	CollectionDefinition,
	CollectionEntry,
	CollectionsBrowserState,
	ColorEditorState,
	ComponentInstance,
	ConfirmDialogState,
	CreatePageState,
	DeploymentState,
	DeploymentStatusType,
	EditorState,
	FieldDefinition,
	MarkdownEditorState,
	MarkdownPageEntry,
	MediaItem,
	MediaLibraryState,
	PendingAttributeChange,
	PendingBackgroundImageChange,
	PendingChange,
	PendingColorChange,
	PendingComponentInsert,
	PendingImageChange,
	PendingSeoChange,
	SeoEditorState,
} from './types'

// ============================================================================
// Map Signal Helpers - reduces boilerplate for Map-based signals
// ============================================================================

interface MapSignalHelpers<T> {
	set: (id: string, value: T) => void
	update: (id: string, updater: (value: T) => T) => void
	delete: (id: string) => void
	clear: () => void
	get: (id: string) => T | undefined
}

/**
 * Creates helper functions for a Map-based signal.
 * Reduces boilerplate for common Map operations.
 */
function createMapHelpers<T>(mapSignal: Signal<Map<string, T>>): MapSignalHelpers<T> {
	return {
		set(id: string, value: T): void {
			const newMap = new Map(mapSignal.value)
			newMap.set(id, value)
			mapSignal.value = newMap
		},
		update(id: string, updater: (value: T) => T): void {
			const current = mapSignal.value.get(id)
			if (current) {
				const newMap = new Map(mapSignal.value)
				newMap.set(id, updater(current))
				mapSignal.value = newMap
			}
		},
		delete(id: string): void {
			const newMap = new Map(mapSignal.value)
			newMap.delete(id)
			mapSignal.value = newMap
		},
		clear(): void {
			mapSignal.value = new Map()
		},
		get(id: string): T | undefined {
			return mapSignal.value.get(id)
		},
	}
}

/**
 * Creates computed signals for tracking dirty items in a Map signal.
 * Works with any type that has an `isDirty` property.
 */
function createDirtyTracking<T extends { isDirty: boolean }>(
	mapSignal: Signal<Map<string, T>>,
) {
	const dirtyCount = computed(() => {
		return Array.from(mapSignal.value.values()).filter((c) => c.isDirty).length
	})
	const dirtyItems = computed(() => {
		return Array.from(mapSignal.value.entries()).filter(([_, item]) => item.isDirty)
	})
	const hasDirty = computed(() => dirtyCount.value > 0)

	return { dirtyCount, dirtyItems, hasDirty }
}

// Initial state factories
function createInitialAIState(): AIState {
	return {
		isPromptVisible: false,
		isProcessing: false,
		targetElementId: null,
		streamingContent: null,
		error: null,
		isChatOpen: false,
		chatMessages: [],
		chatContextElementId: null,
		currentStatus: null,
		statusMessage: null,
	}
}

function createInitialBlockEditorState(): BlockEditorState {
	return {
		isOpen: false,
		currentComponentId: null,
		mode: 'edit',
	}
}

function createInitialMarkdownEditorState(): MarkdownEditorState {
	return {
		isOpen: false,
		currentPage: null,
		activeElementId: null,
		mode: 'edit',
	}
}

function createInitialMediaLibraryState(): MediaLibraryState {
	return {
		isOpen: false,
		items: [],
		isLoading: false,
		selectedItem: null,
		insertCallback: null,
	}
}

function createInitialCreatePageState(): CreatePageState {
	return {
		isOpen: false,
		isCreating: false,
		selectedCollection: null,
	}
}

function createInitialCollectionsBrowserState(): CollectionsBrowserState {
	return {
		isOpen: false,
		selectedCollection: null,
	}
}

function createInitialDeploymentState(): DeploymentState {
	return {
		status: null,
		lastDeployedAt: null,
		isPolling: false,
		error: null,
	}
}

function createInitialColorEditorState(): ColorEditorState {
	return {
		isOpen: false,
		targetElementId: null,
		targetRect: null,
	}
}

function createInitialConfirmDialogState(): ConfirmDialogState {
	return {
		isOpen: false,
		title: '',
		message: '',
		confirmLabel: 'Confirm',
		cancelLabel: 'Cancel',
		variant: 'info',
		onConfirm: null,
		onCancel: null,
	}
}

function createInitialSettings(): CmsSettings {
	return {
		showEditableHighlights: false,
	}
}

function createInitialSeoEditorState(): SeoEditorState {
	return {
		isOpen: false,
	}
}

function createInitialAttributeEditorState(): AttributeEditorState {
	return {
		isOpen: false,
		targetElementId: null,
		targetRect: null,
	}
}

// ============================================================================
// Core Editor State Signals
// ============================================================================

export const isEnabled = signal(false)
export const isEditing = signal(false)
export const isSelectMode = signal(false)
export const isSaving = signal(false)
export const showingOriginal = signal(false)
export const currentEditingId = signal<string | null>(null)
export const currentComponentId = signal<string | null>(null)

// Complex state - use signals wrapping the full object for atomicity
export const pendingChanges = signal<Map<string, PendingChange>>(new Map())
export const pendingComponentChanges = signal<Map<string, ComponentInstance>>(
	new Map(),
)
export const pendingInserts = signal<Map<string, PendingComponentInsert>>(
	new Map(),
)
export const pendingImageChanges = signal<Map<string, PendingImageChange>>(
	new Map(),
)
export const pendingColorChanges = signal<Map<string, PendingColorChange>>(
	new Map(),
)
export const pendingBgImageChanges = signal<Map<string, PendingBackgroundImageChange>>(
	new Map(),
)
export const manifest = signal<CmsManifest>({
	entries: {},
	components: {},
	componentDefinitions: {},
})

// Computed signal to get the current page's collection entry (if any)
export const currentPageCollection = computed((): CollectionEntry | null => {
	const collections = manifest.value.collections
	if (!collections || Object.keys(collections).length === 0) return null
	// Return the first (and typically only) collection entry for the current page
	const entries = Object.values(collections)
	return entries.length > 0 ? entries[0]! : null
})

// Create helpers for Map signals (internal use)
const _pendingChangesHelpers = createMapHelpers(pendingChanges)
const _pendingComponentChangesHelpers = createMapHelpers(pendingComponentChanges)
const _pendingInsertsHelpers = createMapHelpers(pendingInserts)
const _pendingImageChangesHelpers = createMapHelpers(pendingImageChanges)
const _pendingColorChangesHelpers = createMapHelpers(pendingColorChanges)
const _pendingBgImageChangesHelpers = createMapHelpers(pendingBgImageChanges)

// ============================================================================
// AI State Signals
// ============================================================================

export const aiState = signal<AIState>(createInitialAIState())

// Convenience computed signals for AI state
export const isAIProcessing = computed(() => aiState.value.isProcessing)
export const isChatOpen = computed(() => aiState.value.isChatOpen)
export const chatMessages = computed(() => aiState.value.chatMessages)
export const chatContextElementId = computed(
	() => aiState.value.chatContextElementId,
)
export const currentStatus = computed(() => aiState.value.currentStatus)
export const statusMessage = computed(() => aiState.value.statusMessage)

// ============================================================================
// Block Editor State Signals
// ============================================================================

export const blockEditorState = signal<BlockEditorState>(
	createInitialBlockEditorState(),
)

// Convenience computed signals for block editor
export const isBlockEditorOpen = computed(() => blockEditorState.value.isOpen)
export const blockEditorMode = computed(() => blockEditorState.value.mode)

// ============================================================================
// Markdown Editor State Signals
// ============================================================================

export const markdownEditorState = signal<MarkdownEditorState>(
	createInitialMarkdownEditorState(),
)

// Convenience computed signals for markdown editor
export const isMarkdownEditorOpen = computed(
	() => markdownEditorState.value.isOpen,
)
export const currentMarkdownPage = computed(
	() => markdownEditorState.value.currentPage,
)
export const isMarkdownPreview = signal(false)

// ============================================================================
// Media Library State Signals
// ============================================================================

export const mediaLibraryState = signal<MediaLibraryState>(
	createInitialMediaLibraryState(),
)

// Convenience computed signals for media library
export const isMediaLibraryOpen = computed(() => mediaLibraryState.value.isOpen)
export const mediaLibraryItems = computed(() => mediaLibraryState.value.items)
export const isMediaLibraryLoading = computed(
	() => mediaLibraryState.value.isLoading,
)

// ============================================================================
// Create Page State Signals
// ============================================================================

export const createPageState = signal<CreatePageState>(
	createInitialCreatePageState(),
)

// Convenience computed signals for create page
export const isCreatePageOpen = computed(() => createPageState.value.isOpen)
export const isCreatingPage = computed(() => createPageState.value.isCreating)
export const selectedCollection = computed(() => createPageState.value.selectedCollection)

// ============================================================================
// Collections Browser State Signals
// ============================================================================

export const collectionsBrowserState = signal<CollectionsBrowserState>(
	createInitialCollectionsBrowserState(),
)

// Convenience computed signals for collections browser
export const isCollectionsBrowserOpen = computed(() => collectionsBrowserState.value.isOpen)
export const selectedBrowserCollection = computed(() => collectionsBrowserState.value.selectedCollection)

// ============================================================================
// Deployment State Signals
// ============================================================================

export const deploymentState = signal<DeploymentState>(
	createInitialDeploymentState(),
)

// Convenience computed signals for deployment
export const deploymentStatus = computed(() => deploymentState.value.status)
export const isDeploymentPolling = computed(() => deploymentState.value.isPolling)
export const lastDeployedAt = computed(() => deploymentState.value.lastDeployedAt)

// ============================================================================
// Redirect Countdown State
// ============================================================================

export interface RedirectCountdownState {
	url: string
	label: string
	secondsLeft: number
}

export const redirectCountdown = signal<RedirectCountdownState | null>(null)

let redirectTimer: ReturnType<typeof setInterval> | null = null

export function startRedirectCountdown(url: string, label: string, seconds = 10): void {
	stopRedirectCountdown()
	redirectCountdown.value = { url, label, secondsLeft: seconds }
	redirectTimer = setInterval(() => {
		const current = redirectCountdown.value
		if (!current) {
			stopRedirectCountdown()
			return
		}
		if (current.secondsLeft <= 1) {
			const targetUrl = current.url
			stopRedirectCountdown()
			window.location.href = targetUrl
		} else {
			redirectCountdown.value = { ...current, secondsLeft: current.secondsLeft - 1 }
		}
	}, 1000)
}

export function stopRedirectCountdown(): void {
	if (redirectTimer) {
		clearInterval(redirectTimer)
		redirectTimer = null
	}
	redirectCountdown.value = null
}

// ============================================================================
// Color Editor State Signals
// ============================================================================

export const colorEditorState = signal<ColorEditorState>(
	createInitialColorEditorState(),
)

// Convenience computed signals for color editor
export const isColorEditorOpen = computed(() => colorEditorState.value.isOpen)
export const colorEditorTargetId = computed(() => colorEditorState.value.targetElementId)

// ============================================================================
// Confirm Dialog State Signals
// ============================================================================

export const confirmDialogState = signal<ConfirmDialogState>(
	createInitialConfirmDialogState(),
)

// Convenience computed signals for confirm dialog
export const isConfirmDialogOpen = computed(() => confirmDialogState.value.isOpen)

// ============================================================================
// Settings State Signals
// ============================================================================

export const settings = signal<CmsSettings>(createInitialSettings())

// Convenience computed signals for settings
export const showEditableHighlights = computed(() => settings.value.showEditableHighlights)

// ============================================================================
// SEO Editor State Signals
// ============================================================================

export const seoEditorState = signal<SeoEditorState>(createInitialSeoEditorState())
export const pendingSeoChanges = signal<Map<string, PendingSeoChange>>(new Map())

// Convenience computed signals for SEO editor
export const isSeoEditorOpen = computed(() => seoEditorState.value.isOpen)

// Create helpers for pending SEO changes
const _pendingSeoChangesHelpers = createMapHelpers(pendingSeoChanges)

// ============================================================================
// Attribute Editor State Signals
// ============================================================================

export const attributeEditorState = signal<AttributeEditorState>(createInitialAttributeEditorState())
export const pendingAttributeChanges = signal<Map<string, PendingAttributeChange>>(new Map())

// Convenience computed signals for attribute editor
export const isAttributeEditorOpen = computed(() => attributeEditorState.value.isOpen)
export const attributeEditorTargetId = computed(() => attributeEditorState.value.targetElementId)

// Create helpers for pending attribute changes
const _pendingAttributeChangesHelpers = createMapHelpers(pendingAttributeChanges)

// ============================================================================
// Swatch/Attribute Button Hover State Signals
// ============================================================================

/** True when user is hovering over color swatches */
export const isHoveringSwatches = signal(false)

/** True when user is hovering over attribute edit button */
export const isHoveringAttributeButton = signal(false)

/** Computed: true when hovering over any outline UI element (swatches, attr button) */
export const isHoveringOutlineUI = computed(() => isHoveringSwatches.value || isHoveringAttributeButton.value)

export function setHoveringSwatches(hovering: boolean): void {
	isHoveringSwatches.value = hovering
}

export function setHoveringAttributeButton(hovering: boolean): void {
	isHoveringAttributeButton.value = hovering
}

// ============================================================================
// Config Signal
// ============================================================================

export const config = signal<CmsConfig>(getConfig())

// ============================================================================
// Toast State
// ============================================================================

export const toasts = signal<ToastMessage[]>([])

// Counter for unique toast IDs (more reliable than Date.now())
let toastIdCounter = 0

// ============================================================================
// Computed Values - Dirty Tracking
// ============================================================================

/** All change categories that participate in dirty tracking.
 *  Adding a new category forces a TypeScript error until it's added to changeRegistry. */
type ChangeCategory = 'text' | 'image' | 'color' | 'bgImage' | 'seo' | 'attribute'

interface ChangeRegistryEntry {
	mapSignal: Signal<Map<string, any>>
	dirtyCount: ReturnType<typeof computed<number>>
	hasDirty: ReturnType<typeof computed<boolean>>
}

// Use factory for dirty tracking to reduce duplication
const _pendingChangesDirty = createDirtyTracking(pendingChanges)
const _pendingImageChangesDirty = createDirtyTracking(pendingImageChanges)
const _pendingColorChangesDirty = createDirtyTracking(pendingColorChanges)
const _pendingBgImageChangesDirty = createDirtyTracking(pendingBgImageChanges)
const _pendingSeoChangesDirty = createDirtyTracking(pendingSeoChanges)
const _pendingAttributeChangesDirty = createDirtyTracking(pendingAttributeChanges)

export const changeRegistry: Record<ChangeCategory, ChangeRegistryEntry> = {
	text: { mapSignal: pendingChanges, dirtyCount: _pendingChangesDirty.dirtyCount, hasDirty: _pendingChangesDirty.hasDirty },
	image: { mapSignal: pendingImageChanges, dirtyCount: _pendingImageChangesDirty.dirtyCount, hasDirty: _pendingImageChangesDirty.hasDirty },
	color: { mapSignal: pendingColorChanges, dirtyCount: _pendingColorChangesDirty.dirtyCount, hasDirty: _pendingColorChangesDirty.hasDirty },
	bgImage: { mapSignal: pendingBgImageChanges, dirtyCount: _pendingBgImageChangesDirty.dirtyCount, hasDirty: _pendingBgImageChangesDirty.hasDirty },
	seo: { mapSignal: pendingSeoChanges, dirtyCount: _pendingSeoChangesDirty.dirtyCount, hasDirty: _pendingSeoChangesDirty.hasDirty },
	attribute: {
		mapSignal: pendingAttributeChanges,
		dirtyCount: _pendingAttributeChangesDirty.dirtyCount,
		hasDirty: _pendingAttributeChangesDirty.hasDirty,
	},
}

export const dirtyChangesCount = _pendingChangesDirty.dirtyCount
export const dirtyChanges = _pendingChangesDirty.dirtyItems
export const hasDirtyChanges = _pendingChangesDirty.hasDirty

export const dirtyImageChangesCount = _pendingImageChangesDirty.dirtyCount
export const dirtyImageChanges = _pendingImageChangesDirty.dirtyItems
export const hasDirtyImageChanges = _pendingImageChangesDirty.hasDirty

export const dirtyColorChangesCount = _pendingColorChangesDirty.dirtyCount
export const dirtyColorChanges = _pendingColorChangesDirty.dirtyItems
export const hasDirtyColorChanges = _pendingColorChangesDirty.hasDirty

export const dirtyBgImageChangesCount = _pendingBgImageChangesDirty.dirtyCount
export const dirtyBgImageChanges = _pendingBgImageChangesDirty.dirtyItems
export const hasDirtyBgImageChanges = _pendingBgImageChangesDirty.hasDirty

export const dirtySeoChangesCount = _pendingSeoChangesDirty.dirtyCount
export const dirtySeoChanges = _pendingSeoChangesDirty.dirtyItems
export const hasDirtySeoChanges = _pendingSeoChangesDirty.hasDirty

export const dirtyAttributeChangesCount = _pendingAttributeChangesDirty.dirtyCount
export const dirtyAttributeChanges = _pendingAttributeChangesDirty.dirtyItems
export const hasDirtyAttributeChanges = _pendingAttributeChangesDirty.hasDirty

const _registryEntries = Object.values(changeRegistry)

export const totalDirtyCount = computed(() => _registryEntries.reduce((sum, entry) => sum + entry.dirtyCount.value, 0))

export const hasAnyDirtyChanges = computed(() => _registryEntries.some((entry) => entry.hasDirty.value))

// Navigation index for cycling through dirty elements
export const changeNavigationIndex = signal<number>(0)

// Combined list of all dirty elements for navigation
export const allDirtyElements = computed(() => {
	const elements: Array<{ cmsId: string; element: HTMLElement; type: 'text' | 'image' | 'color' }> = []

	dirtyChanges.value.forEach(([cmsId, change]) => {
		elements.push({ cmsId, element: change.element, type: 'text' })
	})
	dirtyImageChanges.value.forEach(([cmsId, change]) => {
		elements.push({ cmsId, element: change.element, type: 'image' })
	})
	dirtyColorChanges.value.forEach(([cmsId, change]) => {
		elements.push({ cmsId, element: change.element, type: 'color' })
	})

	return elements
})

// ============================================================================
// State Mutation Functions
// ============================================================================

// Editor state mutations
export function setManifest(newManifest: CmsManifest): void {
	manifest.value = newManifest
}

export function setEnabled(enabled: boolean): void {
	isEnabled.value = enabled
}

export function setEditing(editing: boolean): void {
	isEditing.value = editing
}

export function setShowingOriginal(showing: boolean): void {
	showingOriginal.value = showing
}

export function setCurrentEditingId(id: string | null): void {
	currentEditingId.value = id
}

export function setCurrentComponentId(componentId: string | null): void {
	batch(() => {
		currentComponentId.value = componentId
		blockEditorState.value = {
			...blockEditorState.value,
			currentComponentId: componentId,
		}
	})
}

// Pending changes mutations - using helpers
export const setPendingChange = _pendingChangesHelpers.set
export const updatePendingChange = _pendingChangesHelpers.update
export const deletePendingChange = _pendingChangesHelpers.delete
export const clearPendingChanges = _pendingChangesHelpers.clear
export const getPendingChange = _pendingChangesHelpers.get

// Component changes mutations - using helpers
export const setPendingComponentChange = _pendingComponentChangesHelpers.set
export const deletePendingComponentChange = _pendingComponentChangesHelpers.delete
export const clearPendingComponentChanges = _pendingComponentChangesHelpers.clear

// Insert mutations - using helpers
export const setPendingInsert = _pendingInsertsHelpers.set
export const deletePendingInsert = _pendingInsertsHelpers.delete
export const clearPendingInserts = _pendingInsertsHelpers.clear

// Image changes mutations - using helpers
export const setPendingImageChange = _pendingImageChangesHelpers.set
export const updatePendingImageChange = _pendingImageChangesHelpers.update
export const deletePendingImageChange = _pendingImageChangesHelpers.delete
export const clearPendingImageChanges = _pendingImageChangesHelpers.clear
export const getPendingImageChange = _pendingImageChangesHelpers.get

// Color changes mutations - using helpers
export const setPendingColorChange = _pendingColorChangesHelpers.set
export const updatePendingColorChange = _pendingColorChangesHelpers.update
export const deletePendingColorChange = _pendingColorChangesHelpers.delete
export const clearPendingColorChanges = _pendingColorChangesHelpers.clear
export const getPendingColorChange = _pendingColorChangesHelpers.get

// Background image changes mutations - using helpers
export const setPendingBgImageChange = _pendingBgImageChangesHelpers.set
export const updatePendingBgImageChange = _pendingBgImageChangesHelpers.update
export const deletePendingBgImageChange = _pendingBgImageChangesHelpers.delete
export const clearPendingBgImageChanges = _pendingBgImageChangesHelpers.clear
export const getPendingBgImageChange = _pendingBgImageChangesHelpers.get

// SEO changes mutations - using helpers
export const setPendingSeoChange = _pendingSeoChangesHelpers.set
export const updatePendingSeoChange = _pendingSeoChangesHelpers.update
export const deletePendingSeoChange = _pendingSeoChangesHelpers.delete
export const clearPendingSeoChanges = _pendingSeoChangesHelpers.clear
export const getPendingSeoChange = _pendingSeoChangesHelpers.get

// Attribute changes mutations - using helpers
export const setPendingAttributeChange = _pendingAttributeChangesHelpers.set
export const updatePendingAttributeChange = _pendingAttributeChangesHelpers.update
export const deletePendingAttributeChange = _pendingAttributeChangesHelpers.delete
export const clearPendingAttributeChanges = _pendingAttributeChangesHelpers.clear
export const getPendingAttributeChange = _pendingAttributeChangesHelpers.get

// ============================================================================
// AI State Mutations
// ============================================================================

export function setAIPromptVisible(visible: boolean): void {
	aiState.value = { ...aiState.value, isPromptVisible: visible }
}

export function setAIProcessing(processing: boolean): void {
	aiState.value = { ...aiState.value, isProcessing: processing }
}

export function setAIStatus(status: AIStatusType, message?: string): void {
	aiState.value = {
		...aiState.value,
		currentStatus: status,
		statusMessage: message ?? null,
	}
}

export function clearAIStatus(): void {
	aiState.value = {
		...aiState.value,
		currentStatus: null,
		statusMessage: null,
	}
}

export function setAITargetElement(elementId: string | null): void {
	aiState.value = { ...aiState.value, targetElementId: elementId }
}

export function setAIStreamingContent(content: string | null): void {
	aiState.value = { ...aiState.value, streamingContent: content }
}

export function setAIError(error: string | null): void {
	aiState.value = { ...aiState.value, error: error }
}

export function resetAIState(): void {
	aiState.value = createInitialAIState()
}

export function setAIChatOpen(open: boolean): void {
	aiState.value = { ...aiState.value, isChatOpen: open }
}

export function addChatMessage(message: ChatMessage): void {
	aiState.value = {
		...aiState.value,
		chatMessages: [...aiState.value.chatMessages, message],
	}
}

export function setChatMessages(messages: ChatMessage[]): void {
	aiState.value = {
		...aiState.value,
		chatMessages: messages,
	}
}

export function updateChatMessage(messageId: string, content: string): void {
	aiState.value = {
		...aiState.value,
		chatMessages: aiState.value.chatMessages.map((msg) => msg.id === messageId ? { ...msg, content } : msg),
	}
}

export function setChatContextElement(elementId: string | null): void {
	aiState.value = { ...aiState.value, chatContextElementId: elementId }
}

export function clearChatMessages(): void {
	aiState.value = { ...aiState.value, chatMessages: [] }
}

// ============================================================================
// Block Editor State Mutations
// ============================================================================

export function setBlockEditorOpen(open: boolean): void {
	blockEditorState.value = { ...blockEditorState.value, isOpen: open }
}

export function setBlockEditorMode(mode: 'edit' | 'add' | 'picker'): void {
	blockEditorState.value = { ...blockEditorState.value, mode }
}

export function resetBlockEditorState(): void {
	blockEditorState.value = createInitialBlockEditorState()
}

// ============================================================================
// Markdown Editor State Mutations
// ============================================================================

export function setMarkdownEditorOpen(open: boolean): void {
	markdownEditorState.value = { ...markdownEditorState.value, isOpen: open }
}

export function setMarkdownPage(page: MarkdownPageEntry | null): void {
	markdownEditorState.value = { ...markdownEditorState.value, currentPage: page }
}

export function updateMarkdownContent(content: string): void {
	if (markdownEditorState.value.currentPage) {
		markdownEditorState.value = {
			...markdownEditorState.value,
			currentPage: {
				...markdownEditorState.value.currentPage,
				content,
				isDirty: true,
			},
		}
	}
}

export function setMarkdownActiveElement(elementId: string | null): void {
	markdownEditorState.value = {
		...markdownEditorState.value,
		activeElementId: elementId,
	}
}

export function updateMarkdownFrontmatter(updates: Partial<import('./types').BlogFrontmatter>): void {
	if (markdownEditorState.value.currentPage) {
		markdownEditorState.value = {
			...markdownEditorState.value,
			currentPage: {
				...markdownEditorState.value.currentPage,
				frontmatter: {
					...markdownEditorState.value.currentPage.frontmatter,
					...updates,
				},
				isDirty: true,
			},
		}
	}
}

export function resetMarkdownEditorState(): void {
	markdownEditorState.value = createInitialMarkdownEditorState()
}

/**
 * Parse a frontmatter value from string to its appropriate type.
 * The manifest stores all values as strings, so we need to convert them back.
 */
function parseFrontmatterValue(value: string): unknown {
	// Handle booleans
	if (value === 'true') return true
	if (value === 'false') return false

	// Handle numbers
	const num = Number(value)
	if (!Number.isNaN(num) && value.trim() !== '') {
		return num
	}

	// Handle arrays (simple comma-separated for now)
	if (value.startsWith('[') && value.endsWith(']')) {
		try {
			return JSON.parse(value)
		} catch {
			// Not valid JSON, return as string
		}
	}

	// Return as string (already the default)
	return value
}

/**
 * Open the markdown editor for the current page's collection entry.
 * Refreshes the manifest first to ensure we have the latest content.
 */
export async function openMarkdownEditorForCurrentPage(): Promise<boolean> {
	// Refresh manifest to get the latest content
	try {
		const newManifest = await fetchManifest()
		setManifest(newManifest)
	} catch (err) {
		console.error('[CMS] Failed to refresh manifest:', err)
		// Continue with current manifest if refresh fails
	}

	const collection = currentPageCollection.value
	if (!collection) {
		return false
	}

	// Fetch the actual markdown content via the API to get properly parsed frontmatter.
	// The manifest's naive YAML parsing corrupts block scalars (e.g. `description: >-`).
	let frontmatter: Record<string, unknown>
	let content: string
	try {
		const result = await getMarkdownContent(config.value.apiBase, collection.sourcePath)
		if (result) {
			frontmatter = result.frontmatter as Record<string, unknown>
			content = result.content
		} else {
			throw new Error('API returned null')
		}
	} catch {
		// Fall back to manifest data if the API call fails
		frontmatter = {}
		for (const [key, data] of Object.entries(collection.frontmatter)) {
			frontmatter[key] = parseFrontmatterValue(data.value)
		}
		content = collection.body
	}

	// Look up collection definition for schema-aware field rendering
	const collectionDefinition = manifest.value.collectionDefinitions?.[collection.collectionName]

	markdownEditorState.value = {
		isOpen: true,
		currentPage: {
			filePath: collection.sourcePath,
			slug: collection.collectionSlug,
			frontmatter: frontmatter as import('./types').BlogFrontmatter,
			content,
			isDirty: false,
		},
		activeElementId: collection.wrapperId ?? null,
		mode: 'edit',
		collectionDefinition,
	}
	return true
}

/**
 * Open the markdown editor in "create" mode for a new page in the given collection.
 * Builds initial frontmatter from the collection's field definitions.
 */
export function openMarkdownEditorForNewPage(
	collectionName: string,
	collectionDefinition: CollectionDefinition,
): void {
	// Build initial frontmatter from field definitions
	const initialFrontmatter: Record<string, unknown> = {}
	for (const field of collectionDefinition.fields) {
		if (field.name === 'title') continue // title handled separately via the header
		if (field.defaultValue !== undefined) {
			initialFrontmatter[field.name] = field.defaultValue
		} else {
			initialFrontmatter[field.name] = getDefaultForFieldType(field)
		}
	}

	markdownEditorState.value = {
		isOpen: true,
		currentPage: {
			filePath: '',
			slug: '',
			frontmatter: { title: '', ...initialFrontmatter },
			content: '',
			isDirty: false,
		},
		activeElementId: null,
		mode: 'create',
		collectionDefinition,
		createOptions: {
			collectionName,
			collectionDefinition,
		},
	}
}

/**
 * Get a sensible default value for a field based on its type definition.
 */
function getDefaultForFieldType(field: FieldDefinition): unknown {
	switch (field.type) {
		case 'boolean':
			return false
		case 'number':
			return 0
		case 'array':
			return []
		case 'date':
			return new Date().toISOString().split('T')[0]
		default:
			return ''
	}
}

// ============================================================================
// Media Library State Mutations
// ============================================================================

export function setMediaLibraryOpen(open: boolean): void {
	mediaLibraryState.value = { ...mediaLibraryState.value, isOpen: open }
}

export function setMediaLibraryItems(items: MediaItem[]): void {
	mediaLibraryState.value = { ...mediaLibraryState.value, items }
}

export function setMediaLibraryLoading(loading: boolean): void {
	mediaLibraryState.value = { ...mediaLibraryState.value, isLoading: loading }
}

export function setMediaLibrarySelectedItem(item: MediaItem | null): void {
	mediaLibraryState.value = { ...mediaLibraryState.value, selectedItem: item }
}

export function setMediaLibraryInsertCallback(
	callback: ((url: string, alt: string) => void) | null,
): void {
	mediaLibraryState.value = { ...mediaLibraryState.value, insertCallback: callback }
}

export function openMediaLibraryWithCallback(
	callback: (url: string, alt: string) => void,
): void {
	mediaLibraryState.value = {
		...mediaLibraryState.value,
		isOpen: true,
		insertCallback: callback,
	}
}

export function resetMediaLibraryState(): void {
	mediaLibraryState.value = createInitialMediaLibraryState()
}

// ============================================================================
// Create Page State Mutations
// ============================================================================

export function setCreatePageOpen(open: boolean): void {
	createPageState.value = { ...createPageState.value, isOpen: open }
}

export function setCreatingPage(creating: boolean): void {
	createPageState.value = { ...createPageState.value, isCreating: creating }
}

export function setSelectedCollection(collection: string | null): void {
	createPageState.value = { ...createPageState.value, selectedCollection: collection }
}

export function resetCreatePageState(): void {
	createPageState.value = createInitialCreatePageState()
}

// ============================================================================
// Collections Browser State Mutations
// ============================================================================

export function openCollectionsBrowser(): void {
	collectionsBrowserState.value = { isOpen: true, selectedCollection: null }
}

export function selectBrowserCollection(name: string | null): void {
	collectionsBrowserState.value = { ...collectionsBrowserState.value, selectedCollection: name }
}

export function closeCollectionsBrowser(): void {
	collectionsBrowserState.value = createInitialCollectionsBrowserState()
}

/**
 * Open the markdown editor for an existing collection entry.
 * Fetches markdown content via the API and opens in edit mode.
 */
export async function openMarkdownEditorForEntry(
	collectionName: string,
	slug: string,
	sourcePath: string,
	collectionDefinition: CollectionDefinition,
): Promise<void> {
	let frontmatter: Record<string, unknown> = {}
	let content = ''

	try {
		const result = await getMarkdownContent(config.value.apiBase, sourcePath)
		if (result) {
			frontmatter = result.frontmatter as Record<string, unknown>
			content = result.content
		}
	} catch (err) {
		console.error('[CMS] Failed to fetch markdown content for entry:', err)
	}

	markdownEditorState.value = {
		isOpen: true,
		currentPage: {
			filePath: sourcePath,
			slug,
			frontmatter: frontmatter as import('./types').BlogFrontmatter,
			content,
			isDirty: false,
		},
		activeElementId: null,
		mode: 'edit',
		collectionDefinition,
	}
}

// ============================================================================
// Deployment State Mutations
// ============================================================================

export function setDeploymentStatus(status: DeploymentStatusType | null): void {
	deploymentState.value = { ...deploymentState.value, status }
}

export function setDeploymentPolling(isPolling: boolean): void {
	deploymentState.value = { ...deploymentState.value, isPolling }
}

export function setLastDeployedAt(timestamp: string | null): void {
	deploymentState.value = { ...deploymentState.value, lastDeployedAt: timestamp }
}

export function setDeploymentError(error: string | null): void {
	deploymentState.value = { ...deploymentState.value, error }
}

export function updateDeploymentState(update: Partial<DeploymentState>): void {
	deploymentState.value = { ...deploymentState.value, ...update }
}

export function resetDeploymentState(): void {
	deploymentState.value = createInitialDeploymentState()
}

// ============================================================================
// Color Editor State Mutations
// ============================================================================

export function setColorEditorOpen(open: boolean): void {
	colorEditorState.value = { ...colorEditorState.value, isOpen: open }
}

export function setColorEditorTarget(elementId: string | null, rect: DOMRect | null): void {
	colorEditorState.value = {
		...colorEditorState.value,
		targetElementId: elementId,
		targetRect: rect,
	}
}

export function openColorEditor(elementId: string, rect: DOMRect): void {
	// Close attribute editor when opening color editor
	attributeEditorState.value = createInitialAttributeEditorState()

	colorEditorState.value = {
		isOpen: true,
		targetElementId: elementId,
		targetRect: rect,
	}
}

export function closeColorEditor(): void {
	colorEditorState.value = createInitialColorEditorState()
}

export function resetColorEditorState(): void {
	colorEditorState.value = createInitialColorEditorState()
}

// ============================================================================
// Confirm Dialog State Mutations
// ============================================================================

export interface ShowConfirmOptions {
	title?: string
	message: string
	confirmLabel?: string
	cancelLabel?: string
	variant?: 'danger' | 'warning' | 'info'
}

export function showConfirmDialog(
	options: ShowConfirmOptions,
): Promise<boolean> {
	return new Promise((resolve) => {
		confirmDialogState.value = {
			isOpen: true,
			title: options.title ?? 'Confirm',
			message: options.message,
			confirmLabel: options.confirmLabel ?? 'Confirm',
			cancelLabel: options.cancelLabel ?? 'Cancel',
			variant: options.variant ?? 'info',
			onConfirm: () => {
				closeConfirmDialog()
				resolve(true)
			},
			onCancel: () => {
				closeConfirmDialog()
				resolve(false)
			},
		}
	})
}

export function closeConfirmDialog(): void {
	confirmDialogState.value = createInitialConfirmDialogState()
}

// ============================================================================
// Settings State Mutations
// ============================================================================

export function setShowEditableHighlights(show: boolean): void {
	settings.value = { ...settings.value, showEditableHighlights: show }
}

export function toggleShowEditableHighlights(): void {
	settings.value = { ...settings.value, showEditableHighlights: !settings.value.showEditableHighlights }
}

export function updateSettings(update: Partial<CmsSettings>): void {
	settings.value = { ...settings.value, ...update }
}

export function resetSettings(): void {
	settings.value = createInitialSettings()
}

// ============================================================================
// SEO Editor State Mutations
// ============================================================================

export function setSeoEditorOpen(open: boolean): void {
	seoEditorState.value = { ...seoEditorState.value, isOpen: open }
}

export function openSeoEditor(): void {
	seoEditorState.value = { isOpen: true }
}

export function closeSeoEditor(): void {
	seoEditorState.value = createInitialSeoEditorState()
}

export function resetSeoEditorState(): void {
	seoEditorState.value = createInitialSeoEditorState()
	pendingSeoChanges.value = new Map()
}

// ============================================================================
// Attribute Editor State Mutations
// ============================================================================

export function setAttributeEditorOpen(open: boolean): void {
	attributeEditorState.value = { ...attributeEditorState.value, isOpen: open }
}

export function setAttributeEditorTarget(elementId: string | null, rect: DOMRect | null): void {
	attributeEditorState.value = {
		...attributeEditorState.value,
		targetElementId: elementId,
		targetRect: rect,
	}
}

export function openAttributeEditor(elementId: string, rect: DOMRect): void {
	// Close color editor when opening attribute editor
	colorEditorState.value = createInitialColorEditorState()

	// Ensure pending attribute change exists for this element
	if (!pendingAttributeChanges.value.has(elementId)) {
		const manifestEntry = manifest.value.entries[elementId]
		if (manifestEntry?.attributes && Object.keys(manifestEntry.attributes).length > 0) {
			// Deep copy the flat attributes map
			const originalAttributes: Record<string, import('./types').Attribute> = {}
			const newAttributes: Record<string, import('./types').Attribute> = {}
			for (const [key, attr] of Object.entries(manifestEntry.attributes)) {
				originalAttributes[key] = { ...attr }
				newAttributes[key] = { ...attr }
			}

			// Find the element in the DOM
			const element = document.querySelector(`[data-cms-id="${elementId}"]`) as HTMLElement | null

			if (element) {
				const newMap = new Map(pendingAttributeChanges.value)
				newMap.set(elementId, {
					element,
					cmsId: elementId,
					originalAttributes,
					newAttributes,
					isDirty: false,
				})
				pendingAttributeChanges.value = newMap
			}
		}
	}

	attributeEditorState.value = {
		isOpen: true,
		targetElementId: elementId,
		targetRect: rect,
	}
}

export function closeAttributeEditor(): void {
	attributeEditorState.value = createInitialAttributeEditorState()
}

export function resetAttributeEditorState(): void {
	attributeEditorState.value = createInitialAttributeEditorState()
	pendingAttributeChanges.value = new Map()
}

// ============================================================================
// Toast Mutations
// ============================================================================

export function showToast(message: string, type: ToastType = 'info'): string {
	const id = `toast-${++toastIdCounter}`
	toasts.value = [...toasts.value, { id, message, type }]
	return id
}

export function removeToast(id: string): void {
	toasts.value = toasts.value.filter((t) => t.id !== id)
}

// ============================================================================
// Config Mutations
// ============================================================================

export function setConfig(newConfig: CmsConfig): void {
	config.value = newConfig
}

// ============================================================================
// Change Navigation Mutations
// ============================================================================

export function navigateToNextChange(): void {
	const elements = allDirtyElements.value
	if (elements.length === 0) return

	const nextIndex = (changeNavigationIndex.value + 1) % elements.length
	changeNavigationIndex.value = nextIndex

	const target = elements[nextIndex]
	if (!target?.element) return

	target.element.scrollIntoView({ behavior: 'smooth', block: 'center' })

	if (target.type === 'text') {
		target.element.focus()
	}
	setCurrentEditingId(target.cmsId)
}

export function resetChangeNavigationIndex(): void {
	changeNavigationIndex.value = 0
}

// ============================================================================
// Legacy Compatibility Layer
// ============================================================================

/**
 * Get a snapshot of the current state for legacy code paths.
 * Prefer using individual signals directly when possible.
 */
export function getStateSnapshot(): EditorState {
	return {
		isEnabled: isEnabled.value,
		isEditing: isEditing.value,
		showingOriginal: showingOriginal.value,
		currentEditingId: currentEditingId.value,
		currentComponentId: currentComponentId.value,
		pendingChanges: pendingChanges.value,
		pendingComponentChanges: pendingComponentChanges.value,
		pendingInserts: pendingInserts.value,
		manifest: manifest.value,
		ai: aiState.value,
		blockEditor: blockEditorState.value,
	}
}

/**
 * Batch multiple state updates for performance.
 * Use this when updating multiple signals at once.
 */
export { batch }

/**
 * Reset all state to initial values.
 */
export function resetAllState(): void {
	batch(() => {
		isEnabled.value = false
		isEditing.value = false
		showingOriginal.value = false
		currentEditingId.value = null
		currentComponentId.value = null
		for (const entry of Object.values(changeRegistry)) {
			entry.mapSignal.value = new Map()
		}
		// Non-dirty-tracked maps still cleared individually
		pendingComponentChanges.value = new Map()
		pendingInserts.value = new Map()
		manifest.value = { entries: {}, components: {}, componentDefinitions: {} }
		aiState.value = createInitialAIState()
		blockEditorState.value = createInitialBlockEditorState()
		markdownEditorState.value = createInitialMarkdownEditorState()
		mediaLibraryState.value = createInitialMediaLibraryState()
		createPageState.value = createInitialCreatePageState()
		collectionsBrowserState.value = createInitialCollectionsBrowserState()
		deploymentState.value = createInitialDeploymentState()
		colorEditorState.value = createInitialColorEditorState()
		confirmDialogState.value = createInitialConfirmDialogState()
		seoEditorState.value = createInitialSeoEditorState()
		attributeEditorState.value = createInitialAttributeEditorState()
		toasts.value = []
	})
}
