import type { ComponentChildren, FunctionComponent } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { CMS_VERSION } from '../constants'
import { cn } from '../lib/cn'
import * as signals from '../signals'
import { showConfirmDialog } from '../signals'
import type { CollectionDefinition } from '../types'

export interface ToolbarCallbacks {
	onEdit: () => void
	onCompare: () => void
	onSave: () => void
	onDiscard: () => void
	onSelectElement?: () => void
	onMediaLibrary?: () => void
	onDismissDeployment?: () => void
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

type MenuItem = { label: string; icon: ComponentChildren; onClick: () => void; isActive?: boolean }
type MenuSection = { label: string; icon: ComponentChildren; items: MenuItem[] }

const GridIcon = () => (
	<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="7" height="7" rx="1" />
		<rect x="3" y="14" width="7" height="7" rx="1" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	</svg>
)

const DeploymentStatusIndicator = ({ onDismiss }: { onDismiss?: () => void }) => {
	const deploymentStatus = signals.deploymentStatus.value
	const lastDeployedAt = signals.lastDeployedAt.value

	if (!deploymentStatus) {
		return null
	}

	const isActive = deploymentStatus === 'pending' || deploymentStatus === 'queued' || deploymentStatus === 'running'
	const isCompleted = deploymentStatus === 'completed'
	const isFailed = deploymentStatus === 'failed'

	if (!isActive && !isCompleted && !isFailed) {
		return null
	}

	const formatTimeAgo = (dateStr: string) => {
		const date = new Date(dateStr)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffSec = Math.floor(diffMs / 1000)
		const diffMin = Math.floor(diffSec / 60)

		if (diffMin < 1) return 'just now'
		if (diffMin === 1) return '1m ago'
		if (diffMin < 60) return `${diffMin}m ago`
		const diffHour = Math.floor(diffMin / 60)
		if (diffHour === 1) return '1h ago'
		return `${diffHour}h ago`
	}

	return (
		<div
			class={cn(
				'flex items-center gap-1.5 sm:gap-2 px-3 py-2 sm:px-5 sm:py-2.5 text-sm font-medium rounded-cms-pill transition-all',
				isActive && 'text-white/80',
				isCompleted && 'bg-cms-primary text-cms-primary-text',
				isFailed && 'bg-cms-error/20 text-cms-error cursor-pointer hover:bg-cms-error/30',
			)}
			onClick={isFailed ? onDismiss : undefined}
			title={isFailed ? 'Click to dismiss' : undefined}
		>
			{isActive && (
				<>
					<span class="inline-block w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
					<span class="hidden sm:inline">Deploying</span>
				</>
			)}
			{isCompleted && (
				<>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
					</svg>
					<span class="hidden sm:inline">Live{lastDeployedAt ? ` ${formatTimeAgo(lastDeployedAt)}` : ''}</span>
				</>
			)}
			{isFailed && (
				<>
					<svg class="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
					<span class="hidden sm:inline">Failed</span>
				</>
			)}
		</div>
	)
}

export const Toolbar = ({ callbacks, collectionDefinitions }: ToolbarProps) => {
	const isEditing = signals.isEditing.value
	const showingOriginal = signals.showingOriginal.value
	const dirtyCount = signals.totalDirtyCount.value
	const isSaving = signals.isSaving.value
	const deploymentStatus = signals.deploymentStatus.value
	const showEditableHighlights = signals.showEditableHighlights.value
	const isPreviewingMarkdown = signals.isMarkdownPreview.value
	const currentPageCollection = signals.currentPageCollection.value
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
	const [showVersion, setShowVersion] = useState(false)
	const versionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	if (isPreviewingMarkdown) return null

	const showDeploymentStatus = deploymentStatus !== null

	const stopPropagation = (e: Event) => e.stopPropagation()

	const handleDiscard = async () => {
		const confirmed = await showConfirmDialog({
			title: 'Discard Changes',
			message: 'Discard all changes? This cannot be undone.',
			confirmLabel: 'Discard',
			cancelLabel: 'Cancel',
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
			label: 'Select Element',
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

	if (collectionDefinitions) {
		const entries = Object.entries(collectionDefinitions)
		if (entries.length > 0) {
			const contentItems: MenuItem[] = entries.map(([name, def]) => ({
				label: def.label,
				icon: <GridIcon />,
				onClick: () => callbacks.onOpenCollection?.(name),
			}))

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

			menuSections.push({
				label: 'Content',
				icon: <GridIcon />,
				items: contentItems,
			})
		}
	}

	const pageItems: MenuItem[] = [
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

	menuSections.push({
		label: 'Page',
		icon: (
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
				<path d="M14 2v4a2 2 0 0 0 2 2h4" />
			</svg>
		),
		items: pageItems,
	})

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
			class={cn(
				'fixed bottom-4 sm:bottom-8 z-2147483647 font-sans transition-all duration-300',
				isToolbarOpen
					? 'left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2'
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
						class={'flex gap-2.5 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white py-2! pr-1.5!'}
					>
						Outlines
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
					{/* Deployment Status */}
					{showDeploymentStatus && <DeploymentStatusIndicator onDismiss={callbacks.onDismissDeployment} />}

					{/* Saving indicator */}
					{isSaving && !showingOriginal && (
						<div class="flex items-center gap-1.5 px-3 py-2 sm:px-5 sm:py-2.5 text-sm font-medium text-white/80">
							<span class="inline-block w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
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
										<div class="absolute bottom-full right-0 mb-4 min-w-[200px] bg-cms-dark rounded-cms-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 overflow-hidden py-1">
											{topLevelItems.map((item, index) => (
												<button
													key={`top-${index}`}
													onClick={(e) => {
														e.stopPropagation()
														item.onClick()
														setIsMenuOpen(false)
													}}
													class={cn(
														'w-full px-4 py-2.5 text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-3',
														item.isActive
															? 'bg-white/20 text-white'
															: 'text-white/80 hover:bg-white/10 hover:text-white',
													)}
												>
													<span class="shrink-0 opacity-70">{item.icon}</span>
													{item.label}
												</button>
											))}
											{topLevelItems.length > 0 && menuSections.length > 0 && (
												<div class="border-t border-white/10 my-1" />
											)}
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
															class="w-full px-4 py-2.5 text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-3 text-white/80 hover:bg-white/10 hover:text-white"
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
														{isExpanded && section.items.map((item, index) => (
															<button
																key={index}
																onClick={(e) => {
																	e.stopPropagation()
																	item.onClick()
																	setIsMenuOpen(false)
																}}
																class={cn(
																	'w-full pl-11 pr-4 py-2 text-sm text-left transition-colors cursor-pointer flex items-center gap-3',
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
												)
											})}
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
