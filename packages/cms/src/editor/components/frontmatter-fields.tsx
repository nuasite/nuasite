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
