import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { cn } from '../lib/cn'
import { buildAstroUploadContext, getCollectionEntryOptions } from '../manifest'
import { renameMarkdownPage } from '../markdown-api'
import {
	config,
	manifest,
	markdownEditorState,
	openMediaLibraryWithCallback,
	showToast,
	updateMarkdownFrontmatter,
	updateMarkdownPageMeta,
} from '../signals'
import { STRINGS } from '../strings'
import type { CollectionDefinition, FieldDefinition, MarkdownPageEntry } from '../types'
import { ColorField, ComboBoxField, FileField, ImageField, MultiSelectField, NumberField, TextField, ToggleField } from './fields'
import { groupFields } from './frontmatter-sidebar'

function isArrayOfObjects(value: unknown[]): value is Record<string, unknown>[] {
	return value.length > 0 && typeof value[0] === 'object' && value[0] !== null
}

/** Checkbox below a URL field that toggles opening the link in a new tab. */
function OpenInNewTabToggle({ field }: { field: FieldDefinition }) {
	const fm = markdownEditorState.value.currentPage?.frontmatter ?? {}
	const targetKey = `${field.name}OpenInNewTab`
	const isChecked = fm[targetKey] === true
	return (
		<label class="flex items-center gap-2 mt-2 text-xs text-white/70 cursor-pointer w-fit" data-cms-ui>
			<input
				type="checkbox"
				checked={isChecked}
				onChange={(e) => updateMarkdownFrontmatter({ [targetKey]: (e.target as HTMLInputElement).checked })}
				class="sr-only peer"
				data-cms-ui
			/>
			<span
				class={cn(
					'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
					isChecked ? 'bg-cms-primary border-cms-primary' : 'border-white/30 bg-white/5',
				)}
			>
				{isChecked && (
					<svg class="w-3 h-3 text-cms-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
					</svg>
				)}
			</span>
			Open in new tab
		</label>
	)
}

function FieldGroupHeader({ group, children }: { group: string | null; children: ComponentChildren }) {
	return (
		<>
			{group && (
				<div class="col-span-2 pt-2" data-cms-ui>
					<h4 class="text-xs uppercase tracking-wider text-white/40 font-medium">{group}</h4>
					<div class="border-t border-white/10 mt-1.5" />
				</div>
			)}
			{children}
		</>
	)
}

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
	const label = formatFieldLabel(fieldKey)

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
					class="sr-only peer"
					data-cms-ui
				/>
				<span
					class={cn(
						'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
						value ? 'bg-cms-primary border-cms-primary' : 'border-white/30 bg-white/5',
					)}
				>
					{value && (
						<svg class="w-3 h-3 text-cms-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
						</svg>
					)}
				</span>
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
					class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white focus:outline-none focus:border-white/40"
					data-cms-ui
				/>
			</div>
		)
	}

	// Array field (e.g., categories)
	if (isArray) {
		const items = value as unknown[]
		if (isArrayOfObjects(items)) {
			return (
				<ArrayOfObjectsField
					label={label}
					items={items as Record<string, unknown>[]}
					onChange={onChange}
				/>
			)
		}
		// Array of primitives — comma-separated input
		const stringItems = items.map(v => typeof v === 'string' ? v : String(v))
		return (
			<div class="flex flex-col gap-1 col-span-2" data-cms-ui>
				<label class="text-xs text-white/60 font-medium">{label}</label>
				<input
					type="text"
					value={stringItems.join(', ')}
					onChange={(e) => {
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
					class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40 resize-none"
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
				class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
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
	fields?: FieldDefinition[]
	onSlugManualEdit: () => void
}

export function CreateModeFrontmatter({
	page,
	collectionDefinition,
	fields,
	onSlugManualEdit,
}: CreateModeFrontmatterProps) {
	const allFields = fields ?? collectionDefinition.fields
	const allFieldNames = new Set(allFields.map((f) => f.name))
	const urlFieldNames = new Set(allFields.filter((f) => f.type === 'url' || /link|href|url/i.test(f.name)).map((f) => f.name))
	const isOpenInNewTabSibling = (name: string) => {
		if (!name.endsWith('OpenInNewTab')) return false
		const base = name.slice(0, -'OpenInNewTab'.length)
		return urlFieldNames.has(base)
	}
	// In create mode, skip complex fields (arrays, objects) — they can be edited after creation
	// Draft is always rendered in the sidebar — never inline in the header.
	// `*OpenInNewTab` siblings are handled by the OpenInNewTabToggle next to the URL field.
	const displayFields = allFields.filter(f => f.type !== 'array' && f.type !== 'object' && f.name !== 'draft' && !isOpenInNewTabSibling(f.name))
	const groups = groupFields(displayFields)

	return (
		<div class="space-y-4">
			{/* Slug field */}
			<div>
				<div class="flex items-center gap-1.5 mb-1.5">
					<label class="block text-xs font-medium text-white/70">URL Slug</label>
					<span class="relative group/tt inline-flex" data-cms-ui>
						<svg class="w-3.5 h-3.5 text-white/40 hover:text-white/70 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<span class="absolute left-0 top-full mt-1 w-72 p-2 bg-black/90 text-white text-xs rounded-cms-sm opacity-0 invisible group-hover/tt:opacity-100 group-hover/tt:visible transition-all z-50 pointer-events-none whitespace-normal break-all">
							Will be saved to: src/content/{collectionDefinition.name}/{page.slug || 'your-slug'}.{collectionDefinition.fileExtension}
						</span>
					</span>
				</div>
				<label class="flex items-center gap-1 px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm focus-within:border-white/40 focus-within:ring-1 focus-within:ring-white/10">
					<span class="text-white/40 text-sm shrink-0">/</span>
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
						class="flex-1 bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
						data-cms-ui
					/>
				</label>
			</div>

			{/* Schema fields */}
			<div class="grid grid-cols-2 gap-4">
				{groups.map((group, gi) => (
					<FieldGroupHeader key={gi} group={group.group}>
						{group.fields.map((field) => (
							<SchemaFrontmatterField
								key={field.name}
								field={field}
								value={page.frontmatter[field.name]}
								onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
								collection={collectionDefinition.name}
								entrySlug={page.slug}
								hasOpenInNewTabSibling={allFieldNames.has(`${field.name}OpenInNewTab`)}
							/>
						))}
					</FieldGroupHeader>
				))}
			</div>
		</div>
	)
}

// ============================================================================
// Edit Mode Frontmatter — uses schema fields when available, falls back to generic
// ============================================================================

function SlugField({ page }: { page: MarkdownPageEntry }) {
	const [localSlug, setLocalSlug] = useState(page.slug)
	const [isRenaming, setIsRenaming] = useState(false)
	const isDirty = localSlug !== page.slug

	useEffect(() => {
		setLocalSlug(page.slug)
	}, [page.slug])

	const handleRename = async () => {
		if (!isDirty || isRenaming) return
		const trimmed = localSlug.trim()
		if (!trimmed) {
			setLocalSlug(page.slug)
			return
		}
		setIsRenaming(true)
		try {
			const result = await renameMarkdownPage(config.value, page.filePath, trimmed)
			if (result.success && result.newSlug && result.newFilePath) {
				updateMarkdownPageMeta({ slug: result.newSlug, filePath: result.newFilePath })
				setLocalSlug(result.newSlug)
				showToast(STRINGS.slug.updated, 'success')
			} else {
				showToast(result.error || STRINGS.slug.renameFailed, 'error')
				setLocalSlug(page.slug)
			}
		} catch {
			showToast(STRINGS.slug.renameFailed, 'error')
			setLocalSlug(page.slug)
		} finally {
			setIsRenaming(false)
		}
	}

	return (
		<div>
			<label class="block text-xs font-medium text-white/70 mb-1.5">
				URL Slug
			</label>
			<label
				class={cn(
					'flex items-center gap-1 px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white focus-within:border-white/40',
					isDirty ? 'border-white/30' : 'border-white/20',
					isRenaming && 'opacity-60',
				)}
			>
				<span class="text-white/40 text-sm shrink-0">/</span>
				<input
					type="text"
					value={localSlug}
					onInput={(e) => setLocalSlug((e.target as HTMLInputElement).value)}
					onBlur={handleRename}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault()
							;(e.target as HTMLInputElement).blur()
						}
					}}
					class="flex-1 bg-transparent focus:outline-none"
					disabled={isRenaming}
					data-cms-ui
				/>
			</label>
		</div>
	)
}

interface EditModeFrontmatterProps {
	page: MarkdownPageEntry
	collectionDefinition?: CollectionDefinition
	fields?: FieldDefinition[]
}

export function EditModeFrontmatter({
	page,
	collectionDefinition,
	fields,
}: EditModeFrontmatterProps) {
	const allFields = fields ?? collectionDefinition?.fields ?? []
	const allFieldNames = new Set(allFields.map((f) => f.name))
	const urlFieldNames = new Set(allFields.filter((f) => f.type === 'url' || /link|href|url/i.test(f.name)).map((f) => f.name))
	const isOpenInNewTabSibling = (name: string) => {
		if (!name.endsWith('OpenInNewTab')) return false
		const base = name.slice(0, -'OpenInNewTab'.length)
		return urlFieldNames.has(base)
	}
	const displayFields = allFields.filter((f) => f.name !== 'draft' && !isOpenInNewTabSibling(f.name))
	// Collect schema field names for filtering extra keys
	const schemaFieldNames = new Set(
		collectionDefinition?.fields.map((f) => f.name) ?? [],
	)
	// Frontmatter keys not covered by the schema (user-added fields). Draft and the
	// `*OpenInNewTab` siblings are rendered separately, so exclude them here.
	const extraKeys = Object.keys(page.frontmatter).filter(
		(key) => !schemaFieldNames.has(key) && key !== 'draft' && !isOpenInNewTabSibling(key),
	)
	const groups = groupFields(displayFields)

	return (
		<div class="space-y-4">
			{/* Slug field */}
			<SlugField page={page} />
			<div class="grid grid-cols-2 gap-4">
				{collectionDefinition
					? (
						<>
							{groups.map((group, gi) => (
								<FieldGroupHeader key={gi} group={group.group}>
									{group.fields.map((field) => (
										<SchemaFrontmatterField
											key={field.name}
											field={field}
											value={page.frontmatter[field.name]}
											onChange={(newValue) => updateMarkdownFrontmatter({ [field.name]: newValue })}
											collection={collectionDefinition.name}
											entrySlug={page.slug}
											hasOpenInNewTabSibling={allFieldNames.has(`${field.name}OpenInNewTab`)}
										/>
									))}
								</FieldGroupHeader>
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
	/** Required when editing an `astroImage` field — routes uploads to the entry's directory. */
	collection?: string
	entrySlug?: string
	/** True when the schema declares a `${field.name}OpenInNewTab` companion boolean — controls toggle visibility next to URL fields. */
	hasOpenInNewTabSibling?: boolean
}

export function SchemaFrontmatterField({
	field,
	value,
	onChange,
	collection,
	entrySlug,
	hasOpenInNewTabSibling,
}: SchemaFrontmatterFieldProps) {
	const label = field.required ? `${formatFieldLabel(field.name)} *` : formatFieldLabel(field.name)
	const hints = field.hints

	switch (field.type) {
		case 'text':
		case 'url':
		case 'email': {
			const isLinkLike = field.type === 'url'
				|| /link|href|url/i.test(field.name)
			const linkTooltip = isLinkLike
				? 'Use https://... for external links, or /path for internal pages.'
				: undefined
			return (
				<>
					<TextField
						label={label}
						value={(value as string) ?? ''}
						placeholder={hints?.placeholder ?? getPlaceholder(field)}
						maxLength={hints?.maxLength as number | undefined}
						minLength={hints?.minLength as number | undefined}
						onChange={(v) => onChange(v)}
						inputType={field.type === 'text' ? undefined : field.type}
						required={field.required}
						tooltip={linkTooltip}
					/>
					{field.type === 'url' && hasOpenInNewTabSibling && <OpenInNewTabToggle field={field} />}
				</>
			)
		}

		case 'image': {
			const astroContext = buildAstroUploadContext(field, collection, entrySlug)
			return (
				<ImageField
					label={label}
					value={(value as string) ?? ''}
					onChange={(v) => onChange(v)}
					onBrowse={() => {
						openMediaLibraryWithCallback((url: string) => {
							onChange(url)
						}, astroContext)
					}}
				/>
			)
		}

		case 'file': {
			return (
				<FileField
					label={label}
					value={(value as string) ?? ''}
					accept={hints?.accept as string | undefined}
					onChange={(v) => onChange(v)}
					onBrowse={() => {
						openMediaLibraryWithCallback((url: string) => {
							onChange(url)
						})
					}}
				/>
			)
		}

		case 'color':
			return (
				<ColorField
					label={label}
					value={(value as string) ?? ''}
					placeholder={getPlaceholder(field)}
					onChange={(v) => onChange(v)}
					required={field.required}
				/>
			)

		case 'textarea':
			return (
				<div class="flex flex-col gap-1 col-span-2" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<textarea
						value={(value as string) ?? ''}
						onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
						placeholder={hints?.placeholder ?? getPlaceholder(field)}
						rows={hints?.rows ?? 3}
						maxLength={hints?.maxLength as number | undefined}
						required={field.required}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40 resize-none"
						data-cms-ui
					/>
				</div>
			)

		case 'date': {
			// A `date` field's value is often a full datetime (e.g. "2026-04-14T08:35:00"),
			// which an <input type="date"> can't display (it needs YYYY-MM-DD). Show only the
			// date part, but preserve the original time component on change so editing the date
			// doesn't silently drop the time.
			const raw = value == null ? '' : String(value)
			// Preserve the full time component on change — including fractional seconds and any
			// timezone designator (Z or ±HH:MM) — so editing only the date never drops them.
			const timeSuffix = raw.match(/T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/)?.[0] ?? ''
			return (
				<div class="flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type="date"
						value={raw.slice(0, 10)}
						min={hints?.min != null ? String(hints.min) : undefined}
						max={hints?.max != null ? String(hints.max) : undefined}
						required={field.required}
						onInput={(e) => {
							const d = (e.target as HTMLInputElement).value
							onChange(d ? `${d}${timeSuffix}` : '')
						}}
						class="px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-cms-sm text-white focus:outline-none focus:border-white/40"
						data-cms-ui
					/>
				</div>
			)
		}

		case 'datetime':
		case 'time':
		case 'month':
			return (
				<div class="flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type={field.type === 'datetime' ? 'datetime-local' : field.type}
						value={(value as string) ?? ''}
						min={hints?.min != null ? String(hints.min) : undefined}
						max={hints?.max != null ? String(hints.max) : undefined}
						required={field.required}
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
					placeholder={hints?.placeholder}
					min={typeof hints?.min === 'number' ? hints.min : undefined}
					max={typeof hints?.max === 'number' ? hints.max : undefined}
					step={hints?.step}
					onChange={(v) => onChange(v ?? 0)}
					required={field.required}
				/>
			)

		case 'year':
			return (
				<div class="flex flex-col gap-1.5" data-cms-ui>
					<label class="text-xs font-medium text-white/70">{label}</label>
					<input
						type="number"
						value={typeof value === 'number' ? value : ''}
						placeholder={hints?.placeholder ?? String(new Date().getFullYear())}
						min={typeof hints?.min === 'number' ? hints.min : 1900}
						max={typeof hints?.max === 'number' ? hints.max : 2100}
						step={1}
						required={field.required}
						onInput={(e) => {
							const raw = (e.target as HTMLInputElement).value
							onChange(raw === '' ? undefined : Number(raw))
						}}
						class="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-colors"
						data-cms-ui
					/>
				</div>
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
					required={field.required}
				/>
			)

		case 'reference': {
			const refOptions = getCollectionEntryOptions(manifest.value, field.collection)
			return (
				<ComboBoxField
					label={label}
					value={(value as string) ?? ''}
					placeholder={`Select ${label.toLowerCase()}...`}
					options={refOptions}
					onChange={(v) => onChange(v)}
					required={field.required}
				/>
			)
		}

		case 'array': {
			const items = Array.isArray(value) ? value : []
			// Array of references — show multiselect with collection entries
			if (field.itemType === 'reference' && field.collection) {
				const refEntries = getCollectionEntryOptions(manifest.value, field.collection)
				return (
					<div class="col-span-2" data-cms-ui>
						<MultiSelectField
							label={label}
							selected={items.map(String)}
							options={refEntries}
							onChange={(v) => onChange(v)}
						/>
					</div>
				)
			}
			if (field.options && field.options.length > 0) {
				return (
					<div class="col-span-2" data-cms-ui>
						<MultiSelectField
							label={label}
							selected={items.map(String)}
							options={field.options}
							onChange={(v) => onChange(v)}
						/>
					</div>
				)
			}
			if (field.itemType === 'object' || isArrayOfObjects(items)) {
				return (
					<ArrayOfObjectsField
						label={label}
						items={items as Record<string, unknown>[]}
						onChange={onChange}
						itemFields={field.fields}
					/>
				)
			}
			return (
				<div class="col-span-2 flex flex-col gap-1" data-cms-ui>
					<label class="text-xs text-white/60 font-medium">{label}</label>
					<input
						type="text"
						value={items.map(v => typeof v === 'string' ? v : String(v)).join(', ')}
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
// Array of Objects Field — renders each item as nested key/value fields
// ============================================================================

interface ArrayOfObjectsFieldProps {
	label: string
	items: Record<string, unknown>[]
	onChange: (value: unknown) => void
	itemFields?: FieldDefinition[]
}

function ArrayOfObjectsField({ label, items, onChange, itemFields }: ArrayOfObjectsFieldProps) {
	const handleItemChange = (index: number, newItem: Record<string, unknown>) => {
		const updated = [...items]
		updated[index] = newItem
		onChange(updated)
	}

	const handleRemoveItem = (index: number) => {
		onChange(items.filter((_, i) => i !== index))
	}

	const handleAddItem = () => {
		// Use the first item's keys as template
		const template = items.length > 0
			? Object.fromEntries(Object.keys(items[0]!).map(k => [k, '']))
			: { name: '' }
		onChange([...items, template])
	}

	return (
		<div class="flex flex-col gap-2 col-span-2" data-cms-ui>
			<label class="text-xs text-white/60 font-medium">{label}</label>
			<div class="space-y-2">
				{items.map((item, index) => (
					<div key={index} class="flex items-start gap-2 pl-3 border-l-2 border-white/10">
						<div class="flex-1 min-w-0 space-y-1.5">
							{itemFields
								? itemFields.map((subField) => (
									<SchemaFrontmatterField
										key={subField.name}
										field={subField}
										value={item[subField.name]}
										onChange={(newValue) => handleItemChange(index, { ...item, [subField.name]: newValue })}
									/>
								))
								: Object.entries(item).map(([key, val]) => (
									<FrontmatterField
										key={key}
										fieldKey={key}
										value={val}
										onChange={(newValue) => handleItemChange(index, { ...item, [key]: newValue })}
									/>
								))}
						</div>
						<button
							type="button"
							onClick={() => handleRemoveItem(index)}
							class="p-1 mt-1 text-white/30 hover:text-red-400 transition-colors shrink-0"
							title="Remove item"
							data-cms-ui
						>
							<RemoveIcon />
						</button>
					</div>
				))}
			</div>
			<button
				type="button"
				onClick={handleAddItem}
				class="self-start px-3 py-1 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/20 rounded-cms-sm transition-colors"
				data-cms-ui
			>
				+ Add {label.toLowerCase()}
			</button>
		</div>
	)
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
						class="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-cms-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
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
		case 'email':
			return 'name@example.com'
		case 'image':
			return '/images/...'
		case 'file':
			return '/files/...'
		case 'color':
			return '#000000'
		case 'date':
			return 'YYYY-MM-DD'
		case 'datetime':
			return 'YYYY-MM-DDTHH:MM'
		case 'time':
			return 'HH:MM'
		case 'year':
			return String(new Date().getFullYear())
		case 'month':
			return 'YYYY-MM'
		default:
			return `Enter ${formatFieldLabel(field.name).toLowerCase()}...`
	}
}
