import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { slugify } from '../../shared'
import { checkSlugExists, createPage, duplicatePage, getLayouts } from '../markdown-api'
import {
	config,
	createPageMode,
	isCreatePageOpen,
	manifest,
	openMarkdownEditorForNewPage,
	resetCreatePageState,
	setCreatePageMode,
	setCreatingPage,
	showToast,
} from '../signals'
import type { LayoutInfo } from '../types'
import { CancelButton, ModalBackdrop, ModalFooter, ModalHeader } from './modal-shell'

export function CreatePageModal() {
	const visible = isCreatePageOpen.value
	const mode = createPageMode.value

	if (!visible) return null

	return (
		<ModalBackdrop onClose={() => resetCreatePageState()}>
			{mode === 'pick' && <ModePicker />}
			{mode === 'new' && <NewPageForm />}
			{mode === 'duplicate' && <DuplicatePageForm />}
			{mode === 'collection' && <CollectionPicker />}
		</ModalBackdrop>
	)
}

function ModePicker() {
	const collectionDefinitions = manifest.value.collectionDefinitions ?? {}
	const hasCollections = Object.keys(collectionDefinitions).length > 0

	return (
		<>
			<ModalHeader title="Create New Page" onClose={() => resetCreatePageState()} />
			<div class="p-5 space-y-2">
				<ModeCard
					icon={<PageIcon />}
					title="Blank Page"
					description="Start with an empty page template"
					onClick={() => setCreatePageMode('new')}
				/>
				<ModeCard
					icon={<DuplicateIcon />}
					title="Duplicate Page"
					description="Copy an existing page to a new URL"
					onClick={() => setCreatePageMode('duplicate')}
				/>
				{hasCollections && (
					<ModeCard
						icon={<CollectionIcon />}
						title="Collection Entry"
						description="Create a new content entry"
						onClick={() => setCreatePageMode('collection')}
					/>
				)}
			</div>
		</>
	)
}

function ModeCard({ icon, title, description, onClick }: {
	icon: preact.ComponentChildren
	title: string
	description: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			class="w-full flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-cms-lg border border-white/10 hover:border-white/20 transition-colors text-left cursor-pointer"
			data-cms-ui
		>
			<div class="shrink-0 w-10 h-10 bg-cms-primary/20 rounded-cms-md flex items-center justify-center">
				{icon}
			</div>
			<div class="flex-1 min-w-0">
				<div class="text-white font-medium">{title}</div>
				<div class="text-white/50 text-sm">{description}</div>
			</div>
			<ChevronRightIcon />
		</button>
	)
}

function useSlugForm() {
	const [title, setTitle] = useState('')
	const [slug, setSlug] = useState('')
	const [slugManual, setSlugManual] = useState(false)
	const [slugError, setSlugError] = useState<string | null>(null)
	const [slugChecking, setSlugChecking] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [submitPhase, setSubmitPhase] = useState<'creating' | 'preparing' | null>(null)
	const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		return () => {
			if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current)
			abortRef.current?.abort()
		}
	}, [])

	const triggerSlugCheck = useCallback((value: string) => {
		debouncedSlugCheck(value, checkTimeoutRef, abortRef, setSlugChecking, setSlugError)
	}, [])

	const handleTitleChange = useCallback((value: string) => {
		setTitle(value)
		if (!slugManual) {
			const autoSlug = slugify(value)
			setSlug(autoSlug)
			triggerSlugCheck(autoSlug)
		}
	}, [slugManual, triggerSlugCheck])

	const handleSlugChange = useCallback((value: string) => {
		setSlugManual(true)
		setSlug(value)
		triggerSlugCheck(value)
	}, [triggerSlugCheck])

	const submitPage = useCallback(async (
		apiCall: () => Promise<{ success: boolean; url?: string; error?: string }>,
		errorLabel: string,
	) => {
		setIsSubmitting(true)
		setSubmitPhase('creating')
		setCreatingPage(true)

		const result = await apiCall()

		if (result.success && result.url) {
			setSubmitPhase('preparing')
			await waitForPageReady(result.url)
			setCreatingPage(false)
			window.location.href = result.url
		} else {
			setIsSubmitting(false)
			setSubmitPhase(null)
			setCreatingPage(false)
			showToast(result.error || errorLabel, 'error')
		}
	}, [])

	const resetSlugManual = useCallback(() => setSlugManual(false), [])

	const prefillFromTitle = useCallback((pageTitle: string) => {
		setTitle(pageTitle)
		const autoSlug = slugify(pageTitle)
		setSlug(autoSlug)
		triggerSlugCheck(autoSlug)
	}, [triggerSlugCheck])

	return {
		title,
		setTitle,
		slug,
		setSlug,
		slugManual,
		resetSlugManual,
		slugError,
		slugChecking,
		isSubmitting,
		submitPhase,
		handleTitleChange,
		handleSlugChange,
		submitPage,
		prefillFromTitle,
	}
}

function NewPageForm() {
	const form = useSlugForm()
	const [layouts, setLayouts] = useState<LayoutInfo[]>([])
	const [selectedLayout, setSelectedLayout] = useState<string | undefined>(undefined)

	useEffect(() => {
		const cfg = config.value
		if (!cfg) return
		getLayouts(cfg).then(({ layouts: l }) => {
			setLayouts(l)
			if (l.length > 0) setSelectedLayout(l[0]!.path)
		})
	}, [])

	const handleSubmit = useCallback(async () => {
		const cfg = config.value
		if (!cfg || !form.title.trim() || !form.slug.trim() || form.slugError) return
		form.submitPage(
			() => createPage(cfg, { title: form.title.trim(), slug: form.slug.trim(), layoutPath: selectedLayout }),
			'Failed to create page',
		)
	}, [form.title, form.slug, form.slugError, selectedLayout, form.submitPage])

	const canSubmit = form.title.trim() && form.slug.trim() && !form.slugError && !form.slugChecking && !form.isSubmitting

	if (form.submitPhase) {
		return <PageCreatingOverlay phase={form.submitPhase} slug={form.slug} />
	}

	return (
		<>
			<ModalHeader title="New Blank Page" onBack={() => setCreatePageMode('pick')} onClose={() => resetCreatePageState()} />
			<div class="p-5 space-y-4">
				<Field label="Title">
					<input
						type="text"
						value={form.title}
						onInput={(e) => form.handleTitleChange((e.target as HTMLInputElement).value)}
						placeholder="My New Page"
						class="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
						autoFocus
						data-cms-ui
					/>
				</Field>

				<Field label="URL Path" error={form.slugError} checking={form.slugChecking}>
					<div class="flex items-center gap-1">
						<span class="text-white/40 text-sm">/</span>
						<input
							type="text"
							value={form.slug}
							onInput={(e) => form.handleSlugChange((e.target as HTMLInputElement).value)}
							placeholder="my-new-page"
							class="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
							data-cms-ui
						/>
					</div>
				</Field>

				{layouts.length > 0 && (
					<Field label="Layout">
						<select
							value={selectedLayout}
							onChange={(e) => setSelectedLayout((e.target as HTMLSelectElement).value || undefined)}
							class="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white focus:outline-none focus:border-cms-primary/50"
							data-cms-ui
						>
							{layouts.map((l) => <option key={l.path} value={l.path}>{l.name}</option>)}
							<option value="">No layout</option>
						</select>
					</Field>
				)}
			</div>

			<ModalFooter>
				<CancelButton onClick={() => resetCreatePageState()} />
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!canSubmit}
					class="px-5 py-2.5 text-sm font-medium rounded-cms-pill transition-colors cursor-pointer bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
					data-cms-ui
				>
					Create Page
				</button>
			</ModalFooter>
		</>
	)
}

function DuplicatePageForm() {
	const pages = manifest.value.pages ?? []
	const [sourcePath, setSourcePath] = useState(pages[0]?.pathname ?? '')
	const [createRedirect, setCreateRedirect] = useState(false)
	const form = useSlugForm()

	// Pre-fill title from selected source page
	useEffect(() => {
		const page = pages.find((p) => p.pathname === sourcePath)
		if (page?.title && !form.title) {
			form.prefillFromTitle(page.title)
		}
	}, [sourcePath])

	const handleSubmit = useCallback(async () => {
		const cfg = config.value
		if (!cfg || !sourcePath || !form.slug.trim() || form.slugError) return
		form.submitPage(
			() =>
				duplicatePage(cfg, {
					sourcePagePath: sourcePath,
					slug: form.slug.trim(),
					title: form.title.trim() || undefined,
					createRedirect,
				}),
			'Failed to duplicate page',
		)
	}, [sourcePath, form.title, form.slug, form.slugError, createRedirect, form.submitPage])

	const canSubmit = sourcePath && form.slug.trim() && !form.slugError && !form.slugChecking && !form.isSubmitting

	if (form.submitPhase) {
		return <PageCreatingOverlay phase={form.submitPhase} slug={form.slug} />
	}

	return (
		<>
			<ModalHeader title="Duplicate Page" onBack={() => setCreatePageMode('pick')} onClose={() => resetCreatePageState()} />
			<div class="p-5 space-y-4">
				<Field label="Source Page">
					<select
						value={sourcePath}
						onChange={(e) => {
							setSourcePath((e.target as HTMLSelectElement).value)
							form.resetSlugManual()
						}}
						class="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white focus:outline-none focus:border-cms-primary/50"
						data-cms-ui
					>
						{pages.map((p) => (
							<option key={p.pathname} value={p.pathname}>
								{p.title ? `${p.title} (${p.pathname})` : p.pathname}
							</option>
						))}
					</select>
				</Field>

				<Field label="New Title">
					<input
						type="text"
						value={form.title}
						onInput={(e) => form.handleTitleChange((e.target as HTMLInputElement).value)}
						placeholder="Page title"
						class="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
						data-cms-ui
					/>
				</Field>

				<Field label="New URL Path" error={form.slugError} checking={form.slugChecking}>
					<div class="flex items-center gap-1">
						<span class="text-white/40 text-sm">/</span>
						<input
							type="text"
							value={form.slug}
							onInput={(e) => form.handleSlugChange((e.target as HTMLInputElement).value)}
							placeholder="new-page-slug"
							class="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
							data-cms-ui
						/>
					</div>
				</Field>

				<label class="flex items-center gap-2.5 cursor-pointer" data-cms-ui>
					<input
						type="checkbox"
						checked={createRedirect}
						onChange={(e) => setCreateRedirect((e.target as HTMLInputElement).checked)}
						class="w-4 h-4 rounded accent-cms-primary"
						data-cms-ui
					/>
					<span class="text-sm text-white/70">Create redirect from source URL (307)</span>
				</label>
			</div>

			<ModalFooter>
				<CancelButton onClick={() => resetCreatePageState()} />
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!canSubmit}
					class="px-5 py-2.5 text-sm font-medium rounded-cms-pill transition-colors cursor-pointer bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
					data-cms-ui
				>
					Duplicate Page
				</button>
			</ModalFooter>
		</>
	)
}

function CollectionPicker() {
	const collectionDefinitions = manifest.value.collectionDefinitions ?? {}
	const collections = useMemo(() => Object.values(collectionDefinitions), [collectionDefinitions])

	// Single collection — skip picker and go straight to editor
	useEffect(() => {
		if (collections.length === 1) {
			const col = collections[0]
			if (col) {
				resetCreatePageState()
				openMarkdownEditorForNewPage(col.name, col)
			}
		}
	}, [collections])

	const handleSelectCollection = (name: string) => {
		const def = collectionDefinitions[name]
		if (def) {
			resetCreatePageState()
			openMarkdownEditorForNewPage(name, def)
		}
	}

	if (collections.length === 0) {
		return (
			<>
				<ModalHeader title="Collection Entry" onBack={() => setCreatePageMode('pick')} onClose={() => resetCreatePageState()} />
				<div class="p-8 text-center">
					<div class="text-white/60 mb-4">No content collections found.</div>
					<p class="text-white/40 text-sm">
						Add markdown files to <code class="bg-white/10 px-1.5 py-0.5 rounded">src/content/</code> subdirectories to enable page creation.
					</p>
				</div>
				<ModalFooter>
					<CancelButton onClick={() => resetCreatePageState()} label="Close" />
				</ModalFooter>
			</>
		)
	}

	// Single collection auto-selected via useEffect
	if (collections.length === 1) return null

	return (
		<>
			<ModalHeader title="Choose Collection" onBack={() => setCreatePageMode('pick')} onClose={() => resetCreatePageState()} />
			<div class="p-5 space-y-2">
				{collections.map((col) => (
					<button
						key={col.name}
						type="button"
						onClick={() => handleSelectCollection(col.name)}
						class="w-full flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-cms-lg border border-white/10 hover:border-white/20 transition-colors text-left cursor-pointer"
						data-cms-ui
					>
						<div class="shrink-0 w-10 h-10 bg-cms-primary/20 rounded-cms-md flex items-center justify-center">
							<CollectionIcon />
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-white font-medium">{col.label}</div>
							<div class="text-white/50 text-sm">
								{col.entryCount} {col.entryCount === 1 ? 'entry' : 'entries'} &middot; {col.fields.length} fields
							</div>
						</div>
						<ChevronRightIcon />
					</button>
				))}
			</div>
		</>
	)
}

function Field({ label, error, checking, children }: {
	label: string
	error?: string | null
	checking?: boolean
	children: preact.ComponentChildren
}) {
	return (
		<div class="space-y-1.5">
			<label class="text-sm font-medium text-white/70" data-cms-ui>{label}</label>
			{children}
			{checking && <p class="text-xs text-white/40">Checking availability...</p>}
			{error && <p class="text-xs text-red-400">{error}</p>}
		</div>
	)
}

/**
 * Loading overlay shown inside the modal while a page is being created
 * and the dev server is processing the new file.
 */
function PageCreatingOverlay({ phase, slug }: { phase: 'creating' | 'preparing'; slug: string }) {
	return (
		<div class="p-10 flex flex-col items-center gap-4" data-cms-ui>
			<Spinner />
			<div class="text-center">
				<div class="text-white font-medium">
					{phase === 'creating' ? 'Creating page...' : 'Preparing page...'}
				</div>
				<div class="text-white/40 text-sm mt-1">/{slug}</div>
			</div>
		</div>
	)
}

function Spinner() {
	return (
		<svg class="w-8 h-8 animate-spin text-cms-primary" viewBox="0 0 24 24" fill="none" data-cms-ui>
			<circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
			<path class="opacity-80" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
		</svg>
	)
}

/**
 * Poll a URL until the dev server returns a non-404 response,
 * so navigation doesn't land on a 404 while Astro processes the new file.
 */
async function waitForPageReady(url: string, maxAttempts = 20, intervalMs = 250): Promise<void> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const res = await fetch(url, { method: 'HEAD' })
			if (res.status !== 404) return
		} catch {
			// Network error — server might be restarting, keep trying
		}
		await new Promise((r) => setTimeout(r, intervalMs))
	}
}

function debouncedSlugCheck(
	slug: string,
	timeoutRef: preact.RefObject<ReturnType<typeof setTimeout> | null>,
	abortRef: preact.RefObject<AbortController | null>,
	setChecking: (v: boolean) => void,
	setError: (v: string | null) => void,
) {
	if (timeoutRef.current) clearTimeout(timeoutRef.current)
	abortRef.current?.abort()

	if (!slug.trim()) {
		setError(null)
		setChecking(false)
		return
	}

	setChecking(true)
	timeoutRef.current = setTimeout(async () => {
		const cfg = config.value
		if (!cfg) {
			setChecking(false)
			return
		}

		const controller = new AbortController()
		abortRef.current = controller

		const result = await checkSlugExists(cfg, slug, controller.signal)

		if (controller.signal.aborted) return

		setChecking(false)
		setError(result.exists ? `Page already exists at /${slug}` : null)
	}, 300)
}

function PageIcon() {
	return (
		<svg class="w-5 h-5 text-cms-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
			/>
		</svg>
	)
}

function DuplicateIcon() {
	return (
		<svg class="w-5 h-5 text-cms-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
			/>
		</svg>
	)
}

export function CollectionIcon() {
	return (
		<svg class="w-5 h-5 text-cms-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
			/>
		</svg>
	)
}

export function ChevronRightIcon() {
	return (
		<svg class="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
		</svg>
	)
}
