import { useMemo, useRef, useState } from 'preact/hooks'
import { slugify } from '../../shared'
import { getCollectionEntryOptions } from '../manifest'
import { manifest, openMediaLibraryWithCallback, pendingCollectionEntries } from '../signals'
import type { ComponentProp } from '../types'
import { SchemaFrontmatterField } from './frontmatter-fields'

export interface PropEditorProps {
	prop: ComponentProp
	value: string
	onChange: (value: string) => void
}

/**
 * Parse a union of string literals like `'left' | 'right' | 'center'` into an array of options.
 * Returns null if the type is not a pure string-literal union.
 */
function parseStringLiteralUnion(type: string): string[] | null {
	const parts = type.split('|').map(s => s.trim())
	const values: string[] = []
	for (const part of parts) {
		const match = part.match(/^['"](.+)['"]$/)
		if (!match) return null
		values.push(match[1]!)
	}
	return values.length > 0 ? values : null
}

/**
 * Parse Reference<'collectionName'> and return the collection name, or null.
 */
function parseReference(type: string): string | null {
	const match = type.match(/^Reference\s*<\s*['"](\w+)['"]\s*>$/)
	return match?.[1] ?? null
}

const INPUT_TYPES: Record<string, string> = { number: 'number', url: 'url', date: 'date', datetime: 'datetime-local', time: 'time', email: 'email' }

function renderPropInput(prop: ComponentProp, value: string, onChange: (value: string) => void) {
	const typeLower = prop.type.toLowerCase()
	const unionOptions = parseStringLiteralUnion(prop.type)
	const referenceCollection = parseReference(prop.type)

	if (typeLower === 'boolean') {
		return (
			<label class="flex items-center gap-2 cursor-pointer">
				<input
					type="checkbox"
					checked={value === 'true'}
					onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
					class="accent-cms-primary w-5 h-5 rounded"
				/>
				<span class="text-[13px] text-white">
					{value === 'true' ? 'Enabled' : 'Disabled'}
				</span>
			</label>
		)
	}

	if (referenceCollection) {
		return <ReferenceSelect collection={referenceCollection} value={value} required={prop.required} onChange={onChange} />
	}

	if (unionOptions) {
		return (
			<select
				value={value}
				onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
				class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
			>
				{!prop.required && <option value="">— None —</option>}
				{unionOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
			</select>
		)
	}

	if (typeLower === 'image') {
		return (
			<div class="flex gap-2">
				<input
					type="text"
					value={value}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					placeholder={prop.defaultValue || 'Select an image...'}
					class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
				/>
				<button
					type="button"
					onClick={() => {
						openMediaLibraryWithCallback((url: string) => {
							onChange(url)
						})
					}}
					class="px-3 py-2.5 bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/15 rounded-cms-md transition-colors shrink-0"
					title="Browse media"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
						/>
					</svg>
				</button>
			</div>
		)
	}

	if (typeLower === 'color') {
		return (
			<div class="flex gap-2 items-center">
				<input
					type="color"
					value={value || '#000000'}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					class="w-10 h-10 rounded-cms-md border border-white/20 bg-transparent cursor-pointer"
				/>
				<input
					type="text"
					value={value}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					placeholder={prop.defaultValue || '#000000'}
					class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md font-mono"
				/>
			</div>
		)
	}

	if (typeLower === 'textarea') {
		return (
			<textarea
				value={value}
				onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
				placeholder={prop.defaultValue || `Enter ${prop.name}...`}
				rows={3}
				class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md resize-y"
			/>
		)
	}

	return (
		<input
			type={INPUT_TYPES[typeLower] ?? 'text'}
			value={value}
			onInput={(e) => onChange((e.target as HTMLInputElement).value)}
			placeholder={prop.defaultValue || `Enter ${prop.name}...`}
			class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
		/>
	)
}

export function PropEditor({ prop, value, onChange }: PropEditorProps) {
	return (
		<div class="mb-4">
			<label class="block text-[13px] font-medium text-white mb-1.5">
				{prop.name}
				{prop.required && <span class="text-cms-error ml-1">*</span>}
			</label>
			{prop.description && (
				<div class="text-[11px] text-white/50 mb-1.5">
					{prop.description}
				</div>
			)}
			{renderPropInput(prop, value, onChange)}
			<div class="text-[10px] text-white/40 mt-1.5 font-mono">
				{prop.type}
			</div>
		</div>
	)
}

function ReferenceSelect({ collection, value, required, onChange }: {
	collection: string
	value: string
	required: boolean
	onChange: (value: string) => void
}) {
	const currentManifest = manifest.value
	const options = useMemo(
		() => currentManifest ? getCollectionEntryOptions(currentManifest, collection) : [],
		[collection, currentManifest],
	)
	const collectionDef = currentManifest?.collectionDefinitions?.[collection]
	const containerRef = useRef<HTMLDivElement>(null)
	const [search, setSearch] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [newName, setNewName] = useState('')
	const [formData, setFormData] = useState<Record<string, unknown>>({})

	const filtered = useMemo(
		() => search
			? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || o.value.toLowerCase().includes(search.toLowerCase()))
			: options,
		[options, search],
	)

	const selectedLabel = useMemo(
		() => value ? (options.find(o => o.value === value)?.label ?? value) : '',
		[options, value],
	)

	const formFields = useMemo(
		() => collectionDef?.fields.filter(f => !f.hidden && f.name !== 'title' && f.name !== 'name') ?? [],
		[collectionDef],
	)

	const resetCreateForm = () => {
		setIsCreating(false)
		setNewName('')
		setFormData({})
	}

	const handleCreate = () => {
		if (!collectionDef || !newName.trim()) return
		const slug = slugify(newName.trim())
		// Queue entry for creation when markdown is saved — no file write, no reload
		pendingCollectionEntries.value = [
			...pendingCollectionEntries.value,
			{
				collection,
				slug,
				title: newName.trim(),
				frontmatter: { ...formData },
				fileExtension: collectionDef.fileExtension,
			},
		]
		onChange(slug)
		resetCreateForm()
	}

	if (isCreating) {
		const slug = slugify(newName.trim())
		return (
			<div class="p-3 bg-white/5 border border-white/15 rounded-cms-md space-y-3">
				<div class="flex items-center justify-between">
					<span class="text-[12px] font-medium text-white/70">Create new entry</span>
					{options.length > 0 && (
						<button
							type="button"
							onClick={resetCreateForm}
							class="text-[11px] text-white/40 hover:text-white transition-colors"
						>
							Select existing
						</button>
					)}
				</div>
				<input
					type="text"
					value={newName}
					onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
					placeholder="Enter name..."
					class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
					autoFocus
				/>
				<div class="text-[11px] text-white/40 font-mono">
					src/content/{collection}/{slug || 'your-slug'}.{collectionDef?.fileExtension ?? 'json'}
				</div>
				{/* Collection fields */}
				{formFields.length > 0 && (
					<div class="space-y-3 pt-1 border-t border-white/10">
						{formFields.map((field) => (
							<SchemaFrontmatterField
								key={field.name}
								field={field}
								value={formData[field.name]}
								onChange={(newValue) => setFormData(prev => ({ ...prev, [field.name]: newValue }))}
							/>
						))}
					</div>
				)}
				<div class="flex gap-2 pt-1">
					<button
						type="button"
						onClick={resetCreateForm}
						class="px-3 py-1.5 text-[12px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-cms-md transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleCreate}
						disabled={!newName.trim()}
						class="px-3 py-1.5 text-[12px] bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover rounded-cms-md transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Create
					</button>
				</div>
			</div>
		)
	}

	if (options.length === 0 && !collectionDef) {
		return (
			<input
				type="text"
				value={value}
				onInput={(e) => onChange((e.target as HTMLInputElement).value)}
				placeholder={`Enter ${collection} entry ID...`}
				class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
			/>
		)
	}

	return (
		<div class="relative" ref={containerRef}>
			<input
				type="text"
				value={isOpen ? search : selectedLabel}
				onInput={(e) => {
					setSearch((e.target as HTMLInputElement).value)
					setIsOpen(true)
				}}
				onFocus={() => setIsOpen(true)}
				onBlur={(e) => {
					const related = (e as FocusEvent).relatedTarget as Node | null
					if (containerRef.current && related && containerRef.current.contains(related)) return
					setIsOpen(false)
				}}
				placeholder={`Select ${collection} entry...`}
				class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
			/>
			{isOpen && (
				<div class="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-cms-dark border border-white/20 rounded-cms-md shadow-lg">
					{!required && (
						<button
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								onChange('')
								setSearch('')
								setIsOpen(false)
							}}
							class="w-full px-4 py-2 text-left text-[13px] text-white/50 hover:bg-white/10 transition-colors"
						>
							— None —
						</button>
					)}
					{filtered.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								onChange(opt.value)
								setSearch('')
								setIsOpen(false)
							}}
							class={`w-full px-4 py-2 text-left text-[13px] transition-colors ${
								opt.value === value ? 'bg-cms-primary/20 text-white' : 'text-white/80 hover:bg-white/10'
							}`}
						>
							<div>{opt.label}</div>
							{opt.label !== opt.value && <div class="text-[11px] text-white/40 font-mono">{opt.value}</div>}
						</button>
					))}
					{filtered.length === 0 && <div class="px-4 py-2 text-[13px] text-white/40">No entries found</div>}
					{collectionDef && (
						<button
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								setIsCreating(true)
								setIsOpen(false)
							}}
							class="w-full px-4 py-2 text-left text-[13px] text-cms-primary hover:bg-cms-primary/10 transition-colors border-t border-white/10 flex items-center gap-2"
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Create new {collectionDef.label?.toLowerCase() ?? collection}
						</button>
					)}
				</div>
			)}
		</div>
	)
}
