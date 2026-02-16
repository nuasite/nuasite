import { render } from 'preact'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { CmsElementDeselectedMessage, CmsElementSelectedMessage } from '../types'
import { fetchManifest } from './api'
import { AttributeEditor } from './components/attribute-editor'
import { BgImageOverlay } from './components/bg-image-overlay'
import { BlockEditor } from './components/block-editor'
import { CollectionsBrowser } from './components/collections-browser'
import { ColorToolbar } from './components/color-toolbar'
import { ConfirmDialog } from './components/confirm-dialog'
import { CreatePageModal } from './components/create-page-modal'
import { EditableHighlights } from './components/editable-highlights'
import { ErrorBoundary } from './components/error-boundary'
import { ImageOverlay } from './components/image-overlay'
import { MarkdownEditorOverlay } from './components/markdown-editor-overlay'
import { MediaLibrary } from './components/media-library'
import { Outline } from './components/outline'
import { RedirectCountdown } from './components/redirect-countdown'
import { SeoEditor } from './components/seo-editor'
import { TextStyleToolbar } from './components/text-style-toolbar'
import { ToastContainer } from './components/toast/toast-container'
import { Toolbar } from './components/toolbar'
import { getConfig } from './config'
import { logDebug } from './dom'
import {
	discardAllChanges,
	dismissDeploymentStatus,
	handleColorChange,
	saveAllChanges,
	startEditMode,
	stopEditMode,
	toggleShowOriginal,
} from './editor'
import { canRedo, canUndo, performRedo, performUndo } from './history'
import {
	useBgImageHoverDetection,
	useBlockEditorHandlers,
	useComponentClickHandler,
	useElementDetection,
	useImageHoverDetection,
	useTextSelection,
	useTooltipState,
} from './hooks'
import {
	buildEditorState,
	buildPageNavigatedMessage,
	buildReadyMessage,
	buildSelectedElement,
	buildStateChangedMessage,
	postToParent,
} from './post-message'
import {
	openCollectionsBrowser,
	openMarkdownEditorForCurrentPage,
	openSeoEditor,
	selectBrowserCollection,
	setMediaLibraryOpen,
	toggleShowEditableHighlights,
	updateSettings,
} from './signals'
import * as signals from './signals'
import { hasPendingEntryNavigation, loadEditingState, loadSettingsFromStorage, saveSettingsToStorage } from './storage'
import CMS_STYLES from './styles.css?inline'
import { generateCSSVariables, resolveTheme } from './themes'

/** Inline CSS values for Tailwind text style classes (for preview before save) */
const TEXT_STYLE_INLINE_CSS: Record<string, Record<string, string>> = {
	'font-normal': { fontWeight: '400' },
	'font-medium': { fontWeight: '500' },
	'font-semibold': { fontWeight: '600' },
	'font-bold': { fontWeight: '700' },
	'italic': { fontStyle: 'italic' },
	'not-italic': { fontStyle: 'normal' },
	'underline': { textDecoration: 'underline' },
	'line-through': { textDecoration: 'line-through' },
	'no-underline': { textDecoration: 'none' },
	'text-xs': { fontSize: '0.75rem', lineHeight: '1rem' },
	'text-sm': { fontSize: '0.875rem', lineHeight: '1.25rem' },
	'text-base': { fontSize: '1rem', lineHeight: '1.5rem' },
	'text-lg': { fontSize: '1.125rem', lineHeight: '1.75rem' },
	'text-xl': { fontSize: '1.25rem', lineHeight: '1.75rem' },
	'text-2xl': { fontSize: '1.5rem', lineHeight: '2rem' },
	'text-3xl': { fontSize: '1.875rem', lineHeight: '2.25rem' },
}

const CmsUI = () => {
	const config = signals.config.value
	const outlineState = useElementDetection()
	const imageHoverState = useImageHoverDetection()
	const bgImageHoverState = useBgImageHoverDetection()
	const textSelectionState = useTextSelection()
	const { tooltipState, showTooltipForElement, hideTooltip } = useTooltipState()
	const updateUI = useCallback(() => {
		showTooltipForElement()
	}, [showTooltipForElement])

	// Load settings from localStorage on mount
	useEffect(() => {
		const savedSettings = loadSettingsFromStorage()
		if (savedSettings) {
			updateSettings(savedSettings)
		}
	}, [])

	// Fetch manifest on mount so toolbar has collection/SEO data before edit mode
	useEffect(() => {
		fetchManifest().then((manifest) => {
			signals.setManifest(manifest)
		}).catch(() => {})
	}, [])

	// Re-fetch manifest on View Transitions navigation (astro:after-swap)
	useEffect(() => {
		const onNavigation = () => {
			fetchManifest().then((manifest) => {
				signals.setManifest(manifest)
			}).catch(() => {})
		}
		document.addEventListener('astro:after-swap', onNavigation)
		return () => document.removeEventListener('astro:after-swap', onNavigation)
	}, [])

	// Auto-restore edit mode if it was active before a page refresh (e.g. after save triggers HMR)
	useEffect(() => {
		if (loadEditingState() && !signals.isEditing.value) {
			startEditMode(config, updateUI)
		}
	}, [config, updateUI])

	// Auto-open markdown editor when there's a pending entry navigation from collections browser
	useEffect(() => {
		if (hasPendingEntryNavigation()) {
			openMarkdownEditorForCurrentPage()
		}
	}, [])

	// Send selected element info to parent window via postMessage (when inside an iframe)
	const prevOutlineRef = useRef<{ cmsId: string | null; isComponent: boolean }>({ cmsId: null, isComponent: false })
	useEffect(() => {
		const prev = prevOutlineRef.current
		const changed = outlineState.cmsId !== prev.cmsId
			|| outlineState.isComponent !== prev.isComponent
			|| (!outlineState.visible && (prev.cmsId !== null || prev.isComponent))

		if (!changed) return
		prevOutlineRef.current = { cmsId: outlineState.cmsId, isComponent: outlineState.isComponent }

		if (outlineState.visible && (outlineState.cmsId || outlineState.isComponent)) {
			const manifestData = signals.manifest.value
			const entry = outlineState.cmsId ? manifestData.entries[outlineState.cmsId] : undefined
			const componentEl = outlineState.element
			const componentId = componentEl?.getAttribute('data-cms-component-id') ?? undefined
			const instance = componentId ? manifestData.components?.[componentId] : undefined
			const rect = outlineState.rect

			const msg: CmsElementSelectedMessage = {
				type: 'cms-element-selected',
				element: buildSelectedElement({
					cmsId: outlineState.cmsId,
					isComponent: outlineState.isComponent,
					componentName: outlineState.componentName,
					componentId,
					tagName: outlineState.tagName,
					rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
					entry,
					instance,
				}),
			}
			postToParent(msg)
		} else {
			const msg: CmsElementDeselectedMessage = { type: 'cms-element-deselected' }
			postToParent(msg)
		}
	}, [outlineState])

	// Send cms-ready + cms-page-navigated when manifest loads
	const prevManifestRef = useRef<boolean>(false)
	useEffect(() => {
		const m = signals.manifest.value
		// Only fire when manifest has entries (i.e. actually loaded)
		if (Object.keys(m.entries).length === 0) return

		if (!prevManifestRef.current) {
			prevManifestRef.current = true
			postToParent(buildReadyMessage(m, window.location.pathname))
		} else {
			postToParent(buildPageNavigatedMessage(m, window.location.pathname))
		}
	})

	// Send cms-state-changed when editor state changes
	const prevStateRef = useRef<string>('')
	useEffect(() => {
		const state = buildEditorState({
			isEditing: signals.isEditing.value,
			dirtyCount: {
				text: signals.dirtyChangesCount.value,
				image: signals.dirtyImageChangesCount.value,
				color: signals.dirtyColorChangesCount.value,
				bgImage: signals.dirtyBgImageChangesCount.value,
				attribute: signals.dirtyAttributeChangesCount.value,
				seo: signals.dirtySeoChangesCount.value,
				total: signals.totalDirtyCount.value,
			},
			deploymentStatus: signals.deploymentStatus.value,
			lastDeployedAt: signals.lastDeployedAt.value,
			canUndo: canUndo.value,
			canRedo: canRedo.value,
		})

		const key = JSON.stringify(state)
		if (key === prevStateRef.current) return
		prevStateRef.current = key

		postToParent(buildStateChangedMessage(state))
	})

	const {
		blockEditorCursor,
		handleComponentSelect,
		handleBlockEditorClose,
		handleUpdateProps,
		handleInsertComponent,
		handleRemoveBlock,
	} = useBlockEditorHandlers({
		config,
		showToast: signals.showToast,
	})

	useComponentClickHandler({ onComponentSelect: handleComponentSelect })

	// Editor control handlers
	const handleEditToggle = useCallback(async () => {
		if (signals.isEditing.value) {
			hideTooltip()
			stopEditMode(updateUI)
		} else {
			signals.isSelectMode.value = false
			await startEditMode(config, updateUI)
		}
	}, [config, updateUI, hideTooltip])

	const handleCompare = useCallback(() => {
		toggleShowOriginal(config, updateUI)
	}, [config, updateUI])

	const handleSave = useCallback(async () => {
		try {
			const result = await saveAllChanges(config, updateUI)
			if (result.success) {
				signals.showToast(`Saved ${result.updated} change(s) successfully!`, 'success')
			} else if (result.errors) {
				const details = result.errors.map(e => e.error).join('; ')
				signals.showToast(`Save failed: ${details}`, 'error')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error'
			signals.showToast(`Save failed: ${message}`, 'error')
		}
	}, [config, updateUI])

	const handleDiscard = useCallback(() => {
		discardAllChanges(updateUI)
		signals.showToast('All changes discarded', 'info')
	}, [updateUI])

	const handleOpenCollection = useCallback((name: string) => {
		openCollectionsBrowser()
		selectBrowserCollection(name)
	}, [])

	const handleMediaLibrary = useCallback(() => {
		setMediaLibraryOpen(true)
	}, [])

	const handleDismissDeployment = useCallback(() => {
		dismissDeploymentStatus()
	}, [])

	const handleEditContent = useCallback(async () => {
		if (!await openMarkdownEditorForCurrentPage()) {
			signals.showToast('No collection content found on this page', 'error')
		}
	}, [])

	const handleToggleHighlights = useCallback(() => {
		toggleShowEditableHighlights()
		// Save settings to localStorage
		const newSettings = signals.settings.value
		saveSettingsToStorage(newSettings)
	}, [])

	const handleSeoEditor = useCallback(() => {
		openSeoEditor()
	}, [])

	const handleSelectElementToggle = useCallback(() => {
		signals.isSelectMode.value = !signals.isSelectMode.value
	}, [])

	// Color toolbar handlers
	const handleColorToolbarChange = useCallback(
		(
			colorType: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText',
			oldClass: string,
			newClass: string,
			previousClassName: string,
			previousStyleCssText: string,
		) => {
			const targetId = signals.colorEditorState.value.targetElementId
			if (!targetId) return

			handleColorChange(config, targetId, colorType, oldClass, newClass, updateUI, previousClassName, previousStyleCssText)
		},
		[config, updateUI],
	)

	const handleColorToolbarClose = useCallback(() => {
		signals.closeColorEditor()
	}, [])

	// Handle color swatch click from outline
	const handleOutlineColorClick = useCallback((cmsId: string, rect: DOMRect) => {
		signals.setHoveringSwatches(false)
		signals.openColorEditor(cmsId, rect)
	}, [])

	// Handle attribute button click from outline
	const handleOutlineAttributeClick = useCallback((cmsId: string, rect: DOMRect) => {
		signals.openAttributeEditor(cmsId, rect)
	}, [])

	// Handle text style change from outline (element-level styling via class toggle)
	const handleOutlineTextStyleChange = useCallback((cmsId: string, styleType: string, oldClass: string, newClass: string) => {
		let change = signals.pendingColorChanges.value.get(cmsId)

		// Create pending color change entry if it doesn't exist yet
		// (elements with allowStyling=false may lack colorClasses but still need text style tracking)
		if (!change) {
			const el = document.querySelector(`[data-cms-id="${cmsId}"]`) as HTMLElement
			if (!el) return

			const entry = signals.manifest.value.entries[cmsId]
			const originalClasses: Record<string, import('../types').Attribute> = {}
			const newClasses: Record<string, import('../types').Attribute> = {}
			if (entry?.colorClasses) {
				for (const [key, attr] of Object.entries(entry.colorClasses)) {
					originalClasses[key] = { ...attr }
					newClasses[key] = { ...attr }
				}
			}

			signals.setPendingColorChange(cmsId, {
				element: el,
				cmsId,
				originalClasses,
				newClasses,
				isDirty: false,
			})
			change = signals.pendingColorChanges.value.get(cmsId)!
		}

		// Apply the class change on the DOM element
		const el = change.element
		const previousClassName = el.className
		const previousStyleCssText = el.style.cssText

		if (oldClass) {
			el.classList.remove(oldClass)
			const oldCss = TEXT_STYLE_INLINE_CSS[oldClass]
			if (oldCss) {
				for (const prop of Object.keys(oldCss)) {
					;(el.style as any)[prop] = ''
				}
			}
		}
		el.classList.add(newClass)

		// Apply inline styles for immediate visual preview
		// (Tailwind classes not present in source won't be in the compiled CSS)
		const newCss = TEXT_STYLE_INLINE_CSS[newClass]
		if (newCss) {
			for (const [prop, value] of Object.entries(newCss)) {
				;(el.style as any)[prop] = value
			}
		}

		// Delegate to handleColorChange (same class-replacement mechanism)
		handleColorChange(config, cmsId, styleType, oldClass, newClass, updateUI, previousClassName, previousStyleCssText)
	}, [config, updateUI])

	// Handle attribute editor close
	const handleAttributeEditorClose = useCallback(() => {
		signals.closeAttributeEditor()
	}, [])

	// Get reactive values from signals
	const isEditing = signals.isEditing.value
	const isAIProcessing = signals.isAIProcessing.value
	const blockEditorState = signals.blockEditorState.value
	const colorEditorState = signals.colorEditorState.value
	const manifest = signals.manifest.value
	const toasts = signals.toasts.value
	const collectionDefinitions = manifest.collectionDefinitions ?? {}
	const showEditableHighlights = signals.showEditableHighlights.value
	const hasSeoData = !!(manifest as any).seo

	// Check if selected text element allows inline styling
	const selectedElementCmsId = textSelectionState.element?.getAttribute('data-cms-id')
	const selectedEntry = selectedElementCmsId ? manifest.entries[selectedElementCmsId] : undefined
	const isTextStylingAllowed = selectedEntry?.allowStyling !== false

	// Get color toolbar data
	const pendingColorChanges = signals.pendingColorChanges.value
	const colorEditorElement = colorEditorState.targetElementId
		? pendingColorChanges.get(colorEditorState.targetElementId)?.element ?? null
		: null
	const colorEditorCurrentClasses = colorEditorState.targetElementId
		? pendingColorChanges.get(colorEditorState.targetElementId)?.newClasses
		: undefined

	// Get current text style classes for the outlined element (reactive - triggers re-render on change)
	const outlineCmsId = outlineState.cmsId
	const outlineTextStyleClasses = outlineCmsId
		? pendingColorChanges.get(outlineCmsId)?.newClasses
		: undefined

	return (
		<>
			<ErrorBoundary componentName="Editable Highlights">
				<EditableHighlights visible={showEditableHighlights && isEditing} />
			</ErrorBoundary>

			<ErrorBoundary componentName="Outline">
				<Outline
					visible={outlineState.visible}
					rect={outlineState.rect}
					isComponent={outlineState.isComponent}
					componentName={outlineState.componentName}
					tagName={outlineState.tagName}
					element={outlineState.element}
					cmsId={outlineState.cmsId}
					textStyleClasses={outlineTextStyleClasses}
					onColorClick={handleOutlineColorClick}
					onAttributeClick={handleOutlineAttributeClick}
					onTextStyleChange={handleOutlineTextStyleChange}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="ImageOverlay">
				<ImageOverlay
					visible={imageHoverState.visible && isEditing}
					rect={imageHoverState.rect}
					element={imageHoverState.element}
					cmsId={imageHoverState.cmsId}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="BgImageOverlay">
				<BgImageOverlay
					visible={bgImageHoverState.visible && isEditing}
					rect={bgImageHoverState.rect}
					element={bgImageHoverState.element}
					cmsId={bgImageHoverState.cmsId}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Toolbar">
				<Toolbar
					callbacks={{
						onEdit: handleEditToggle,
						onCompare: handleCompare,
						onSave: handleSave,
						onDiscard: handleDiscard,
						onSelectElement: handleSelectElementToggle,
						onMediaLibrary: handleMediaLibrary,
						onDismissDeployment: handleDismissDeployment,
						onNavigateChange: () => {
							signals.navigateToNextChange()
						},
						onEditContent: handleEditContent,
						onToggleHighlights: handleToggleHighlights,
						onSeoEditor: hasSeoData ? handleSeoEditor : undefined,
						onOpenCollection: handleOpenCollection,
						onOpenCollections: openCollectionsBrowser,
					}}
					collectionDefinitions={Object.keys(collectionDefinitions).length > 0 ? collectionDefinitions : undefined}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Text Style Toolbar">
				<TextStyleToolbar
					visible={textSelectionState.hasSelection && isEditing && !isAIProcessing && isTextStylingAllowed}
					rect={textSelectionState.rect}
					element={textSelectionState.element}
					onStyleChange={updateUI}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Color Toolbar">
				<ColorToolbar
					visible={colorEditorState.isOpen && isEditing}
					rect={colorEditorState.targetRect}
					element={colorEditorElement}
					availableColors={manifest.availableColors}
					currentClasses={colorEditorCurrentClasses}
					onColorChange={handleColorToolbarChange}
					onClose={handleColorToolbarClose}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Attribute Editor">
				<AttributeEditor
					onClose={handleAttributeEditorClose}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Block Editor">
				<BlockEditor
					visible={blockEditorState.isOpen && isEditing}
					componentId={blockEditorState.currentComponentId}
					cursor={blockEditorCursor}
					onClose={handleBlockEditorClose}
					onUpdateProps={handleUpdateProps}
					onInsertComponent={handleInsertComponent}
					onRemoveBlock={handleRemoveBlock}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="SEO Editor">
				<SeoEditor />
			</ErrorBoundary>

			<ErrorBoundary componentName="Collections Browser">
				<CollectionsBrowser />
			</ErrorBoundary>

			<ErrorBoundary componentName="Create Page Modal">
				<CreatePageModal />
			</ErrorBoundary>

			<ErrorBoundary componentName="Markdown Editor">
				<MarkdownEditorOverlay />
			</ErrorBoundary>

			<ErrorBoundary componentName="Media Library">
				<MediaLibrary />
			</ErrorBoundary>

			<ErrorBoundary componentName="Confirm Dialog">
				<ConfirmDialog />
			</ErrorBoundary>

			<RedirectCountdown />
			<ToastContainer toasts={toasts} onRemove={signals.removeToast} />
		</>
	)
}

class CmsEditor {
	private appRoot: HTMLElement | null = null
	private shadowRoot: ShadowRoot | null = null
	private config = getConfig()

	async init(): Promise<void> {
		signals.setConfig(this.config)

		logDebug(this.config.debug, 'Initializing CMS editor with config:', this.config)

		this.setupUI()
		this.setupKeyboardShortcuts()
	}

	private setupUI(): void {
		const hostElement = document.createElement('div')
		hostElement.id = 'cms-app-host'
		hostElement.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;'
		document.body.appendChild(hostElement)

		// Create shadow DOM with closed mode for better isolation
		this.shadowRoot = hostElement.attachShadow({ mode: 'open' })

		// Inject theme CSS variables BEFORE main styles
		this.injectThemeStyles()

		// Inject Tailwind CSS styles into shadow DOM
		const styleElement = document.createElement('style')
		styleElement.textContent = CMS_STYLES
		this.shadowRoot.appendChild(styleElement)

		// Create the app root container
		this.appRoot = document.createElement('div')
		this.appRoot.id = 'cms-app-root'
		this.appRoot.className = 'cms-root'
		this.shadowRoot.appendChild(this.appRoot)

		// Render Preact app into the shadow DOM
		render(<CmsUI />, this.appRoot)
	}

	private injectThemeStyles(): void {
		if (!this.shadowRoot) return

		const theme = resolveTheme(this.config)
		const cssVars = generateCSSVariables(theme)

		const styleEl = document.createElement('style')
		styleEl.id = 'cms-theme-vars'
		styleEl.textContent = `:host { ${cssVars} }`
		this.shadowRoot.insertBefore(styleEl, this.shadowRoot.firstChild)
	}

	private setupKeyboardShortcuts(): void {
		document.addEventListener('keydown', (ev) => {
			// Cmd+Shift+E: Toggle CMS visibility
			const combo = (ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'e'
			if (combo) {
				ev.preventDefault()
				this.toggleVisibility()
				return
			}

			// Undo/Redo only when editing
			if (!signals.isEditing.value) return
			if (!(ev.metaKey || ev.ctrlKey)) return

			const key = ev.key.toLowerCase()

			// Cmd+Shift+Z: Redo
			if (key === 'z' && ev.shiftKey) {
				ev.preventDefault()
				performRedo()
				return
			}

			// Cmd+Z: Undo
			if (key === 'z' && !ev.shiftKey) {
				ev.preventDefault()
				performUndo()
				return
			}
		})
	}

	private toggleVisibility(): void {
		if (!this.appRoot) return

		const isHidden = this.appRoot.style.display === 'none'
		this.appRoot.style.display = isHidden ? 'block' : 'none'

		// Use signals.showToast for consistency
		signals.showToast(isHidden ? 'CMS editing enabled' : 'CMS editing disabled', 'info')
	}
}

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
	const initEditor = () => {
		const editor = new CmsEditor()
		editor.init()
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initEditor)
	} else {
		initEditor()
	}
}

export { CmsEditor }
