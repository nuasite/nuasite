import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { CollectionDefinition, FieldDefinition, MarkdownPageEntry } from '../types'
import { updateMarkdownFrontmatter } from '../signals'
import { cn } from '../lib/cn'
import { FrontmatterField, SchemaFrontmatterField, formatFieldLabel } from './frontmatter-fields'

// ============================================================================
// Field Utilities
// ============================================================================

export function partitionFields(fields: FieldDefinition[]): { sidebar: FieldDefinition[]; header: FieldDefinition[] } {
	const sidebar: FieldDefinition[] = []
	const header: FieldDefinition[] = []
	for (const field of fields) {
		if (field.position === 'sidebar') {
			sidebar.push(field)
		} else {
			header.push(field)
		}
	}
	return { sidebar, header }
}

export interface FieldGroup {
	group: string | null
	fields: FieldDefinition[]
}

export function groupFields(fields: FieldDefinition[]): FieldGroup[] {
	const groups: FieldGroup[] = []
	const groupMap = new Map<string | null, FieldDefinition[]>()
	const order: (string | null)[] = []

	for (const field of fields) {
		const key = field.group ?? null
		if (!groupMap.has(key)) {
			groupMap.set(key, [])
			order.push(key)
		}
		groupMap.get(key)!.push(field)
	}

	for (const key of order) {
		groups.push({ group: key, fields: groupMap.get(key)! })
	}

	return groups
}

// ============================================================================
// Group Header
// ============================================================================

function GroupHeader({ label }: { label: string }) {
	return (
		<div class="pt-3 pb-1" data-cms-ui>
			<h4 class="text-xs uppercase tracking-wider text-white/40 font-medium">{label}</h4>
			<div class="border-t border-white/10 mt-1.5" />
		</div>
	)
}

// ============================================================================
// Sidebar Component
// ============================================================================

const SIDEBAR_STORAGE_KEY = 'nuacms-sidebar'
const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 280

function loadSidebarState(): { width: number; collapsed: boolean } {
	try {
		const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
		if (stored) return JSON.parse(stored)
	} catch {}
	return { width: DEFAULT_WIDTH, collapsed: false }
}

function saveSidebarState(state: { width: number; collapsed: boolean }) {
	try {
		localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state))
	} catch (e) {
		console.warn('[CMS] Failed to save sidebar state:', e)
	}
}

interface FrontmatterSidebarProps {
	fields: FieldDefinition[]
	page: MarkdownPageEntry
	collectionDefinition?: CollectionDefinition
}

export function FrontmatterSidebar({ fields, page, collectionDefinition }: FrontmatterSidebarProps) {
	const [state, setState] = useState(loadSidebarState)
	const isResizing = useRef(false)
	const startX = useRef(0)
	const startWidth = useRef(0)

	const { width, collapsed } = state

	const updateState = useCallback((update: Partial<typeof state>, persist = true) => {
		setState((prev) => {
			const next = { ...prev, ...update }
			if (persist) saveSidebarState(next)
			return next
		})
	}, [])

	const handleMouseDown = useCallback((e: MouseEvent) => {
		e.preventDefault()
		isResizing.current = true
		startX.current = e.clientX
		startWidth.current = width
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
	}, [width])

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!isResizing.current) return
			const delta = startX.current - e.clientX
			const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
			updateState({ width: newWidth }, false)
		}

		const handleMouseUp = () => {
			if (!isResizing.current) return
			isResizing.current = false
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
			setState((current) => { saveSidebarState(current); return current })
		}

		document.addEventListener('mousemove', handleMouseMove)
		document.addEventListener('mouseup', handleMouseUp)
		return () => {
			document.removeEventListener('mousemove', handleMouseMove)
			document.removeEventListener('mouseup', handleMouseUp)
		}
	}, [updateState])

	if (fields.length === 0) return null

	const groups = groupFields(fields)
	const schemaFieldNames = new Set(collectionDefinition?.fields.map((f) => f.name) ?? [])

	return (
		<div
			class={cn('relative shrink-0 border-l border-white/10 bg-white/5 flex', collapsed && 'w-8')}
			style={collapsed ? undefined : { width: `${width}px` }}
			data-cms-ui
		>
			{/* Drag handle */}
			{!collapsed && (
				<div
					class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cms-primary/30 transition-colors z-10"
					onMouseDown={handleMouseDown}
				/>
			)}

			{/* Collapse toggle */}
			<button
				type="button"
				onClick={() => updateState({ collapsed: !collapsed })}
				class="absolute top-2 left-0 -translate-x-1/2 z-20 w-5 h-5 rounded-full bg-cms-dark border border-white/20 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 transition-colors"
				title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				data-cms-ui
			>
				<svg
					class={cn('w-3 h-3 transition-transform', collapsed && 'rotate-180')}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="m15 18-6-6 6-6" />
				</svg>
			</button>

			{/* Sidebar content */}
			{!collapsed && (
				<div class="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
					{groups.map((group, gi) => (
						<div key={gi} data-cms-ui>
							{group.group && <GroupHeader label={group.group} />}
							<div class="space-y-3">
								{group.fields.map((field) => {
									const isSchema = schemaFieldNames.has(field.name)
									return (
										<div key={field.name} data-cms-ui>
											{isSchema
												? (
													<SchemaFrontmatterField
														field={field}
														value={page.frontmatter[field.name]}
														onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
													/>
												)
												: (
													<FrontmatterField
														fieldKey={field.name}
														value={page.frontmatter[field.name]}
														onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
													/>
												)}
										</div>
									)
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
