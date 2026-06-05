import type { ComponentChildren, FunctionComponent } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { CMS_VERSION, Z_INDEX } from '../constants'
import { cn } from '../lib/cn'
import * as signals from '../signals'
import { showConfirmDialog } from '../signals'
import { STRINGS } from '../strings'
import type { CollectionDefinition } from '../types'
import { Spinner } from './spinner'

export interface ToolbarCallbacks {
	onEdit: () => void
	onCompare: () => void
	onSave: () => void
	onDiscard: () => void
	onSelectElement?: () => void
	onMediaLibrary?: () => void
	onNavigateChange?: () => void
	onEditContent?: () => void
	onToggleHighlights?: () => void
	onSeoEditor?: () => void
	onOpenCollection?: (name: string) => void
	onOpenCollections?: () => void
}

export interface ToolbarProps {
	callbacks: ToolbarCallbacks
	collectionDefinitions?: Record<string, CollectionDefinition>
}

type MenuItem = { label: string; icon: ComponentChildren; onClick: () => void; isActive?: boolean; indented?: boolean }
type MenuSection = { label: string; icon: ComponentChildren; items: MenuItem[] }

const GridIcon = () => (
	<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="7" height="7" rx="1" />
		<rect x="3" y="14" width="7" height="7" rx="1" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	</svg>
)

export const Toolbar = ({ callbacks, collectionDefinitions }: ToolbarProps) => {
	const isEditing = signals.isEditing.value
	const showingOriginal = signals.showingOriginal.value
	const dirtyCount = signals.totalDirtyCount.value
	const isSaving = signals.isSaving.value
	const showEditableHighlights = signals.showEditableHighlights.value
	const isPreviewingMarkdown = signals.isMarkdownPreview.value
	const isSideModalOpen = signals.isColorEditorOpen.value
		|| signals.isAttributeEditorOpen.value
		|| signals.isBgImageOverlayOpen.value
	const currentPageCollection = signals.currentPageCollection.value
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
	const [showVersion, setShowVersion] = useState(false)
	const versionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	if (isPreviewingMarkdown) return null
	// Right-anchored side panels (color editor, attribute editor, background-image overlay)
	// would visually overlap the right-anchored toolbar pill — hide while any of them is open.
	if (isSideModalOpen) return null

	const stopPropagation = (e: Event) => e.stopPropagation()

	const handleDiscard = async () => {
		const confirmed = await showConfirmDialog({
			title: STRINGS.dialog.discardAll.title,
			message: STRINGS.dialog.discardAll.message,
			confirmLabel: STRINGS.dialog.discardAll.confirm,
			cancelLabel: STRINGS.dialog.discardAll.cancel,
			variant: 'danger',
		})
		if (confirmed) {
			callbacks.onDiscard()
		}
	}

	const isSelectMode = signals.isSelectMode.value
	const isToolbarOpen = isEditing || isSelectMode

	const menuSections: MenuSection[] = []
	const topLevelItems: MenuItem[] = []
	if (callbacks.onSelectElement && signals.config.value.features?.selectElement) {
		topLevelItems.push({
			label: STRINGS.toolbar.selectElement,
			icon: (
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
					<path d="M13 13l6 6" />
				</svg>
			),
			onClick: () => callbacks.onSelectElement?.(),
			isActive: isSelectMode,
		})
	}

	// When collection management is disabled (e.g. it lives in the host app's
	// Collections tab), hide the in-preview collection browser entry points.
	// Inline editing of the current page's content ("Edit Content") is kept.
	const collectionManagementEnabled = signals.config.value.features?.collectionManagement !== false

	if (collectionDefinitions) {
		const entries = Object.entries(collectionDefinitions)
		if (entries.length > 0) {
			// Group nested (child) collections under their parent, child entries indented.
			const ordered: Array<[string, CollectionDefinition, boolean]> = []
			for (const [name, def] of entries.filter(([, d]) => !d.parentCollection)) {
				ordered.push([name, def, false])
				for (const [childName, childDef] of entries.filter(([, d]) => d.parentCollection === name)) {
					ordered.push([childName, childDef, true])
				}
			}
			// Orphaned children whose parent isn't present stay top-level so nothing is hidden.
			for (const [name, def] of entries.filter(([, d]) => d.parentCollection && !collectionDefinitions[d.parentCollection])) {
				ordered.push([name, def, false])
			}

			const contentItems: MenuItem[] = collectionManagementEnabled
				? ordered.map(([name, def, indented]) => ({
					label: def.label,
					icon: <GridIcon />,
					indented,
					onClick: () => callbacks.onOpenCollection?.(name),
				}))
				: []

			if (currentPageCollection && callbacks.onEditContent) {
				contentItems.unshift({
					label: 'Edit Content',
					icon: (
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
							<path d="M14 2v4a2 2 0 0 0 2 2h4" />
							<path d="M10 13H8" />
							<path d="M16 17H8" />
							<path d="M16 13h-2" />
						</svg>
					),
					onClick: () => callbacks.onEditContent?.(),
				})
			}

			if (contentItems.length > 0) {
				menuSections.push({
					label: 'Content',
					icon: <GridIcon />,
					items: contentItems,
				})
			}
		}
	}

	topLevelItems.push(
		{
			label: 'Edit Page',
			icon: (
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
				</svg>
			),
			onClick: () => callbacks.onEdit(),
			isActive: isEditing,
		},
		{
			label: 'New Page',
			icon: (
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 5v14m-7-7h14" />
				</svg>
			),
			onClick: () => signals.setCreatePageOpen(true),
		},
	)

	const destructiveItems: MenuItem[] = [
		{
			label: 'Delete Page',
			icon: (
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
				</svg>
			),
			onClick: () => {
				const pathname = window.location.pathname
				signals.openDeletePageDialog({ pathname })
			},
		},
	]

	const settingsItems: MenuItem[] = []

	if (callbacks.onSeoEditor) {
		settingsItems.push({
			label: 'SEO',
			icon: (
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			),
			onClick: () => callbacks.onSeoEditor?.(),
		})
	}

	settingsItems.push({
		label: 'Redirects',
		icon: (
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M9 18l6-6-6-6" />
				<path d="M15 18l6-6-6-6" />
			</svg>
		),
		onClick: () => signals.openRedirectsManager(),
	})

	menuSections.push({
		label: 'Settings',
		icon: (
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		),
		items: settingsItems,
	})

	return (
		<div
			style={{ zIndex: Z_INDEX.MODAL }}
			class={cn(
				'fixed bottom-4 sm:bottom-8 font-sans transition-all duration-300',
				isToolbarOpen
					? 'left-4 right-4 sm:right-8 sm:left-auto sm:-translate-x-1/2'
					: 'right-4 sm:right-8',
			)}
			data-cms-ui
			onMouseDown={stopPropagation}
			onClick={stopPropagation}
		>
			<div class="flex items-center justify-between sm:justify-start gap-2 sm:gap-1.5 px-2 sm:px-2 py-2 sm:py-2 bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10">
				{/* Outlines toggle - visible in toolbar when editing or selecting */}
				{isToolbarOpen && !showingOriginal && callbacks.onToggleHighlights && (
					<ToolbarButton
						onClick={() => callbacks.onToggleHighlights?.()}
						class={'flex min-w-[157px] gap-2.5 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white py-2! pr-1.5!'}
					>
						{showEditableHighlights ? 'Hide Outlines' : 'Show Outlines'}
						<span
							class={cn(
								'inline-block w-6 h-6 rounded-full shrink-0 transition-colors',
								showEditableHighlights ? 'bg-cms-primary/50 border  border-cms-primary' : 'bg-cms-dark',
							)}
						/>
					</ToolbarButton>
				)}

				{/* Primary actions group */}
				<div class="flex items-center gap-2 sm:gap-1.5">
					{/* Saving indicator */}
					{isSaving && !showingOriginal && (
						<div class="flex items-center gap-1.5 px-3 py-2 sm:px-5 sm:py-2.5 text-sm font-medium text-white/80">
							<Spinner size="sm" className="text-white/80" />
							<span>Saving</span>
						</div>
					)}

					{/* Dirty indicator + Save/Discard group */}
					{dirtyCount > 0 && !isSaving && !showingOriginal && (
						<>
							<button
								onClick={callbacks.onNavigateChange}
								class="hidden sm:block px-3 py-2 text-sm text-white/50 hover:text-white/80 hover:bg-white/10 rounded-cms-pill transition-all cursor-pointer tabular-nums"
								title="Click to navigate through changes"
							>
								{dirtyCount} unsaved
							</button>
							{/* Mobile: show count badge only */}
							<span class="sm:hidden px-2 py-1 text-xs text-white/50 tabular-nums">
								{dirtyCount}
							</span>
							<ToolbarButton
								class="bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover"
								onClick={callbacks.onSave}
							>
								Save
							</ToolbarButton>
							<ToolbarButton
								onClick={handleDiscard}
								class="bg-cms-error text-white hover:bg-red-600"
							>
								Discard
							</ToolbarButton>
						</>
					)}

					{isEditing
						? (
							<button
								onClick={(e) => {
									e.stopPropagation()
									callbacks.onEdit()
								}}
								class="w-10 h-10 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all duration-150 cursor-pointer"
								title="Done editing"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						)
						: isSelectMode
						? (
							<button
								onClick={(e) => {
									e.stopPropagation()
									callbacks.onSelectElement?.()
								}}
								class="w-10 h-10 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all duration-150 cursor-pointer"
								title="Done selecting"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						)
						: (
							<div class="relative">
								<button
									onClick={(e) => {
										e.stopPropagation()
										setIsMenuOpen(!isMenuOpen)
									}}
									onDblClick={(e) => {
										e.stopPropagation()
										setIsMenuOpen(false)
										setShowVersion(true)
										if (versionTimeoutRef.current) clearTimeout(versionTimeoutRef.current)
										versionTimeoutRef.current = setTimeout(() => setShowVersion(false), 3000)
									}}
									class="w-10 h-10 rounded-full bg-cms-primary flex items-center justify-center cursor-pointer transition-all duration-150 hover:bg-cms-primary-hover"
									aria-label="Menu"
								>
									<span class="w-3 h-3 rounded-full bg-black" />
								</button>

								{showVersion && (
									<div class="absolute bottom-full right-0 mb-2 px-3.5 py-2 text-sm text-white/70 bg-cms-dark rounded-cms-lg shadow-lg border border-white/10 whitespace-nowrap animate-[fadeIn_150ms_ease-out]">
										v{CMS_VERSION}
									</div>
								)}

								{isMenuOpen && (
									<>
										{/* Backdrop to close menu */}
										<div
											class="fixed inset-0 z-[-1]"
											onClick={(e) => {
												e.stopPropagation()
												setIsMenuOpen(false)
											}}
										/>
										{/* Menu popover */}
										<div class="absolute bottom-full right-0 mb-4 min-w-[200px] bg-cms-dark rounded-cms-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 overflow-hidden">
											{topLevelItems.map((item, index) => (
												<button
													key={`top-${index}`}
													onClick={(e) => {
														e.stopPropagation()
														item.onClick()
														setIsMenuOpen(false)
													}}
													class={cn(
														'w-full p-2.5 text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-3',
														index === 0 && 'pt-3.5',
														item.isActive
															? 'bg-white/20 text-white'
															: 'text-white/80 hover:bg-white/10 hover:text-white',
													)}
												>
													<span class="shrink-0 opacity-70">{item.icon}</span>
													{item.label}
												</button>
											))}
											{topLevelItems.length > 0 && menuSections.length > 0 && <div class="border-t border-white/10" />}
											{menuSections.map((section) => {
												const isExpanded = expandedSections.has(section.label)
												return (
													<div key={section.label}>
														<button
															onClick={(e) => {
																e.stopPropagation()
																setExpandedSections((prev) => {
																	const next = new Set(prev)
																	if (next.has(section.label)) {
																		next.delete(section.label)
																	} else {
																		next.add(section.label)
																	}
																	return next
																})
															}}
															class="w-full p-2.5 text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-3 text-white/80 hover:bg-white/10 hover:text-white"
														>
															<span class="shrink-0 opacity-70">{section.icon}</span>
															{section.label}
															<svg
																class={cn('w-3.5 h-3.5 ml-auto opacity-50 transition-transform duration-150', isExpanded && 'rotate-180')}
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
															>
																<path d="m6 9 6 6 6-6" />
															</svg>
														</button>
														<div
															class={cn(
																'grid transition-[grid-template-rows] duration-200 ease-out',
																isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
															)}
														>
															<div class="overflow-hidden">
																{section.items.map((item, index) => (
																	<button
																		key={index}
																		onClick={(e) => {
																			e.stopPropagation()
																			item.onClick()
																			setIsMenuOpen(false)
																		}}
																		class={cn(
																			'w-full pl-9 pr-4 py-2 text-sm text-left transition-colors cursor-pointer flex items-center gap-3',
																			item.indented && 'pl-16 text-xs text-white/45',
																			item.isActive
																				? 'bg-white/20 text-white'
																				: 'text-white/60 hover:bg-white/10 hover:text-white',
																		)}
																	>
																		<span class="shrink-0 opacity-70">{item.icon}</span>
																		{item.label}
																	</button>
																))}
															</div>
														</div>
													</div>
												)
											})}
											{destructiveItems.length > 0 && <div class="border-t border-white/10" />}
											{destructiveItems.map((item, index) => (
												<button
													key={`destructive-${index}`}
													onClick={(e) => {
														e.stopPropagation()
														item.onClick()
														setIsMenuOpen(false)
													}}
													class="w-full p-2.5 pb-3.5 text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-3 text-red-400/80 hover:bg-red-500/10 hover:text-red-400"
												>
													<span class="shrink-0 opacity-70">{item.icon}</span>
													{item.label}
												</button>
											))}
										</div>
									</>
								)}
							</div>
						)}
				</div>
			</div>
		</div>
	)
}

interface ToolbarButtonProps {
	onClick?: () => void
	class?: string
}

const ToolbarButton: FunctionComponent<ToolbarButtonProps> = ({ children, onClick, class: className }) => {
	return (
		<button
			onClick={(e) => {
				e.stopPropagation()
				onClick?.()
			}}
			class={cn(
				'px-3 py-2 sm:px-5 sm:py-2.5 text-sm font-medium transition-all duration-150 flex items-center justify-center rounded-cms-pill whitespace-nowrap border-transparent border',
				onClick && 'cursor-pointer',
				className,
			)}
		>
			{children}
		</button>
	)
}
