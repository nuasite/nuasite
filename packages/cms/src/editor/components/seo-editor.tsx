import { useCallback, useState } from 'preact/hooks'
import { saveBatchChanges } from '../api'
import { isApplyingUndoRedo, recordChange } from '../history'
import {
	clearPendingSeoChanges,
	closeSeoEditor,
	config,
	dirtySeoChangesCount,
	getPendingSeoChange,
	isSeoEditorOpen,
	manifest,
	openMediaLibraryWithCallback,
	pendingSeoChanges,
	setPendingSeoChange,
	showToast,
} from '../signals'
import type { ChangePayload, PageSeoData, PendingSeoChange } from '../types'
import { ColorField, ComboBoxField, ImageField } from './fields'

const OG_TYPE_OPTIONS = [
	{ value: 'website', label: 'Website', description: 'Default type for most pages' },
	{ value: 'article', label: 'Article', description: 'Blog posts, news articles' },
	{ value: 'profile', label: 'Profile', description: 'User or author profile page' },
	{ value: 'video.movie', label: 'Video (Movie)', description: 'Movie or film' },
	{ value: 'video.episode', label: 'Video (Episode)', description: 'TV show episode' },
	{ value: 'video.other', label: 'Video (Other)', description: 'Other video content' },
	{ value: 'music.song', label: 'Music (Song)', description: 'Individual song' },
	{ value: 'music.album', label: 'Music (Album)', description: 'Music album' },
	{ value: 'book', label: 'Book', description: 'Book or publication' },
	{ value: 'product', label: 'Product', description: 'Product page' },
]

const TWITTER_CARD_OPTIONS = [
	{ value: 'summary', label: 'Summary', description: 'Small square image with title and description' },
	{ value: 'summary_large_image', label: 'Summary Large Image', description: 'Large banner image above title' },
	{ value: 'app', label: 'App', description: 'Mobile app download card' },
	{ value: 'player', label: 'Player', description: 'Embedded media player card' },
]

const ROBOTS_OPTIONS = [
	{ value: 'index, follow', label: 'Index, Follow', description: 'Allow indexing and link following (default)' },
	{ value: 'noindex, follow', label: 'No Index, Follow', description: 'Block indexing but follow links' },
	{ value: 'index, nofollow', label: 'Index, No Follow', description: "Allow indexing but don't follow links" },
	{ value: 'noindex, nofollow', label: 'No Index, No Follow', description: 'Block indexing and link following' },
	{ value: 'noarchive', label: 'No Archive', description: 'Prevent cached copies in search results' },
	{ value: 'nosnippet', label: 'No Snippet', description: "Don't show text snippets in results" },
	{ value: 'max-image-preview:large', label: 'Max Image Preview: Large', description: 'Allow large image previews' },
]

interface SeoFieldProps {
	label: string
	id: string | undefined
	value: string | undefined
	placeholder?: string
	multiline?: boolean
	onChange: (id: string, value: string, originalValue: string) => void
}

function SeoField({ label, id, value, placeholder, multiline, onChange }: SeoFieldProps) {
	const pendingChange = id ? getPendingSeoChange(id) : undefined
	const currentValue = pendingChange?.newValue ?? value ?? ''
	const isDirty = pendingChange?.isDirty ?? false

	const handleChange = useCallback((e: Event) => {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement
		if (id) {
			onChange(id, target.value, value ?? '')
		}
	}, [id, value, onChange])

	const InputComponent = multiline ? 'textarea' : 'input'

	return (
		<div class="space-y-1.5">
			<div class="flex items-center justify-between">
				<label class="text-sm font-medium text-white/80">{label}</label>
				{isDirty && <span class="text-xs text-cms-primary font-medium">Modified</span>}
			</div>
			<InputComponent
				type={multiline ? undefined : 'text'}
				value={currentValue}
				placeholder={placeholder ?? `Enter ${label.toLowerCase()}...`}
				onInput={handleChange}
				disabled={!id}
				class={`w-full px-4 py-2.5 bg-white/10 border rounded-cms-md text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors ${
					isDirty
						? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10'
				} ${!id ? 'opacity-50 cursor-not-allowed' : ''} ${multiline ? 'min-h-20 resize-y' : ''}`}
				data-cms-ui
			/>
		</div>
	)
}

/** Helper to resolve pending value/dirty state for a SEO meta tag */
function useSeoMeta(tag: { id?: string; content: string } | undefined) {
	if (!tag) return { id: undefined, original: '', current: '', dirty: false }
	const pending = tag.id ? getPendingSeoChange(tag.id) : undefined
	return {
		id: tag.id,
		original: tag.content,
		current: pending?.newValue ?? tag.content ?? '',
		dirty: pending?.isDirty ?? false,
	}
}

interface SeoSectionProps {
	title: string
	children: preact.ComponentChildren
}

function SeoSection({ title, children }: SeoSectionProps) {
	return (
		<div class="space-y-4">
			<h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider">{title}</h3>
			<div class="space-y-4">
				{children}
			</div>
		</div>
	)
}

export function SeoEditor() {
	const visible = isSeoEditorOpen.value
	const seoData = (manifest.value as any).seo as PageSeoData | undefined

	const handleClose = useCallback(() => {
		closeSeoEditor()
	}, [])

	const handleFieldChange = useCallback((
		id: string,
		newValue: string,
		originalValue: string,
	) => {
		// Record undo action before updating signal
		if (!isApplyingUndoRedo) {
			const existing = getPendingSeoChange(id)
			recordChange({
				type: 'seo',
				cmsId: id,
				previousValue: existing?.newValue ?? originalValue,
				currentValue: newValue,
				originalValue,
				wasDirty: existing?.isDirty ?? false,
			})
		}

		const isDirty = newValue !== originalValue
		const change: PendingSeoChange = {
			id,
			originalValue,
			newValue,
			isDirty,
		}
		setPendingSeoChange(id, change)
	}, [])

	// Count dirty changes for this editor
	const dirtyCount = dirtySeoChangesCount.value

	const [isSaving, setIsSaving] = useState(false)

	// Helper to find SEO element by id and get its source info
	const findSeoElementById = useCallback((id: string): { sourcePath: string; sourceLine: number; sourceSnippet: string; content: string } | null => {
		if (!seoData) return null

		// Search through all SEO fields
		const fields = [
			seoData.title,
			seoData.description,
			seoData.keywords,
			seoData.canonical,
			seoData.themeColor,
			seoData.robots,
			...(seoData.openGraph ? Object.values(seoData.openGraph) : []),
			...(seoData.twitterCard ? Object.values(seoData.twitterCard) : []),
			...(seoData.favicons || []),
		]

		for (const field of fields) {
			if (field && (field as any).id === id) {
				return {
					sourcePath: field.sourcePath ?? '',
					sourceLine: field.sourceLine ?? 0,
					sourceSnippet: field.sourceSnippet ?? '',
					content: (field as any).content ?? (field as any).href ?? '',
				}
			}
		}
		return null
	}, [seoData])

	const handleSaveAll = useCallback(async () => {
		const dirtyChanges = Array.from(pendingSeoChanges.value.values()).filter(c => c.isDirty)
		if (dirtyChanges.length === 0) return

		setIsSaving(true)
		try {
			const changes: ChangePayload[] = dirtyChanges.map(change => {
				const sourceInfo = findSeoElementById(change.id)
				return {
					cmsId: change.id,
					newValue: change.newValue,
					originalValue: sourceInfo?.content ?? change.originalValue,
					sourcePath: sourceInfo?.sourcePath ?? '',
					sourceLine: sourceInfo?.sourceLine ?? 0,
					sourceSnippet: sourceInfo?.sourceSnippet ?? '',
				}
			})

			const result = await saveBatchChanges(config.value.apiBase, {
				changes,
				meta: {
					source: 'seo-editor',
					url: window.location.href,
				},
			})

			if (result.errors && result.errors.length > 0) {
				const details = result.errors.map(e => e.error).join('; ')
				showToast(`SEO save failed: ${details}`, 'error')
			} else {
				showToast(`Saved ${result.updated} SEO change(s) successfully!`, 'success')
				clearPendingSeoChanges()
				closeSeoEditor()
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to save SEO changes', 'error')
		} finally {
			setIsSaving(false)
		}
	}, [findSeoElementById])

	if (!visible) return null

	const hasSeoData = seoData && (
		seoData.title
		|| seoData.description
		|| seoData.keywords
		|| seoData.canonical
		|| seoData.themeColor
		|| seoData.robots
		|| seoData.openGraph
		|| seoData.twitterCard
		|| (seoData.favicons && seoData.favicons.length > 0)
	)

	// Resolve pending state for specialized fields
	const ogImage = useSeoMeta(seoData?.openGraph?.image)
	const ogType = useSeoMeta(seoData?.openGraph?.type)
	const twitterCard = useSeoMeta(seoData?.twitterCard?.card)
	const twitterImage = useSeoMeta(seoData?.twitterCard?.image)
	const themeColor = useSeoMeta(seoData?.themeColor)
	const robots = useSeoMeta(seoData?.robots)

	return (
		<div
			class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={handleClose}
			data-cms-ui
		>
			<div
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-2xl w-full max-h-[85vh] flex flex-col border border-white/10"
				onClick={(e) => e.stopPropagation()}
				data-cms-ui
			>
				{/* Header */}
				<div class="flex items-center justify-between p-5 border-b border-white/10">
					<div class="flex items-center gap-3">
						<h2 class="text-lg font-semibold text-white">SEO Settings</h2>
						{dirtyCount > 0 && (
							<span class="px-2 py-0.5 text-xs font-medium bg-cms-primary/20 text-cms-primary rounded-full">
								{dirtyCount} change{dirtyCount !== 1 ? 's' : ''}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={handleClose}
						class="text-white/50 hover:text-white p-1.5 hover:bg-white/10 rounded-full transition-colors"
						data-cms-ui
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Content */}
				<div class="flex-1 overflow-auto p-5">
					{!hasSeoData
						? (
							<div class="flex flex-col items-center justify-center h-48 text-white/50">
								<svg class="w-12 h-12 mb-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
									/>
								</svg>
								<p class="text-sm">No SEO data found for this page.</p>
								<p class="text-xs text-white/40 mt-1">Add title, meta tags, or Open Graph tags to your page.</p>
							</div>
						)
						: (
							<div class="space-y-8">
								{/* Basic SEO */}
								<SeoSection title="Basic SEO">
									{seoData.title && (
										<SeoField
											label="Page Title"
											id={seoData.title.id}
											value={seoData.title.content}
											placeholder="Enter page title..."
											onChange={handleFieldChange}
										/>
									)}
									{seoData.description && (
										<SeoField
											label="Meta Description"
											id={seoData.description.id}
											value={seoData.description.content}
											placeholder="Enter meta description..."
											multiline
											onChange={handleFieldChange}
										/>
									)}
									{seoData.keywords && (
										<SeoField
											label="Keywords"
											id={seoData.keywords.id}
											value={seoData.keywords.content}
											placeholder="keyword1, keyword2, keyword3..."
											onChange={handleFieldChange}
										/>
									)}
									{seoData.canonical && (
										<SeoField
											label="Canonical URL"
											id={seoData.canonical.id}
											value={seoData.canonical.href}
											placeholder="https://example.com/page"
											onChange={handleFieldChange}
										/>
									)}
									{seoData.robots && (
										<ComboBoxField
											label="Robots"
											value={robots.current}
											placeholder="index, follow"
											options={ROBOTS_OPTIONS}
											onChange={(v) => { if (robots.id) handleFieldChange(robots.id, v, robots.original) }}
											isDirty={robots.dirty}
										/>
									)}
									{seoData.themeColor && (
										<ColorField
											label="Theme Color"
											value={themeColor.current}
											placeholder="#000000"
											onChange={(v) => { if (themeColor.id) handleFieldChange(themeColor.id, v, themeColor.original) }}
											isDirty={themeColor.dirty}
										/>
									)}
								</SeoSection>

								{/* Favicons */}
								{seoData.favicons && seoData.favicons.length > 0 && (
									<SeoSection title="Favicons">
										{seoData.favicons.map((favicon, index) => {
											const faviconId = favicon.id
											const originalValue = favicon.href
											const pendingChange = faviconId ? getPendingSeoChange(faviconId) : undefined
											const currentValue = pendingChange?.newValue ?? originalValue ?? ''
											const isDirty = pendingChange?.isDirty ?? false

											const label = favicon.sizes
												? `Favicon (${favicon.sizes})`
												: favicon.type
												? `Favicon (${favicon.type.replace('image/', '')})`
												: `Favicon${seoData.favicons!.length > 1 ? ` ${index + 1}` : ''}`

											return (
												<div key={faviconId || index} class="space-y-1.5">
													<ImageField
														label={label}
														value={currentValue}
														placeholder="/favicon.svg"
														onChange={(v) => {
															if (faviconId) handleFieldChange(faviconId, v, originalValue)
														}}
														onBrowse={() => {
															openMediaLibraryWithCallback((url: string) => {
																if (faviconId) handleFieldChange(faviconId, url, originalValue)
															})
														}}
														isDirty={isDirty}
													/>
												</div>
											)
										})}
									</SeoSection>
								)}

								{/* Open Graph */}
								{seoData.openGraph && Object.keys(seoData.openGraph).length > 0 && (
									<SeoSection title="Open Graph">
										{seoData.openGraph.title && (
											<SeoField
												label="OG Title"
												id={seoData.openGraph.title.id}
												value={seoData.openGraph.title.content}
												placeholder="Enter Open Graph title..."
												onChange={handleFieldChange}
											/>
										)}
										{seoData.openGraph.description && (
											<SeoField
												label="OG Description"
												id={seoData.openGraph.description.id}
												value={seoData.openGraph.description.content}
												placeholder="Enter Open Graph description..."
												multiline
												onChange={handleFieldChange}
											/>
										)}
										{seoData.openGraph.image && (
											<ImageField
												label="OG Image"
												value={ogImage.current}
												placeholder="/images/og-image.jpg"
												onChange={(v) => { if (ogImage.id) handleFieldChange(ogImage.id, v, ogImage.original) }}
												onBrowse={() => {
													openMediaLibraryWithCallback((url: string) => {
														if (ogImage.id) handleFieldChange(ogImage.id, url, ogImage.original)
													})
												}}
												isDirty={ogImage.dirty}
											/>
										)}
										{seoData.openGraph.url && (
											<SeoField
												label="OG URL"
												id={seoData.openGraph.url.id}
												value={seoData.openGraph.url.content}
												placeholder="https://example.com/page"
												onChange={handleFieldChange}
											/>
										)}
										{seoData.openGraph.type && (
											<ComboBoxField
												label="OG Type"
												value={ogType.current}
												placeholder="website"
												options={OG_TYPE_OPTIONS}
												onChange={(v) => { if (ogType.id) handleFieldChange(ogType.id, v, ogType.original) }}
												isDirty={ogType.dirty}
											/>
										)}
										{seoData.openGraph.siteName && (
											<SeoField
												label="OG Site Name"
												id={seoData.openGraph.siteName.id}
												value={seoData.openGraph.siteName.content}
												placeholder="My Website"
												onChange={handleFieldChange}
											/>
										)}
									</SeoSection>
								)}

								{/* Twitter Card */}
								{seoData.twitterCard && Object.keys(seoData.twitterCard).length > 0 && (
									<SeoSection title="Twitter Card">
										{seoData.twitterCard.card && (
											<ComboBoxField
												label="Card Type"
												value={twitterCard.current}
												placeholder="summary_large_image"
												options={TWITTER_CARD_OPTIONS}
												onChange={(v) => { if (twitterCard.id) handleFieldChange(twitterCard.id, v, twitterCard.original) }}
												isDirty={twitterCard.dirty}
											/>
										)}
										{seoData.twitterCard.title && (
											<SeoField
												label="Twitter Title"
												id={seoData.twitterCard.title.id}
												value={seoData.twitterCard.title.content}
												placeholder="Enter Twitter title..."
												onChange={handleFieldChange}
											/>
										)}
										{seoData.twitterCard.description && (
											<SeoField
												label="Twitter Description"
												id={seoData.twitterCard.description.id}
												value={seoData.twitterCard.description.content}
												placeholder="Enter Twitter description..."
												multiline
												onChange={handleFieldChange}
											/>
										)}
										{seoData.twitterCard.image && (
											<ImageField
												label="Twitter Image"
												value={twitterImage.current}
												placeholder="/images/twitter-image.jpg"
												onChange={(v) => { if (twitterImage.id) handleFieldChange(twitterImage.id, v, twitterImage.original) }}
												onBrowse={() => {
													openMediaLibraryWithCallback((url: string) => {
														if (twitterImage.id) handleFieldChange(twitterImage.id, url, twitterImage.original)
													})
												}}
												isDirty={twitterImage.dirty}
											/>
										)}
										{seoData.twitterCard.site && (
											<SeoField
												label="Twitter Site"
												id={seoData.twitterCard.site.id}
												value={seoData.twitterCard.site.content}
												placeholder="@username"
												onChange={handleFieldChange}
											/>
										)}
									</SeoSection>
								)}

								{/* JSON-LD Preview */}
								{seoData.jsonLd && seoData.jsonLd.length > 0 && (
									<SeoSection title="Structured Data (JSON-LD)">
										<div class="space-y-3">
											{seoData.jsonLd.map((entry, index) => (
												<div key={index} class="p-3 bg-white/5 rounded-cms-md border border-white/10">
													<div class="flex items-center justify-between mb-2">
														<span class="text-sm font-medium text-white/80">@type: {entry.type}</span>
													</div>
													<pre class="text-xs text-white/60 overflow-auto max-h-32 p-2 bg-black/30 rounded">
													{JSON.stringify(entry.data, null, 2)}
													</pre>
												</div>
											))}
										</div>
									</SeoSection>
								)}
							</div>
						)}
				</div>

				{/* Footer */}
				{hasSeoData && (
					<div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/10">
						<button
							type="button"
							onClick={handleClose}
							class="px-4 py-2 text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 rounded-cms-pill transition-colors"
							data-cms-ui
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleSaveAll}
							disabled={dirtyCount === 0 || isSaving}
							class={`px-5 py-2 text-sm font-medium rounded-cms-pill transition-colors flex items-center gap-2 ${
								dirtyCount > 0 && !isSaving
									? 'bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover'
									: 'bg-white/10 text-white/40 cursor-not-allowed'
							}`}
							data-cms-ui
						>
							{isSaving && <span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
							{isSaving ? 'Saving...' : 'Save Changes'}
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
