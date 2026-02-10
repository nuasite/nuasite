import { type Editor, editorViewCtx } from '@milkdown/core'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { updateMarkdownPage } from '../api'
import { STORAGE_KEYS } from '../constants'
import { startDeploymentPolling } from '../editor'
import { createMarkdownPage } from '../markdown-api'
import {
	config,
	currentMarkdownPage,
	isMarkdownPreview,
	markdownEditorState,
	resetMarkdownEditorState,
	showToast,
	startRedirectCountdown,
	updateMarkdownFrontmatter,
} from '../signals'
import { CreateModeFrontmatter, EditModeFrontmatter, slugify } from './frontmatter-fields'
import { MarkdownInlineEditor } from './markdown-inline-editor'

/**
 * Wrapper component that renders the editor in place of markdown content.
 * Supports both "edit" mode (existing page) and "create" mode (new page).
 */
export function MarkdownEditorOverlay() {
	const page = currentMarkdownPage.value
	const editorState = markdownEditorState.value
	const isCreateMode = editorState.mode === 'create'
	const createOptions = editorState.createOptions
	const collectionDef = editorState.collectionDefinition

	const [isSaving, setIsSaving] = useState(false)
	const [showFrontmatter, setShowFrontmatter] = useState(isCreateMode)
	// Track whether the user has manually edited the slug (disables auto-slug from title)
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
	// Preview mode state
	const [isPreview, setIsPreview] = useState(false)
	const originalHTMLRef = useRef<string | null>(null)
	const editorInstanceRef = useRef<Editor | null>(null)

	// Open metadata by default when entering create mode
	useEffect(() => {
		if (isCreateMode) {
			setShowFrontmatter(true)
		}
	}, [isCreateMode])

	const handleDeploymentComplete = useCallback(
		(status: 'completed' | 'failed' | 'timeout') => {
			if (status === 'failed') {
				showToast('Deployment failed', 'error')
			}
		},
		[],
	)

	const restoreOriginalHTML = useCallback(() => {
		const activeId = markdownEditorState.value.activeElementId
		if (originalHTMLRef.current !== null && activeId) {
			const el = document.querySelector(`[data-cms-id="${activeId}"]`)
			if (el) {
				el.innerHTML = originalHTMLRef.current
			}
			originalHTMLRef.current = null
		}
	}, [])

	const handleSave = useCallback(
		async (content: string) => {
			if (isSaving) return
			const currentPage = currentMarkdownPage.value
			if (!currentPage) return

			setIsSaving(true)
			try {
				const result = await updateMarkdownPage(config.value.apiBase, {
					filePath: currentPage.filePath,
					content,
					frontmatter: currentPage.frontmatter,
				})

				if (result.success) {
					// Keep the preview HTML in place so user sees changes immediately
					// If not in preview mode, inject editor HTML into the page element
					const activeId = markdownEditorState.value.activeElementId
					if (activeId && editorInstanceRef.current && !isPreview) {
						const el = document.querySelector(
							`[data-cms-id="${activeId}"]`,
						)
						if (el) {
							try {
								const view = editorInstanceRef.current.ctx.get(editorViewCtx)
								el.innerHTML = view.dom.innerHTML
							} catch {
								// If we can't get editor HTML, leave the page as-is
							}
						}
					}
					// Clear the original ref without restoring — we want to keep the new content visible
					originalHTMLRef.current = null
					setIsPreview(false)
					isMarkdownPreview.value = false
					setIsSaving(false)

					showToast('Content saved, deploying...', 'success')
					// Clear pending entry navigation so editor doesn't auto-open after save
					sessionStorage.removeItem(STORAGE_KEYS.PENDING_ENTRY_NAVIGATION)
					// Close the editor immediately — the toolbar will show deploying state
					resetMarkdownEditorState()
					startDeploymentPolling(config.value, {
						onComplete: handleDeploymentComplete,
					})
				} else {
					showToast(result.error || 'Failed to save markdown', 'error')
					setIsSaving(false)
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error'
				showToast(`Save failed: ${message}`, 'error')
				setIsSaving(false)
			}
		},
		[isSaving, isPreview, handleDeploymentComplete],
	)

	const handleCreate = useCallback(async () => {
		if (isSaving) return
		const currentPage = currentMarkdownPage.value
		const opts = markdownEditorState.value.createOptions
		if (!currentPage || !opts) return

		const title = (currentPage.frontmatter.title as string) || ''
		if (!title.trim()) {
			showToast('Please enter a title', 'error')
			return
		}

		const slug = currentPage.slug || slugify(title)
		if (!slug) {
			showToast('Please enter a slug', 'error')
			return
		}

		setIsSaving(true)
		try {
			// Build frontmatter excluding title and slug
			const frontmatter: Record<string, unknown> = {}
			for (const [key, value] of Object.entries(currentPage.frontmatter)) {
				if (key !== 'title' && value !== undefined && value !== '') {
					frontmatter[key] = value
				}
			}

			const result = await createMarkdownPage(config.value, {
				collection: opts.collectionName,
				title: title.trim(),
				slug,
				frontmatter,
				content: currentPage.content || '',
			})

			if (result.success) {
				// Derive the new page URL from existing collection entry pathnames
				const entries = opts.collectionDefinition.entries ?? []
				const existingEntry = entries.find((e) => e.pathname)
				let redirectUrl: string | undefined
				if (existingEntry?.pathname) {
					// Extract base path from an existing entry pathname (e.g., "/blog/first-post" → "/blog/")
					const lastSlash = existingEntry.pathname.lastIndexOf('/')
					if (lastSlash >= 0) {
						redirectUrl = existingEntry.pathname.slice(0, lastSlash + 1) + slug
					}
				}

				showToast('Page created, deploying...', 'success')
				resetMarkdownEditorState()
				startDeploymentPolling(config.value, {
					onComplete: (status) => {
						handleDeploymentComplete(status)
						if (status === 'completed' && redirectUrl) {
							startRedirectCountdown(redirectUrl, title.trim())
						}
					},
				})
			} else {
				showToast(result.error || 'Failed to create page', 'error')
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error'
			showToast(`Create failed: ${message}`, 'error')
		} finally {
			setIsSaving(false)
		}
	}, [isSaving, handleDeploymentComplete])

	const handlePreview = useCallback(() => {
		const activeId = markdownEditorState.value.activeElementId
		if (!editorInstanceRef.current || !activeId) return

		if (!isPreview) {
			// Enter preview
			const el = document.querySelector(`[data-cms-id="${activeId}"]`)
			if (!el) {
				showToast('Could not find page element to preview', 'error')
				return
			}
			originalHTMLRef.current = el.innerHTML
			try {
				const view = editorInstanceRef.current.ctx.get(editorViewCtx)
				el.innerHTML = view.dom.innerHTML
			} catch (error) {
				console.error('Failed to get editor HTML for preview:', error)
				originalHTMLRef.current = null
				showToast('Failed to generate preview', 'error')
				return
			}
			setIsPreview(true)
			isMarkdownPreview.value = true
		} else {
			// Exit preview
			restoreOriginalHTML()
			setIsPreview(false)
			isMarkdownPreview.value = false
		}
	}, [isPreview, restoreOriginalHTML])

	const handleCancel = useCallback(() => {
		restoreOriginalHTML()
		isMarkdownPreview.value = false
		resetMarkdownEditorState()
	}, [restoreOriginalHTML])

	if (!page) return null

	const stopPropagation = (e: Event) => e.stopPropagation()
	const collectionLabel = createOptions?.collectionDefinition.label ?? 'Page'

	if (isPreview) {
		return (
			<div
				class="fixed bottom-6 left-1/2 -translate-x-1/2 z-2147483647 flex items-center gap-3 px-5 py-3 bg-cms-dark/95 border border-white/15 rounded-cms-pill shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md"
				data-cms-ui
				onMouseDown={stopPropagation}
				onClick={stopPropagation}
			>
				<div class="flex items-center gap-2 text-white/70">
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
						/>
					</svg>
					<span class="text-sm font-medium">Previewing</span>
				</div>
				<div class="w-px h-5 bg-white/20" />
				<button
					type="button"
					onClick={handlePreview}
					class="px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-cms-pill transition-colors"
					data-cms-ui
				>
					Back to Editor
				</button>
				<button
					type="button"
					onClick={() => {
						const currentContent = currentMarkdownPage.value?.content
						if (currentContent !== undefined) {
							handleSave(currentContent)
						}
					}}
					disabled={isSaving}
					class="px-3 py-1.5 text-sm bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover rounded-cms-pill transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
					data-cms-ui
				>
					{isSaving && <div class="animate-spin rounded-full h-3 w-3 border-2 border-cms-primary-text/30 border-t-cms-primary-text" />}
					{isSaving ? 'Saving...' : 'Save'}
				</button>
			</div>
		)
	}

	return (
		<div
			class="fixed inset-0 z-2147483647 bg-black/40 flex items-center justify-center p-4 backdrop-blur-md"
			data-cms-ui
			onMouseDown={stopPropagation}
			onClick={stopPropagation}
		>
			<div
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 w-full max-w-4xl max-h-[90vh] flex flex-col"
				data-cms-ui
			>
				{/* Header */}
				<div class="flex items-center justify-between px-5 py-4 border-b border-white/10">
					<div class="flex items-center gap-3">
						<div class="flex items-center text-white">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
								<polyline points="14 2 14 8 20 8" />
								<line x1="16" y1="13" x2="8" y2="13" />
								<line x1="16" y1="17" x2="8" y2="17" />
								<line x1="10" y1="9" x2="8" y2="9" />
							</svg>
						</div>
						<div>
							<input
								type="text"
								value={(page.frontmatter.title as string) || ''}
								placeholder="Page title..."
								onInput={(e) => {
									const title = (e.target as HTMLInputElement).value
									updateMarkdownFrontmatter({ title })
									// Auto-generate slug in create mode if not manually edited
									if (isCreateMode && !slugManuallyEdited) {
										markdownEditorState.value = {
											...markdownEditorState.value,
											currentPage: markdownEditorState.value.currentPage
												? {
													...markdownEditorState.value.currentPage,
													slug: slugify(title),
													isDirty: true,
												}
												: null,
										}
									}
								}}
								class="text-base font-semibold text-white m-0 bg-transparent border-none outline-none placeholder-white/40 w-64"
								data-cms-ui
							/>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setShowFrontmatter(!showFrontmatter)}
							class={`px-3 py-2 text-sm rounded-cms-pill transition-colors flex items-center gap-1.5 ${
								showFrontmatter
									? 'bg-white/20 text-white'
									: 'text-white/70 hover:text-white hover:bg-white/10'
							}`}
							data-cms-ui
						>
							<svg
								class="w-4 h-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
							Metadata
							<svg
								class={`w-3.5 h-3.5 transition-transform ${showFrontmatter ? 'rotate-180' : ''}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 9l-7 7-7-7"
								/>
							</svg>
						</button>
						{!isCreateMode && editorState.activeElementId && (
							<button
								type="button"
								onClick={handlePreview}
								class={`px-3 py-2 text-sm rounded-cms-pill transition-colors flex items-center gap-1.5 ${
									isPreview
										? 'bg-white/20 text-white'
										: 'text-white/70 hover:text-white hover:bg-white/10'
								}`}
								data-cms-ui
							>
								<svg
									class="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
								Preview
							</button>
						)}
						<button
							type="button"
							onClick={handleCancel}
							class="px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-cms-pill transition-colors"
							data-cms-ui
						>
							Cancel
						</button>
						{isCreateMode
							? (
								<button
									type="button"
									onClick={handleCreate}
									disabled={isSaving || !(page.frontmatter.title as string)?.trim()}
									class="px-4 py-2 text-sm bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover rounded-cms-pill transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
									data-cms-ui
								>
									{isSaving && <div class="animate-spin rounded-full h-3.5 w-3.5 border-2 border-cms-primary-text/30 border-t-cms-primary-text" />}
									{isSaving ? 'Creating...' : `Create ${collectionLabel}`}
								</button>
							)
							: (
								<button
									type="button"
									onClick={() => {
										const currentContent = currentMarkdownPage.value?.content
										if (currentContent !== undefined) {
											handleSave(currentContent)
										}
									}}
									disabled={isSaving}
									class="px-4 py-2 text-sm bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover rounded-cms-pill transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
									data-cms-ui
								>
									{isSaving && <div class="animate-spin rounded-full h-3.5 w-3.5 border-2 border-cms-primary-text/30 border-t-cms-primary-text" />}
									{isSaving ? 'Saving...' : 'Save'}
								</button>
							)}
					</div>
				</div>

				{/* Frontmatter Editor */}
				{showFrontmatter && (
					<div class="px-5 py-4 border-b border-white/10 bg-white/5">
						{isCreateMode && createOptions
							? (
								<CreateModeFrontmatter
									page={page}
									collectionDefinition={createOptions.collectionDefinition}
									onSlugManualEdit={() => setSlugManuallyEdited(true)}
								/>
							)
							: (
								<EditModeFrontmatter
									page={page}
									collectionDefinition={collectionDef}
								/>
							)}
					</div>
				)}

				{/* Editor */}
				<div class="flex-1 min-h-0 overflow-auto bg-black/20">
					<MarkdownInlineEditor
						elementId={page.slug || 'new-page'}
						initialContent={page.content}
						onSave={isCreateMode ? () => handleCreate() : handleSave}
						onCancel={handleCancel}
						onEditorReady={(editor) => {
							editorInstanceRef.current = editor
						}}
					/>
				</div>
			</div>
		</div>
	)
}
