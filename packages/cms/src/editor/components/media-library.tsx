import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import { createMediaFolder, fetchMediaLibrary, fetchProjectImages, uploadMedia } from '../markdown-api'
import { config, isMediaLibraryOpen, mediaLibraryState, resetMediaLibraryState, showToast } from '../signals'
import type { MediaFolderItem, MediaItem, MediaTypeFilter } from '../types'

const VECTOR_TYPES = new Set(['image/svg+xml', 'image/x-icon'])

const TYPE_FILTERS: Array<{ value: MediaTypeFilter; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'photo', label: 'Photos' },
	{ value: 'graphic', label: 'Graphics' },
	{ value: 'video', label: 'Videos' },
	{ value: 'document', label: 'Documents' },
]

function matchesTypeFilter(contentType: string, filter: MediaTypeFilter): boolean {
	if (filter === 'all') return true
	if (filter === 'photo') return contentType.startsWith('image/') && !VECTOR_TYPES.has(contentType)
	if (filter === 'graphic') return VECTOR_TYPES.has(contentType)
	if (filter === 'video') return contentType.startsWith('video/')
	if (filter === 'document') return contentType === 'application/pdf'
	return true
}

export function MediaLibrary() {
	const visible = isMediaLibraryOpen.value
	const insertCallback = mediaLibraryState.value.insertCallback

	const [uploadProgress, setUploadProgress] = useState<number | null>(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [allItems, setAllItems] = useState<MediaItem[]>([])
	const [folders, setFolders] = useState<MediaFolderItem[]>([])
	const [currentFolder, setCurrentFolder] = useState('')
	const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>('all')
	const [isLoading, setIsLoading] = useState(false)
	const [showNewFolderInput, setShowNewFolderInput] = useState(false)
	const [newFolderName, setNewFolderName] = useState('')
	const fileInputRef = useRef<HTMLInputElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const newFolderInputRef = useRef<HTMLInputElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: know what i am doing
	useEffect(() => {
		if (visible && allItems.length === 0) {
			loadFolder(currentFolder)
		}
	}, [visible])

	useEffect(() => {
		if (showNewFolderInput && newFolderInputRef.current) {
			newFolderInputRef.current.focus()
		}
	}, [showNewFolderInput])

	const loadFolder = async (folder: string) => {
		setIsLoading(true)
		try {
			const isRoot = !folder
			const [uploads, project] = await Promise.all([
				fetchMediaLibrary(config.value, { folder: folder || undefined }).catch(() => ({ items: [], folders: [] })),
				isRoot
					? fetchProjectImages(config.value).catch(() => ({ items: [] }))
					: Promise.resolve({ items: [] }),
			])

			setFolders((uploads as any).folders ?? [])

			const seen = new Set<string>()
			const combined: MediaItem[] = []
			for (const item of [...uploads.items, ...project.items]) {
				if (!seen.has(item.url)) {
					seen.add(item.url)
					combined.push(item)
				}
			}
			setAllItems(combined)
		} catch (error) {
			showToast('Failed to load media library', 'error')
		} finally {
			setIsLoading(false)
		}
	}

	const navigateToFolder = useCallback((folder: string) => {
		setCurrentFolder(folder)
		setSearchQuery('')
		loadFolder(folder)
	}, [])

	const handleClose = useCallback(() => {
		resetMediaLibraryState()
		setSearchQuery('')
		setCurrentFolder('')
		setTypeFilter('all')
		setFolders([])
		setShowNewFolderInput(false)
		setNewFolderName('')
	}, [])

	const handleSelectImage = useCallback(
		(item: MediaItem) => {
			if (insertCallback) {
				const alt = item.annotation || item.filename || 'Image'
				insertCallback(item.url, alt)
				handleClose()
			}
		},
		[insertCallback, handleClose],
	)

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click()
	}, [])

	const handleUploadFile = async (file: File) => {
		setUploadProgress(0)
		try {
			const result = await uploadMedia(config.value, file, (percent) => {
				setUploadProgress(percent)
			}, { folder: currentFolder || undefined })

			if (result.success && result.url) {
				const newItem: MediaItem = {
					id: result.id || crypto.randomUUID(),
					url: result.url,
					filename: result.filename || file.name,
					annotation: result.annotation,
					contentType: file.type,
					folder: currentFolder || undefined,
				}
				setAllItems((prev) => [newItem, ...prev])
				showToast('File uploaded successfully', 'success')
			} else {
				showToast(result.error || 'Upload failed', 'error')
			}
		} catch (error) {
			showToast('Upload failed', 'error')
		} finally {
			setUploadProgress(null)
		}
	}

	const handleFileChange = async (e: Event) => {
		const target = e.target as HTMLInputElement
		const file = target.files?.[0]
		if (!file) return
		await handleUploadFile(file)
		target.value = ''
	}

	const handleDrop = async (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()

		const file = e.dataTransfer?.files[0]
		if (!file || !file.type.startsWith('image/')) {
			showToast('Please drop an image file', 'error')
			return
		}
		await handleUploadFile(file)
	}

	const handleDragOver = (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
	}

	const handleCreateFolder = async () => {
		const name = newFolderName.trim()
		if (!name) return
		if (/[/\\:*?"<>|]/.test(name)) {
			showToast('Invalid folder name', 'error')
			return
		}
		const folderPath = currentFolder ? `${currentFolder}/${name}` : name
		try {
			const result = await createMediaFolder(config.value, folderPath)
			if (result.success) {
				setFolders((prev) => [...prev, { name, path: folderPath }].sort((a, b) => a.name.localeCompare(b.name)))
				showToast('Folder created', 'success')
			} else {
				showToast(result.error || 'Failed to create folder', 'error')
			}
		} catch {
			showToast('Failed to create folder', 'error')
		}
		setNewFolderName('')
		setShowNewFolderInput(false)
	}

	// Client-side filtering: both search query AND type filter
	const filteredItems = useMemo(() => {
		let items = allItems
		if (typeFilter !== 'all') {
			items = items.filter((item) => matchesTypeFilter(item.contentType, typeFilter))
		}
		if (searchQuery) {
			const q = searchQuery.toLowerCase()
			items = items.filter((item) => item.filename.toLowerCase().includes(q))
		}
		return items
	}, [searchQuery, typeFilter, allItems])

	// Build breadcrumb segments
	const breadcrumbs = useMemo(() => {
		if (!currentFolder) return []
		const parts = currentFolder.split('/')
		return parts.map((name, i) => ({
			name,
			path: parts.slice(0, i + 1).join('/'),
		}))
	}, [currentFolder])

	if (!visible) return null

	return (
		<div
			style={{ zIndex: Z_INDEX.MODAL }}
			class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={handleClose}
			data-cms-ui
		>
			<div
				ref={containerRef}
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-3xl w-full max-h-[80vh] flex flex-col border border-white/10"
				onClick={(e) => e.stopPropagation()}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				data-cms-ui
			>
				{/* Header */}
				<div class="flex items-center justify-between p-5 border-b border-white/10">
					<h2 class="text-lg font-semibold text-white">Media Library</h2>
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

				{/* Breadcrumbs */}
				{currentFolder && (
					<div class="flex items-center gap-1.5 px-4 pt-3 text-sm" data-cms-ui>
						<button
							type="button"
							onClick={() => navigateToFolder('')}
							class="text-white/60 hover:text-white transition-colors"
							data-cms-ui
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"
								/>
							</svg>
						</button>
						{breadcrumbs.map((crumb, i) => (
							<span key={crumb.path} class="flex items-center gap-1.5">
								<span class="text-white/30">/</span>
								{i === breadcrumbs.length - 1
									? <span class="text-white font-medium">{crumb.name}</span>
									: (
										<button
											type="button"
											onClick={() => navigateToFolder(crumb.path)}
											class="text-white/60 hover:text-white transition-colors"
											data-cms-ui
										>
											{crumb.name}
										</button>
									)}
							</span>
						))}
					</div>
				)}

				{/* Search + Type Filters + Actions */}
				<div class="flex flex-col gap-3 p-4 border-b border-white/10">
					<div class="flex items-center gap-3">
						<input
							type="text"
							placeholder="Search files..."
							value={searchQuery}
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
							class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 rounded-cms-md text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10"
							data-cms-ui
						/>
						<button
							type="button"
							onClick={() => setShowNewFolderInput((v) => !v)}
							class="px-3 py-2.5 bg-white/10 text-white/70 rounded-cms-md text-sm hover:bg-white/15 hover:text-white transition-colors border border-white/20"
							title="New folder"
							data-cms-ui
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
								/>
							</svg>
						</button>
						<button
							type="button"
							onClick={handleUploadClick}
							class="px-5 py-2.5 bg-cms-primary text-cms-primary-text rounded-cms-pill text-sm font-medium hover:bg-cms-primary-hover transition-colors"
							data-cms-ui
						>
							Upload
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*,video/mp4,video/webm,application/pdf"
							class="hidden"
							onChange={handleFileChange}
							data-cms-ui
						/>
					</div>

					{/* Type filter tabs */}
					<div class="flex items-center gap-1" data-cms-ui>
						{TYPE_FILTERS.map((filter) => (
							<button
								key={filter.value}
								type="button"
								onClick={() => setTypeFilter(filter.value)}
								class={`px-3 py-1.5 text-xs font-medium rounded-cms-pill transition-colors ${
									typeFilter === filter.value
										? 'bg-cms-primary text-cms-primary-text'
										: 'text-white/50 hover:text-white hover:bg-white/10'
								}`}
								data-cms-ui
							>
								{filter.label}
							</button>
						))}
					</div>
				</div>

				{/* New folder input */}
				{showNewFolderInput && (
					<div class="flex items-center gap-2 px-4 py-3 bg-white/5 border-b border-white/10" data-cms-ui>
						<svg class="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
							/>
						</svg>
						<input
							ref={newFolderInputRef}
							type="text"
							placeholder="Folder name..."
							value={newFolderName}
							onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleCreateFolder()
								if (e.key === 'Escape') {
									setShowNewFolderInput(false)
									setNewFolderName('')
								}
							}}
							class="flex-1 px-3 py-1.5 bg-white/10 border border-white/20 rounded-cms-md text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40"
							data-cms-ui
						/>
						<button
							type="button"
							onClick={handleCreateFolder}
							class="px-3 py-1.5 bg-cms-primary text-cms-primary-text rounded-cms-md text-xs font-medium hover:bg-cms-primary-hover transition-colors"
							data-cms-ui
						>
							Create
						</button>
						<button
							type="button"
							onClick={() => {
								setShowNewFolderInput(false)
								setNewFolderName('')
							}}
							class="px-2 py-1.5 text-white/40 hover:text-white text-xs transition-colors"
							data-cms-ui
						>
							Cancel
						</button>
					</div>
				)}

				{/* Upload progress */}
				{uploadProgress !== null && (
					<div class="px-4 py-3 bg-white/5 border-b border-white/10">
						<div class="flex items-center gap-3">
							<div class="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
								<div
									class="h-full bg-cms-primary transition-all duration-200 rounded-full"
									style={{ width: `${uploadProgress}%` }}
								/>
							</div>
							<span class="text-sm text-white font-medium">{uploadProgress}%</span>
						</div>
					</div>
				)}

				{/* Content grid */}
				<div class="flex-1 overflow-auto p-4">
					{isLoading
						? (
							<div class="flex items-center justify-center h-48">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-cms-primary" />
							</div>
						)
						: folders.length === 0 && filteredItems.length === 0
						? (
							<div class="flex flex-col items-center justify-center h-48 text-white/50">
								<svg class="w-12 h-12 mb-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
								<p class="text-sm">
									{searchQuery || typeFilter !== 'all' ? 'No matching files found' : 'No files yet. Upload one to get started.'}
								</p>
							</div>
						)
						: (
							<div class="grid grid-cols-4 gap-3">
								{/* Folders first (hidden when filtering by type or searching) */}
								{!searchQuery && typeFilter === 'all' && folders.map((folder) => (
									<div key={folder.path} class="group relative aspect-square" data-cms-ui>
										<button
											type="button"
											onClick={() => navigateToFolder(folder.path)}
											class="w-full h-full rounded-cms-md overflow-hidden border-2 border-white/10 hover:border-white/30 focus:outline-none focus:border-white/30 transition-all bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center gap-2"
											data-cms-ui
										>
											<svg
												class="w-10 h-10 text-white/40 group-hover:text-white/60 transition-colors"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="1.5"
													d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
												/>
											</svg>
											<p class="text-xs text-white/60 group-hover:text-white/80 truncate max-w-full px-2 transition-colors">
												{folder.name}
											</p>
										</button>
									</div>
								))}

								{/* Files */}
								{filteredItems.map((item) => (
									<div key={item.id} class="group relative aspect-square" data-cms-ui>
										<button
											type="button"
											onClick={() => handleSelectImage(item)}
											class="w-full h-full rounded-cms-md overflow-hidden border-2 border-white/10 hover:border-cms-primary focus:outline-none focus:border-cms-primary transition-all"
											data-cms-ui
										>
											{item.contentType.startsWith('image/')
												? (
													<img
														src={item.url}
														alt={item.annotation || item.filename}
														class="w-full h-full object-cover"
													/>
												)
												: (
													<div class="w-full h-full flex flex-col items-center justify-center bg-white/5 gap-2">
														<FileTypeIcon contentType={item.contentType} />
													</div>
												)}
											<div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none" />
											<div class="absolute bottom-0 left-0 right-0 p-2 bg-linear-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
												<p class="text-xs text-white truncate">{item.filename}</p>
											</div>
										</button>
										{item.annotation && (
											<div class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
												<div class="relative group/tooltip">
													<button
														type="button"
														class="p-1 bg-black/60 hover:bg-black/80 rounded-full text-white/70 hover:text-white transition-colors"
														onClick={(e) => e.stopPropagation()}
														title={item.annotation}
														data-cms-ui
													>
														<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
															/>
														</svg>
													</button>
													<div class="absolute right-0 top-full mt-1 w-48 p-2 bg-black/90 text-white text-xs rounded-md opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-10 pointer-events-none">
														{item.annotation}
													</div>
												</div>
											</div>
										)}
									</div>
								))}
							</div>
						)}
				</div>

				<div class="px-4 py-4 border-t border-white/10 bg-white/5 text-center text-sm text-white/50 rounded-b-cms-xl">
					Drag and drop files here to upload{currentFolder ? ` to ${currentFolder}` : ''}
				</div>
			</div>
		</div>
	)
}

function FileTypeIcon({ contentType }: { contentType: string }) {
	if (contentType.startsWith('video/')) {
		return (
			<svg class="w-10 h-10 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
				/>
			</svg>
		)
	}
	if (contentType === 'application/pdf') {
		return (
			<svg class="w-10 h-10 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
				/>
			</svg>
		)
	}
	return (
		<svg class="w-10 h-10 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="1.5"
				d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
			/>
		</svg>
	)
}
