import { render } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { fetchManifest } from './api'
import { AIChat } from './components/ai-chat'
import { AITooltip } from './components/ai-tooltip'
import { AttributeEditor } from './components/attribute-editor'
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
import { performRedo, performUndo } from './history'
import {
	useAIHandlers,
	useBlockEditorHandlers,
	useComponentClickHandler,
	useElementDetection,
	useImageHoverDetection,
	useTextSelection,
	useTooltipState,
} from './hooks'
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

const CmsUI = () => {
	const config = signals.config.value
	const outlineState = useElementDetection()
	const imageHoverState = useImageHoverDetection()
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

	const {
		handleAIChatToggle,
		handleChatClose,
		handleChatCancel,
		handleTooltipPromptSubmit,
		handleChatSend,
		handleApplyToElement,
	} = useAIHandlers({
		config,
		showToast: signals.showToast,
		onTooltipHide: hideTooltip,
		onUIUpdate: updateUI,
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
				signals.showToast(`Saved ${result.updated}, ${result.errors.length} failed`, 'error')
			}
		} catch (err) {
			signals.showToast('Save failed – see console', 'error')
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

	// Handle attribute editor close
	const handleAttributeEditorClose = useCallback(() => {
		signals.closeAttributeEditor()
	}, [])

	// Get reactive values from signals
	const isEditing = signals.isEditing.value
	const isAIProcessing = signals.isAIProcessing.value
	const isChatOpen = signals.isChatOpen.value
	const blockEditorState = signals.blockEditorState.value
	const colorEditorState = signals.colorEditorState.value
	const manifest = signals.manifest.value
	const toasts = signals.toasts.value
	const collectionDefinitions = manifest.collectionDefinitions ?? {}
	const showEditableHighlights = signals.showEditableHighlights.value
	const hasSeoData = !!(manifest as any).seo

	// Get color toolbar data
	const colorEditorElement = colorEditorState.targetElementId
		? signals.pendingColorChanges.value.get(colorEditorState.targetElementId)?.element ?? null
		: null
	const colorEditorCurrentClasses = colorEditorState.targetElementId
		? signals.pendingColorChanges.value.get(colorEditorState.targetElementId)?.newClasses
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
					onColorClick={handleOutlineColorClick}
					onAttributeClick={handleOutlineAttributeClick}
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

			<ErrorBoundary componentName="Toolbar">
				<Toolbar
					callbacks={{
						onEdit: handleEditToggle,
						onCompare: handleCompare,
						onSave: handleSave,
						onDiscard: handleDiscard,
						onAIChat: handleAIChatToggle,
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

			<ErrorBoundary componentName="AI Tooltip">
				<AITooltip
					callbacks={{
						onPromptSubmit: handleTooltipPromptSubmit,
					}}
					visible={!!tooltipState.elementId && isEditing && !isAIProcessing && !textSelectionState.hasSelection}
					elementId={tooltipState.elementId}
					rect={tooltipState.rect}
					processing={isAIProcessing}
				/>
			</ErrorBoundary>

			<ErrorBoundary componentName="Text Style Toolbar">
				<TextStyleToolbar
					visible={textSelectionState.hasSelection && isEditing && !isAIProcessing}
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

			<ErrorBoundary componentName="AI Chat">
				<AIChat
					callbacks={{
						onSend: handleChatSend,
						onClose: handleChatClose,
						onCancel: handleChatCancel,
						onApplyToElement: handleApplyToElement,
					}}
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
