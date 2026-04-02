import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { fetchMediaLibrary, fetchProjectImages, uploadMedia } from '../markdown-api'
import { Z_INDEX } from '../constants'
import { config, isMediaLibraryOpen, mediaLibraryState, resetMediaLibraryState, showToast } from '../signals'
import type { MediaItem } from '../types'

export function MediaLibrary() {
	const visible = isMediaLibraryOpen.value
	const insertCallback = mediaLibraryState.value.insertCallback

	const [uploadProgress, setUploadProgress] = useState<number | null>(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [allItems, setAllItems] = useState<MediaItem[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: know what i am doing
	useEffect(() => {
		if (visible && allItems.length === 0) {
			loadAllImages()
		}
	}, [visible])

	const loadAllImages = async () => {
		setIsLoading(true)
		try {
			const [uploads, project] = await Promise.all([
				fetchMediaLibrary(config.value).catch(() => ({ items: [] })),
				fetchProjectImages(config.value).catch(() => ({ items: [] })),
			])
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

	const handleClose = useCallback(() => {
		resetMediaLibraryState()
		setSearchQuery('')
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
			})

			if (result.success && result.url) {
				const newItem: MediaItem = {
					id: result.id || crypto.randomUUID(),
					url: result.url,
					filename: result.filename || file.name,
					annotation: result.annotation,
					contentType: file.type,
				}
				setAllItems([newItem, ...allItems])
				showToast('Image uploaded successfully', 'success')
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

	const filteredItems = useMemo(() =>
		searchQuery
			? allItems.filter((item) => item.filename.toLowerCase().includes(searchQuery.toLowerCase()))
			: allItems, [searchQuery, allItems])

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

				<div class="flex items-center gap-3 p-4 border-b border-white/10">
					<input
						type="text"
						placeholder="Search images..."
						value={searchQuery}
						onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
						class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 rounded-cms-md text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10"
						data-cms-ui
					/>
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
						accept="image/*"
						class="hidden"
						onChange={handleFileChange}
						data-cms-ui
					/>
				</div>

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

				<div class="flex-1 overflow-auto p-4">
					{isLoading
						? (
							<div class="flex items-center justify-center h-48">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-cms-primary" />
							</div>
						)
						: filteredItems.length === 0
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
									{searchQuery ? 'No images found' : 'No images yet. Upload one to get started.'}
								</p>
							</div>
						)
						: (
							<div class="grid grid-cols-4 gap-3">
								{filteredItems.map((item) => (
									<div key={item.id} class="group relative aspect-square" data-cms-ui>
										<button
											type="button"
											onClick={() => handleSelectImage(item)}
											class="w-full h-full rounded-cms-md overflow-hidden border-2 border-white/10 hover:border-cms-primary focus:outline-none focus:border-cms-primary transition-all"
											data-cms-ui
										>
											<img
												src={item.url}
												alt={item.annotation || item.filename}
												class="w-full h-full object-cover"
											/>
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
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
					Drag and drop images here to upload
				</div>
			</div>
		</div>
	)
}
