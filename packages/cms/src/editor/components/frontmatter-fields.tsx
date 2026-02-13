import { useState } from 'preact/hooks'
import { markdownEditorState, openMediaLibraryWithCallback, updateMarkdownFrontmatter } from '../signals'
import type { CollectionDefinition, FieldDefinition, MarkdownPageEntry } from '../types'
import { ComboBoxField, ImageField, NumberField, TextField, ToggleField } from './fields'

// ============================================================================
// Generic Frontmatter Field (auto-detect by value type)
// ============================================================================

interface FrontmatterFieldProps {
	fieldKey: string
	value: unknown
	onChange: (value: unknown) => void
}

export function FrontmatterField({
	fieldKey,
	value,
	onChange,
}: FrontmatterFieldProps) {
	// Format field key as label (e.g., "featuredImage" -> "Featured Image")
	const label = fieldKey
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (str) => str.toUpperCase())
		.trim()

	// Detect field type based on value
	const isBoolean = typeof value === 'boolean'
	const isDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
	const isArray = Array.isArray(value)

	// Boolean field - checkbox
	if (isBoolean) {
		return (
			<label
				class="flex items-center gap-2 text-sm text-white/80 cursor-pointer"
				data-cms-ui
			>
				<input
					type="checkbox"
					checked={value}
					onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
					class="w-4 h-4 rounded border-white/20 bg-white/10 text-cms-primary focus:ring-cms-primary focus:ring-offset-0 cursor-pointer"
					data-cms-ui
				/>
				{label}
			</label>
		)
	}

	// Date field
	if (isDate) {
		return (
			<div class="flex flex-col gap-1" data-cms-ui>
				<label class="text-xs text-white/60 font-medium">{label}</label>
				<input
					type="date"
					value={typeof value === 'string' ? value.split('T')[0] : ''}
					onChange={(e) => onChange((e.target as HTMLInputElement).value)}
					class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white focus:outline-none focus:border-cms-primary"
					data-cms-ui
				/>
			</div>
		)
	}

	// Array field (e.g., categories) - comma-separated input
	if (isArray) {
		return (
			<div class="flex flex-col gap-1 col-span-2" data-cms-ui>
				<label class="text-xs text-white/60 font-medium">{label}</label>
				<input
					type="text"
					value={(value as unknown[]).join(', ')}
					onChange={(e) => {
						const inputValue = (e.target as HTMLInputElement).value
						const arrayValue = inputValue
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
						onChange(arrayValue)
					}}
					placeholder={`Enter ${label.toLowerCase()} separated by commas`}
					class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-cms-primary"
					data-cms-ui
				/>
			</div>
		)
	}

	// Object field - render nested fields with add/remove
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return (
			<ObjectFields
				label={label}
				value={value as Record<string, unknown>}
				onChange={onChange}
			/>
		)
	}

	// String field (default) - check if it's a long text (excerpt, etc.)
	const isLongText = fieldKey.toLowerCase().includes('excerpt')
		|| fieldKey.toLowerCase().includes('description')
		|| (typeof value === 'string' && value.length > 100)

	if (isLongText) {
		return (
			<div class="flex flex-col gap-1 col-span-2" data-cms-ui>
				<label class="text-xs text-white/60 font-medium">{label}</label>
				<textarea
					value={typeof value === 'string' ? value : ''}
					onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
					rows={3}
					class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-cms-primary resize-none"
					data-cms-ui
				/>
			</div>
		)
	}

	// Default text input
	return (
		<div class="flex flex-col gap-1" data-cms-ui>
			<label class="text-xs text-white/60 font-medium">{label}</label>
			<input
				type="text"
				value={typeof value === 'string' ? value : String(value ?? '')}
				onChange={(e) => onChange((e.target as HTMLInputElement).value)}
				class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-cms-primary"
				data-cms-ui
			/>
		</div>
	)
}

// ============================================================================
// Create Mode Frontmatter — schema-aware field rendering
// ============================================================================

interface CreateModeFrontmatterProps {
	page: MarkdownPageEntry
	collectionDefinition: CollectionDefinition
	onSlugManualEdit: () => void
}

export function CreateModeFrontmatter({
	page,
	collectionDefinition,
	onSlugManualEdit,
}: CreateModeFrontmatterProps) {
	return (
		<div class="space-y-4">
			{/* Slug field */}
			<div>
				<label class="block text-xs font-medium text-white/70 mb-1.5">
					URL Slug
				</label>
				<input
					type="text"
					value={page.slug}
					onInput={(e) => {
						onSlugManualEdit()
						const slug = (e.target as HTMLInputElement).value
						markdownEditorState.value = {
							...markdownEditorState.value,
							currentPage: markdownEditorState.value.currentPage
								? { ...markdownEditorState.value.currentPage, slug }
								: null,
						}
					}}
					placeholder="url-friendly-slug"
					class="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10"
					data-cms-ui
				/>
				<p class="mt-1 text-xs text-white/40">
					Will be saved to: src/content/{collectionDefinition.name}/
					{page.slug || 'your-slug'}.{collectionDefinition.fileExtension}
				</p>
			</div>

			{/* Schema fields */}
			<div class="grid grid-cols-2 gap-4">
				{collectionDefinition.fields.map((field) => (
					<SchemaFrontmatterField
						key={field.name}
						field={field}
						value={page.frontmatter[field.name]}
						onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
					/>
				))}
			</div>
		</div>
	)
}

// ============================================================================
// Edit Mode Frontmatter — uses schema fields when available, falls back to generic
// ============================================================================

interface EditModeFrontmatterProps {
	page: MarkdownPageEntry
	collectionDefinition?: CollectionDefinition
}

export function EditModeFrontmatter({
	page,
	collectionDefinition,
}: EditModeFrontmatterProps) {
	// Collect schema field names for filtering extra keys
	const schemaFieldNames = new Set(
		collectionDefinition?.fields.map((f) => f.name) ?? [],
	)
	// Frontmatter keys not covered by the schema (user-added fields)
	const extraKeys = Object.keys(page.frontmatter).filter(
		(key) => !schemaFieldNames.has(key),
	)

	return (
		<div class="space-y-4">
			{/* Slug field (always disabled in edit mode) */}
			<div>
				<label class="block text-xs font-medium text-white/70 mb-1.5">
					URL Slug
				</label>
				<input
					type="text"
					value={page.slug}
					class="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm text-sm text-white/50 focus:outline-none cursor-not-allowed"
					disabled
					data-cms-ui
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				{collectionDefinition
					? (
						<>
							{/* Schema-aware fields */}
							{collectionDefinition.fields.map((field) => (
								<SchemaFrontmatterField
									key={field.name}
									field={field}
									value={page.frontmatter[field.name]}
									onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
								/>
							))}
							{/* Extra fields not in schema */}
							{extraKeys.map((key) => (
								<FrontmatterField
									key={key}
									fieldKey={key}
									value={page.frontmatter[key]}
									onChange={(newValue) => updateMarkdownFrontmatter({ [key]: newValue })}
								/>
							))}
						</>
					)
					: (
						/* Generic fallback when no schema is available */
						Object.entries(page.frontmatter).map(([key, value]) => (
							<FrontmatterField
								key={key}
								fieldKey={key}
								value={value}
								onChange={(newValue) => updateMarkdownFrontmatter({ [key]: newValue })}
							/>
						))
					)}
			</div>
		</div>
	)
}

// ============================================================================
// Schema-aware Frontmatter Field
// ============================================================================

interface SchemaFrontmatterFieldProps {
	field: FieldDefinition
	value: unknown
	onChange: (value: unknown) => void
}

export function SchemaFrontmatterField({
	field,
	value,
	onChange,
}: SchemaFrontmatterFieldProps) {
	const label = formatFieldLabel(field.name)

	switch (field.type) {
		case 'text':
		case 'url':
			return (
				<TextField
					label={label}
					value={(value as string) ?? ''}
					placeholder={getPlaceholder(field)}
					onChange={(v) => onChange(v)}
				/>
			)

		case 'image':
			return (
				<ImageField
					label={label}
					value={(value as string) ?? ''}
					placeholder={getPlaceholder(field)}
					onChange={(v) => onChange(v)}
					onBrowse={() => {
						openMediaLibraryWithCallback((url: string) => {
							onChange(url)
						})
					}}
				/>
			)

		case 'textarea':
			return (
				<div class="flex flex-col gap-1 col-span-2" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<textarea
						value={(value as string) ?? ''}
						onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
						placeholder={getPlaceholder(field)}
						rows={3}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40 resize-none"
						data-cms-ui
					/>
				</div>
			)

		case 'date':
			return (
				<div class="flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type="date"
						value={(value as string) ?? ''}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white focus:outline-none focus:border-white/40"
						data-cms-ui
					/>
				</div>
			)

		case 'number':
			return (
				<NumberField
					label={label}
					value={(value as number) ?? undefined}
					onChange={(v) => onChange(v ?? 0)}
				/>
			)

		case 'boolean':
			return (
				<ToggleField
					label={label}
					value={!!value}
					onChange={(v) => onChange(v)}
				/>
			)

		case 'select':
			return (
				<ComboBoxField
					label={label}
					value={(value as string) ?? ''}
					placeholder={getPlaceholder(field)}
					options={(field.options ?? []).map((opt) => ({
						value: opt,
						label: opt,
					}))}
					onChange={(v) => onChange(v)}
				/>
			)

		case 'array': {
			const items = Array.isArray(value) ? value : []
			if (field.options && field.options.length > 0) {
				return (
					<div class="col-span-2 space-y-1.5" data-cms-ui>
						<label class="text-xs text-white/60 font-medium">{label}</label>
						<div class="space-y-2">
							{field.options.map((opt) => (
								<label key={opt} class="flex items-center gap-2 cursor-pointer">
									<input
										type="checkbox"
										checked={items.includes(opt)}
										onChange={(e) => {
											if ((e.target as HTMLInputElement).checked) {
												onChange([...items, opt])
											} else {
												onChange(items.filter((i: unknown) => i !== opt))
											}
										}}
										class="rounded border-white/20 bg-white/10 text-cms-primary focus:ring-cms-primary"
										data-cms-ui
									/>
									<span class="text-sm text-white/80">{opt}</span>
								</label>
							))}
						</div>
					</div>
				)
			}
			return (
				<div class="col-span-2 flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type="text"
						value={(items as unknown[]).join(', ')}
						onInput={(e) => {
							const inputValue = (e.target as HTMLInputElement).value
							const arrayValue = inputValue
								.split(',')
								.map((s) => s.trim())
								.filter(Boolean)
							onChange(arrayValue)
						}}
						placeholder={`Enter ${label.toLowerCase()} separated by commas`}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
						data-cms-ui
					/>
				</div>
			)
		}

		case 'object': {
			const obj = (value ?? {}) as Record<string, unknown>
			const nestedFields = field.fields ?? []
			if (nestedFields.length > 0) {
				// Schema-defined nested fields + any extra keys from the actual value
				const schemaNames = new Set(nestedFields.map((f) => f.name))
				const extraKeys = Object.keys(obj).filter((k) => !schemaNames.has(k))
				return (
					<ObjectFields
						label={label}
						value={obj}
						onChange={onChange}
						schemaFields={nestedFields}
						extraKeys={extraKeys}
					/>
				)
			}
			return (
				<ObjectFields
					label={label}
					value={obj}
					onChange={onChange}
				/>
			)
		}

		default:
			return (
				<div class="flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type="text"
						value={String(value ?? '')}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
						data-cms-ui
					/>
				</div>
			)
	}
}

// ============================================================================
// Object Fields — renders nested fields with add/remove key support
// ============================================================================

interface ObjectFieldsProps {
	label: string
	value: Record<string, unknown>
	onChange: (value: unknown) => void
	schemaFields?: FieldDefinition[]
	extraKeys?: string[]
}

function ObjectFields({ label, value, onChange, schemaFields, extraKeys }: ObjectFieldsProps) {
	const [newKey, setNewKey] = useState('')
	const obj = value ?? {}

	const handleRemoveKey = (key: string) => {
		const { [key]: _, ...rest } = obj
		onChange(rest)
	}

	const handleAddKey = () => {
		const trimmed = newKey.trim()
		if (!trimmed || trimmed in obj) return
		onChange({ ...obj, [trimmed]: '' })
		setNewKey('')
	}

	return (
		<div class="flex flex-col gap-2 col-span-2" data-cms-ui>
			<label class="text-xs text-white/60 font-medium">{label}</label>
			<div class="space-y-2 pl-3 border-l-2 border-white/10">
				{schemaFields
					? (
						<>
							{schemaFields.map((subField) => (
								<div key={subField.name} class="flex items-end gap-2">
									<div class="flex-1 min-w-0">
										<SchemaFrontmatterField
											field={subField}
											value={obj[subField.name]}
											onChange={(newValue) => onChange({ ...obj, [subField.name]: newValue })}
										/>
									</div>
								</div>
							))}
							{(extraKeys ?? []).map((key) => (
								<div key={key} class="flex items-end gap-2">
									<div class="flex-1 min-w-0">
										<FrontmatterField
											fieldKey={key}
											value={obj[key]}
											onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
										/>
									</div>
									<button
										type="button"
										onClick={() => handleRemoveKey(key)}
										class="p-1 mb-1 text-white/30 hover:text-red-400 transition-colors shrink-0"
										title={`Remove ${key}`}
										data-cms-ui
									>
										<RemoveIcon />
									</button>
								</div>
							))}
						</>
					)
					: Object.entries(obj).map(([key, subValue]) => (
						<div key={key} class="flex items-end gap-2">
							<div class="flex-1 min-w-0">
								<FrontmatterField
									fieldKey={key}
									value={subValue}
									onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
								/>
							</div>
							<button
								type="button"
								onClick={() => handleRemoveKey(key)}
								class="p-1 mb-1 text-white/30 hover:text-red-400 transition-colors shrink-0"
								title={`Remove ${key}`}
								data-cms-ui
							>
								<RemoveIcon />
							</button>
						</div>
					))}
				{/* Add new key */}
				<div class="flex items-center gap-2 pt-1">
					<input
						type="text"
						value={newKey}
						onInput={(e) => setNewKey((e.target as HTMLInputElement).value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault()
								handleAddKey()
							}
						}}
						placeholder="New field name..."
						class="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
						data-cms-ui
					/>
					<button
						type="button"
						onClick={handleAddKey}
						disabled={!newKey.trim() || newKey.trim() in obj}
						class="px-2 py-1 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-cms-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
						data-cms-ui
					>
						+ Add
					</button>
				</div>
			</div>
		</div>
	)
}

function RemoveIcon() {
	return (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		</svg>
	)
}

// ============================================================================
// Helper Functions
// ============================================================================

export function formatFieldLabel(name: string): string {
	return name
		.replace(/([A-Z])/g, ' $1')
		.replace(/[-_]/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim()
}

export function getPlaceholder(field: FieldDefinition): string {
	if (field.examples && field.examples.length > 0) {
		return String(field.examples[0])
	}
	switch (field.type) {
		case 'url':
			return 'https://...'
		case 'image':
			return '/images/...'
		case 'date':
			return 'YYYY-MM-DD'
		default:
			return `Enter ${formatFieldLabel(field.name).toLowerCase()}...`
	}
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
}
