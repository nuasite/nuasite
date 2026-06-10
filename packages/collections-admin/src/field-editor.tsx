/**
 * Editable field widgets, driven entirely by a `FieldDefinition` (cms-headless F3.2).
 *
 * Each widget maps a `FieldType` to a control, reads/writes a *native* value
 * (numbers, booleans, arrays, objects — see form-model), and reports changes via
 * `onChange`. The renderer is recursive: `object` nests a group of widgets and
 * `array` repeats the item widget. Media (`image`/`astroImage`) and `reference`
 * widgets reach the sidecar through the injected `EditorContext`.
 */

import { blankValue, type CmsClient, coerceInput, valueToArray, valueToBoolean, valueToInput, valueToObject } from '@nuasite/cms-client'
import { MdxBodyEditor } from '@nuasite/cms-mdx-editor'
import type { ComponentDefinition, FieldDefinition, FieldType } from '@nuasite/cms-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
	return (
		<MdxBodyEditor
			value={valueToInput(value)}
			onChange={onChange}
			components={NO_COMPONENTS}
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
			value={valueToInput(value)}
			onChange={e => onChange(e.target.value)}
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
		<select className="nua-cadmin-input" value={current} onChange={e => onChange(e.target.value)}>
			{field.required ? null : <option value="">— none —</option>}
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
// Reference widget — picks an entry from the target collection.
// ============================================================================

function ReferenceWidget({ field, value, onChange, ctx }: FieldEditorProps) {
	const target = field.collection
	const [slugs, setSlugs] = useState<string[] | null>(null)
	const [failed, setFailed] = useState(false)
	const current = valueToInput(value)

	useEffect(() => {
		if (!target) return
		let active = true
		ctx.client.getEntries(target, { fields: 'slug,title', draft: 'all', limit: 200 }).then(
			result => {
				if (active) setSlugs(result.entries.map(e => e.slug))
			},
			() => {
				if (active) setFailed(true)
			},
		)
		return () => {
			active = false
		}
	}, [ctx.client, target])

	// No target collection, or the lookup failed → fall back to a free-text slug
	// input rather than blocking the editor.
	if (!target || failed) {
		return <input type="text" className="nua-cadmin-input" value={current} placeholder="entry slug" onChange={e => onChange(e.target.value)} />
	}
	if (slugs === null) {
		return <div className="nua-cadmin-field-loading">Loading {target}…</div>
	}
	return (
		<select className="nua-cadmin-input" value={current} onChange={e => onChange(e.target.value)}>
			<option value="">— none —</option>
			{slugs.map(slug => (
				<option key={slug} value={slug}>
					{slug}
				</option>
			))}
			{current !== '' && !slugs.includes(current) ? <option value={current}>{current} (current)</option> : null}
		</select>
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
	const addItem = useCallback(() => {
		onChange([...items, blankValue(itemType)])
	}, [items, itemType, onChange])

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
