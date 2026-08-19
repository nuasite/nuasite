/**
 * Editable field widgets, driven entirely by a `FieldDefinition` (cms-headless F3.2).
 *
 * Each widget maps a `FieldType` to a control, reads/writes a *native* value
 * (numbers, booleans, arrays, objects — see form-model), and reports changes via
 * `onChange`. The renderer is recursive: `object` nests a group of widgets and
 * `array` repeats the item widget. Media (`image`/`astroImage`) and `reference`
 * widgets reach the sidecar through the injected `EditorContext`.
 */

import {
	blankValue,
	type CmsClient,
	coerceInput,
	loadAllEntries,
	valueToArray,
	valueToBoolean,
	valueToDateInput,
	valueToInput,
	valueToObject,
} from '@nuasite/cms-client'
import { MdxBodyEditor } from '@nuasite/cms-mdx-editor'
import { type CmsListStyle, type ComponentDefinition, type FieldDefinition, type FieldType, newRepeaterItem } from '@nuasite/cms-types'
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MediaPicker } from './media-picker'

/** Markdown fields use the rich editor with no component blocks (plain prose + media). */
const NO_COMPONENTS: ComponentDefinition[] = []

/** Cross-cutting services a widget may need (media uploads, reference lookups). */
export interface EditorContext {
	client: CmsClient
	/** The collection + slug being edited, used as upload context for media. */
	collection: string
	slug?: string
}

interface FieldEditorProps {
	field: FieldDefinition
	value: unknown
	onChange: (value: unknown) => void
	ctx: EditorContext
}

// ============================================================================
// Scalar widgets
// ============================================================================

/** HTML `<input type>` for the text-like scalar field types. */
const TEXT_INPUT_TYPE: Partial<Record<FieldType, string>> = {
	url: 'url',
	email: 'email',
	tel: 'tel',
}

/** Native date/time control type per temporal field type. */
const DATE_INPUT_TYPE: Partial<Record<FieldType, string>> = {
	date: 'date',
	datetime: 'datetime-local',
	time: 'time',
	month: 'month',
}

function TextWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	const hints = field.hints
	return (
		<input
			type={TEXT_INPUT_TYPE[field.type] ?? 'text'}
			className="nua-cadmin-input"
			value={valueToInput(value)}
			placeholder={hints?.placeholder}
			maxLength={hints?.maxLength}
			minLength={hints?.minLength}
			onChange={e => onChange(coerceInput(field.type, e.target.value))}
		/>
	)
}

/** Textarea that grows with its content (no inner scrollbar), with a `rows` floor. */
function AutosizeTextarea(
	{ value, rows, placeholder, maxLength, onChange }: {
		value: string
		rows: number
		placeholder?: string
		maxLength?: number
		onChange: (v: string) => void
	},
) {
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${el.scrollHeight}px`
	}, [value])
	return (
		<textarea
			ref={ref}
			className="nua-cadmin-textarea nua-cadmin-textarea-autosize"
			value={value}
			rows={rows}
			placeholder={placeholder}
			maxLength={maxLength}
			onChange={e => onChange(e.target.value)}
		/>
	)
}

function TextareaWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	return (
		<AutosizeTextarea
			value={valueToInput(value)}
			rows={field.hints?.rows ?? 4}
			placeholder={field.hints?.placeholder}
			maxLength={field.hints?.maxLength}
			onChange={onChange}
		/>
	)
}

/** Markdown field — the rich MDX/markdown WYSIWYG editor, reused for frontmatter markdown values. */
function MarkdownWidget({ value, onChange, ctx }: { value: unknown; onChange: (v: unknown) => void; ctx: EditorContext }) {
	const mediaContext = useMemo(() => ({ collection: ctx.collection, entry: ctx.slug }), [ctx.collection, ctx.slug])
	// Project list styles for the MDX toolbar; degrades to none against an older sidecar (no /config).
	const [listStyles, setListStyles] = useState<CmsListStyle[]>([])
	useEffect(() => {
		let active = true
		ctx.client.getConfig().then(
			config => {
				if (active) setListStyles(config.listStyles ?? [])
			},
			() => {
				if (active) setListStyles([])
			},
		)
		return () => {
			active = false
		}
	}, [ctx.client])
	return (
		<MdxBodyEditor
			value={valueToInput(value)}
			onChange={onChange}
			components={NO_COMPONENTS}
			listStyles={listStyles}
			media={ctx.client}
			mediaContext={mediaContext}
		/>
	)
}

function NumberWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	return (
		<input
			type="number"
			className="nua-cadmin-input"
			value={valueToInput(value)}
			min={field.hints?.min}
			max={field.hints?.max}
			step={field.hints?.step}
			placeholder={field.hints?.placeholder}
			onChange={e => onChange(coerceInput('number', e.target.value))}
		/>
	)
}

/** Year is a plain bounded number input (`<input type="year">` is not a thing). */
function YearWidget({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
	return (
		<input
			type="number"
			className="nua-cadmin-input"
			value={valueToInput(value)}
			min={1000}
			max={9999}
			step={1}
			onChange={e => onChange(coerceInput('year', e.target.value))}
		/>
	)
}

function DateWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	return (
		<input
			type={DATE_INPUT_TYPE[field.type] ?? 'date'}
			className="nua-cadmin-input"
			value={valueToDateInput(value, field.type)}
			onChange={e => onChange(coerceInput(field.type, e.target.value))}
		/>
	)
}

/**
 * Boolean toggle. The `publish-toggle` role gets a pinned/styled appearance so
 * the publish switch reads as a first-class control rather than a generic field.
 */
function BooleanWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	const on = valueToBoolean(value)
	const isPublish = field.role === 'publish-toggle'
	return (
		<button
			type="button"
			className={`nua-cadmin-toggle${on ? ' nua-cadmin-toggle-on' : ''}${isPublish ? ' nua-cadmin-toggle-publish' : ''}`}
			role="switch"
			aria-checked={on}
			onClick={() => onChange(!on)}
		>
			<span className="nua-cadmin-toggle-knob" />
			<span className="nua-cadmin-toggle-label">{on ? 'On' : 'Off'}</span>
		</button>
	)
}

function SelectWidget({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
	const options = field.options ?? []
	const current = valueToInput(value)
	return (
		<select className="nua-cadmin-input" value={current} onChange={e => onChange(coerceInput('select', e.target.value))}>
			{field.required
				// An unset required select matches no option, and the browser then displays the
				// first real one as if it had been chosen — so a new entry looks filled in while
				// the draft still holds ''. React selects this placeholder instead (`disabled`
				// only blocks the user from picking it back, not the value sync).
				? current === '' ? <option value="" disabled>— select —</option> : null
				: <option value="">— none —</option>}
			{options.map(opt => (
				<option key={opt} value={opt}>
					{opt}
				</option>
			))}
			{current !== '' && !options.includes(current) ? <option value={current}>{current} (current)</option> : null}
		</select>
	)
}

// ============================================================================
// Reference widget — searchable combobox over the target collection.
// ============================================================================

/** Ceiling on options held in memory (~1MB of strings, ~1ms to filter — measured). */
const REFERENCE_MAX_OPTIONS = 20_000
/** Rows the dropdown renders at once; the rest is reachable by typing. */
const REFERENCE_VISIBLE_MATCHES = 100

interface ReferenceOption {
	slug: string
	title?: string
	/** Lowercased "title slug", precomputed so filtering does no work per keystroke. */
	search: string
}

/** What the widgets render. Options are usable from the first page onward. */
interface ReferenceSnapshot {
	options: ReferenceOption[]
	/** Nothing to show yet — the first page has not landed. */
	loading: boolean
	/** Usable, but later pages are still arriving. */
	paging: boolean
	/** `REFERENCE_MAX_OPTIONS` cut the paging short — some entries are unreachable. */
	truncated: boolean
	/** The lookup failed with nothing loaded; the widget falls back to free text. */
	failed: boolean
}

const EMPTY_SNAPSHOT: ReferenceSnapshot = { options: [], loading: true, paging: false, truncated: false, failed: false }

interface ReferenceStore {
	getSnapshot: () => ReferenceSnapshot
	subscribe: (onChange: () => void) => () => void
}

function toOption(entry: { slug: string; title?: string }): ReferenceOption {
	const option: ReferenceOption = { slug: entry.slug, search: `${entry.title ?? ''} ${entry.slug}`.toLowerCase() }
	if (entry.title !== undefined) option.title = entry.title
	return option
}

/**
 * Per-collection option source, shared by every picker on the form (an array of 20
 * references must not page the collection 20 times).
 *
 * Loading is progressive: each page is published as it lands, so the picker is
 * usable after one round trip no matter how many pages the collection needs. A
 * *refresh* of an already-loaded list publishes only at the end — the list must
 * not shrink under a user who is reading it.
 */
function createReferenceStore(client: CmsClient, collection: string): ReferenceStore {
	let snapshot = EMPTY_SNAPSHOT
	let running = false
	const subscribers = new Set<() => void>()

	const publish = (next: Partial<ReferenceSnapshot>) => {
		snapshot = { ...snapshot, ...next }
		for (const notify of subscribers) notify()
	}

	const load = async () => {
		if (running) return
		running = true
		// A refresh publishes only when it completes: the list must not shrink, nor jump
		// back to "loading more", under someone who is reading it.
		const refresh = snapshot.options.length > 0
		const options: ReferenceOption[] = []
		try {
			const result = await loadAllEntries(client, collection, 'slug,title', REFERENCE_MAX_OPTIONS, (page, more) => {
				for (const entry of page) options.push(toOption(entry))
				if (!refresh) publish({ options: [...options], loading: false, paging: more, truncated: false, failed: false })
			})
			publish({ options, loading: false, paging: false, truncated: result.truncated, failed: false })
		} catch {
			// Whatever already landed stays usable — a page that fails half way through must
			// not throw away the pages that succeeded. It is a partial list, though, and says
			// so: silently presenting it as the whole collection is the bug this widget exists
			// to fix. Only a load with nothing at all to show falls back to free text.
			publish({ loading: false, paging: false, truncated: !refresh && options.length > 0, failed: snapshot.options.length === 0 })
		} finally {
			running = false
		}
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(onChange) {
			const first = subscribers.size === 0
			subscribers.add(onChange)
			// Load for the first picker, and reload whenever a picker mounts after the last
			// one went away: an entry created elsewhere in the admin must be referenceable as
			// soon as the user comes back. Siblings mounting together join the load in flight.
			if (first && !running) void load()
			return () => {
				subscribers.delete(onChange)
			}
		},
	}
}

/**
 * Stores per client, then per collection. Keying by collection name alone would make two
 * clients (two sidecars, same collection names) evict each other's store on every render,
 * and a store that changes identity every render resubscribes and reloads forever.
 */
const referenceStores = new WeakMap<CmsClient, Map<string, ReferenceStore>>()

function referenceStoreFor(client: CmsClient, collection: string): ReferenceStore {
	let byCollection = referenceStores.get(client)
	if (!byCollection) {
		byCollection = new Map()
		referenceStores.set(client, byCollection)
	}
	const existing = byCollection.get(collection)
	if (existing) return existing
	const store = createReferenceStore(client, collection)
	byCollection.set(collection, store)
	return store
}

/** Subscribes to the shared per-collection store; re-renders as pages land. */
function useReferenceOptions(client: CmsClient, collection: string | undefined): ReferenceSnapshot {
	const store = collection === undefined || collection === '' ? null : referenceStoreFor(client, collection)
	const subscribe = useCallback((onChange: () => void) => store?.subscribe(onChange) ?? (() => {}), [store])
	const getSnapshot = useCallback(() => store?.getSnapshot() ?? EMPTY_SNAPSHOT, [store])
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** What the user reads: the entry title when it says more than the slug does. */
function optionLabel(option: ReferenceOption): string {
	const title = option.title?.trim()
	return title === undefined || title === '' ? option.slug : title
}

/**
 * Match position of every term in "title slug", or `null` when a term is absent.
 * Lower is better; a slug that *starts* with the query sorts ahead of a mid-word hit.
 */
function rankOption(option: ReferenceOption, terms: string[]): number | null {
	let score = 0
	for (const term of terms) {
		const at = option.search.indexOf(term)
		if (at < 0) return null
		score += at
	}
	const first = terms[0] ?? ''
	return option.slug.toLowerCase().startsWith(first) ? score : score + 1000
}

/** Options matching every whitespace-separated term of `query`, best match first. */
function filterOptions(options: ReferenceOption[], query: string): ReferenceOption[] {
	const terms = query.toLowerCase().split(/\s+/).filter(term => term !== '')
	if (terms.length === 0) return options
	const scored: { option: ReferenceOption; score: number }[] = []
	for (const option of options) {
		const score = rankOption(option, terms)
		if (score !== null) scored.push({ option, score })
	}
	scored.sort((a, b) => a.score - b.score)
	return scored.map(entry => entry.option)
}

/**
 * Type-to-search picker over the loaded entries. A plain `<select>` is unusable
 * once a collection has more than a screenful of entries.
 *
 * The list needs no virtualization: it renders at most `REFERENCE_VISIBLE_MATCHES`
 * rows whatever the collection size, and narrowing happens by typing.
 */
function ReferenceCombobox(
	{ target, snapshot, value, onChange }: {
		target: string
		snapshot: ReferenceSnapshot
		value: string
		onChange: (slug: string) => void
	},
) {
	const { options, paging, truncated } = snapshot
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [active, setActive] = useState(0)
	const rootRef = useRef<HTMLDivElement>(null)
	const listRef = useRef<HTMLUListElement>(null)
	const listId = useId()

	const selected = options.find(option => option.slug === value)
	// The current selection leads the unfiltered list. Without it, a selection sitting past
	// row `REFERENCE_VISIBLE_MATCHES` would be highlighted but never rendered — arrows and
	// Enter would act on a row that is not there.
	const matches = useMemo(() => {
		const filtered = filterOptions(options, query)
		if (selected === undefined || query.trim() !== '') return filtered
		return [selected, ...filtered.filter(option => option !== selected)]
	}, [options, query, selected])
	const shown = matches.slice(0, REFERENCE_VISIBLE_MATCHES)
	const hidden = matches.length - shown.length

	// Close on an outside click. The input's own blur is not enough: it fires before
	// a click on an option lands, and would take the option away first.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [open])

	// Keep the highlighted row visible while arrowing through a long list.
	useEffect(() => {
		if (!open) return
		listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
	}, [active, open])

	const commit = (slug: string) => {
		onChange(slug)
		setQuery('')
		setActive(0)
		setOpen(false)
	}

	// Opening lands on row 0 — which is the current selection, since `matches` leads with it.
	const openList = () => {
		setActive(0)
		setQuery('')
		setOpen(true)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (!open) {
				openList()
				return
			}
			const last = shown.length - 1
			setActive(current => event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0))
			return
		}
		if (event.key === 'Enter' && open) {
			const choice = shown[active]
			if (choice) {
				event.preventDefault()
				commit(choice.slug)
			}
			return
		}
		if (event.key === 'Escape' && open) {
			// Stop here: an ancestor may read Escape as "close the editor".
			event.stopPropagation()
			setQuery('')
			setOpen(false)
		}
	}

	// Only once the whole collection has landed can a value be called missing; before that
	// the entry may simply be on a page that has not arrived.
	const missing = value !== '' && selected === undefined && !paging

	return (
		<div className="nua-cadmin-combobox" ref={rootRef}>
			<div className="nua-cadmin-combobox-control">
				<input
					type="text"
					className="nua-cadmin-input nua-cadmin-combobox-input"
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={open && shown[active] !== undefined ? `${listId}-${active}` : undefined}
					autoComplete="off"
					value={open ? query : (selected ? optionLabel(selected) : value)}
					placeholder={`Search ${target}…`}
					onFocus={openList}
					// Committing and Escape both leave the input focused, so a second click
					// fires no focus event — without this the field cannot be reopened.
					onMouseDown={() => {
						if (!open) openList()
					}}
					onChange={event => {
						setQuery(event.target.value)
						setActive(0)
						setOpen(true)
					}}
					onKeyDown={onKeyDown}
				/>
				{value !== ''
					? (
						<button
							type="button"
							className="nua-cadmin-combobox-clear"
							title="Clear reference"
							aria-label="Clear reference"
							onClick={() => commit('')}
						>
							×
						</button>
					)
					: null}
			</div>
			{open
				? (
					<ul className="nua-cadmin-combobox-list" id={listId} role="listbox" ref={listRef}>
						{shown.length === 0 && !paging ? <li className="nua-cadmin-combobox-empty">No entry matches “{query}”</li> : null}
						{shown.map((option, index) => {
							const label = optionLabel(option)
							return (
								<li
									key={option.slug}
									id={`${listId}-${index}`}
									role="option"
									aria-selected={option.slug === value}
									data-active={index === active}
									className={`nua-cadmin-combobox-option${index === active ? ' is-active' : ''}`}
									// mousedown, not click: the input blurs on click and the row would be gone.
									onMouseDown={event => {
										event.preventDefault()
										commit(option.slug)
									}}
									onMouseEnter={() => setActive(index)}
								>
									<span className="nua-cadmin-combobox-option-label">{label}</span>
									{label === option.slug ? null : <span className="nua-cadmin-combobox-option-slug">{option.slug}</span>}
								</li>
							)
						})}
						{hidden > 0 ? <li className="nua-cadmin-combobox-more">+{hidden} more — keep typing to narrow</li> : null}
						{paging ? <li className="nua-cadmin-combobox-more">Loading more entries…</li> : null}
					</ul>
				)
				: null}
			{missing ? <div className="nua-cadmin-combobox-hint">“{value}” is not an entry of {target}</div> : null}
			{truncated
				? (
					<div className="nua-cadmin-combobox-hint">
						Showing the first {options.length} {options.length === 1 ? 'entry' : 'entries'} of {target}
					</div>
				)
				: null}
		</div>
	)
}

function ReferenceWidget({ field, value, onChange, ctx }: FieldEditorProps) {
	const target = field.collection
	const snapshot = useReferenceOptions(ctx.client, target)
	const current = valueToInput(value)

	// No target collection, or the lookup failed outright → fall back to a free-text
	// slug input rather than blocking the editor.
	if (target === undefined || target === '' || snapshot.failed) {
		return (
			<input
				type="text"
				className="nua-cadmin-input"
				value={current}
				placeholder="entry slug"
				onChange={e => onChange(coerceInput('reference', e.target.value))}
			/>
		)
	}
	// Only the very first page is worth waiting for; the rest streams in behind the UI.
	if (snapshot.loading) {
		return <div className="nua-cadmin-field-loading">Loading {target}…</div>
	}
	return (
		<ReferenceCombobox
			target={target}
			snapshot={snapshot}
			value={current}
			onChange={slug => onChange(coerceInput('reference', slug))}
		/>
	)
}
// ============================================================================
// Array repeater — recurses the item widget.
// ============================================================================

function ArrayWidget({ field, value, onChange, ctx }: FieldEditorProps) {
	const items = valueToArray(value)
	const itemType: FieldType = field.itemType ?? 'text'
	const itemField: FieldDefinition = {
		name: field.name,
		type: itemType,
		required: false,
		fields: field.fields,
		options: field.options,
		collection: field.collection,
	}

	const setItem = useCallback(
		(index: number, next: unknown) => {
			const copy = items.slice()
			copy[index] = next
			onChange(copy)
		},
		[items, onChange],
	)
	const removeItem = useCallback(
		(index: number) => {
			onChange(items.filter((_, i) => i !== index))
		},
		[items, onChange],
	)
	// An object item is built from the schema (`newRepeaterItem` in cms-types, shared with every
	// other editor and with `nua check`): required keys seeded, optional ones left out. Appending
	// a bare `{}` writes frontmatter the next build refuses.
	const addItem = useCallback(() => {
		const seeded = itemType === 'object' && field.fields ? newRepeaterItem(field.fields) : blankValue(itemType)
		onChange([...items, seeded])
	}, [items, itemType, field.fields, onChange])

	return (
		<div className="nua-cadmin-array">
			{items.length === 0 ? <div className="nua-cadmin-field-empty">No items.</div> : null}
			{items.map((item, index) => (
				// Array items have no stable id; positional index keys are correct here.
				<div key={index} className="nua-cadmin-array-item">
					<div className="nua-cadmin-array-item-body">
						<FieldEditor field={itemField} value={item} onChange={next => setItem(index, next)} ctx={ctx} />
					</div>
					<button type="button" className="nua-cadmin-icon-btn" aria-label="Remove item" onClick={() => removeItem(index)}>
						×
					</button>
				</div>
			))}
			<button type="button" className="nua-cadmin-add-btn" onClick={addItem}>
				+ Add item
			</button>
		</div>
	)
}

// ============================================================================
// Nested object group.
// ============================================================================

function ObjectWidget({ field, value, onChange, ctx }: FieldEditorProps) {
	const obj = valueToObject(value)
	const subFields = field.fields ?? []
	const setKey = useCallback(
		(name: string, next: unknown) => {
			onChange({ ...obj, [name]: next })
		},
		[obj, onChange],
	)
	if (subFields.length === 0) {
		return <div className="nua-cadmin-field-empty">No nested fields.</div>
	}
	return (
		<div className="nua-cadmin-object">
			{subFields.map(sub => (
				<div key={sub.name} className="nua-cadmin-object-field">
					<div className="nua-cadmin-field-label">
						<span>{sub.name}</span>
						<span className="nua-cadmin-field-type">{sub.type}</span>
					</div>
					<FieldEditor field={sub} value={obj[sub.name]} onChange={next => setKey(sub.name, next)} ctx={ctx} />
				</div>
			))}
		</div>
	)
}

// ============================================================================
// Renderer
// ============================================================================

/**
 * Render the editable control for `field`. Pure dispatch on `field.type`; the
 * value is always native (coercion happens inside each widget on input).
 */
export function FieldEditor({ field, value, onChange, ctx }: FieldEditorProps) {
	switch (field.type) {
		case 'text':
		case 'url':
		case 'email':
		case 'tel':
		case 'color':
			return <TextWidget field={field} value={value} onChange={onChange} />
		case 'textarea':
			return <TextareaWidget field={field} value={value} onChange={onChange} />
		case 'markdown':
			return <MarkdownWidget value={value} onChange={onChange} ctx={ctx} />
		case 'number':
			return <NumberWidget field={field} value={value} onChange={onChange} />
		case 'year':
			return <YearWidget value={value} onChange={onChange} />
		case 'date':
		case 'datetime':
		case 'time':
		case 'month':
			return <DateWidget field={field} value={value} onChange={onChange} />
		case 'boolean':
			return <BooleanWidget field={field} value={value} onChange={onChange} />
		case 'select':
			return <SelectWidget field={field} value={value} onChange={onChange} />
		case 'image':
		case 'file':
			return (
				<MediaPicker
					client={ctx.client}
					value={valueToInput(value)}
					collection={ctx.collection}
					entry={ctx.slug}
					field={field.name}
					accept={field.hints?.accept}
					onChange={url => onChange(url)}
				/>
			)
		case 'reference':
			return <ReferenceWidget field={field} value={value} onChange={onChange} ctx={ctx} />
		case 'array':
			return <ArrayWidget field={field} value={value} onChange={onChange} ctx={ctx} />
		case 'object':
			return <ObjectWidget field={field} value={value} onChange={onChange} ctx={ctx} />
	}
}
