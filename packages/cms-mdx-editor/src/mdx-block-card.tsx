/**
 * Block-card view for an MDX component node (React port of the in-iframe preact
 * `MdxBlockCard`). Renders a non-live card with feature parity to the original:
 *  - typed prop widgets (boolean / color / image / number / url / date / text);
 *  - `image` props open the media library to browse + upload (when `media` given);
 *  - the default slot (`children`) is a nested WYSIWYG editor (`SlotEditor`);
 *  - expression props (`prop={expr}`) stay read-only.
 * Self-contained inline styles so it renders in any host without a stylesheet.
 */
import type { ComponentDefinition, ComponentProp } from '@nuasite/cms-types'
import { useMemo, useState } from 'react'
import { MDX_EXPR_PREFIX } from './mdx-plugin'
import { MediaLibrary } from './media-library'
import type { MediaContext, MediaSource } from './media-source'
import { SlotEditor } from './slot-editor'

export interface MdxBlockCardProps {
	componentName: string
	props: Record<string, string>
	hasExpressions: boolean
	slotContent: string
	definition?: ComponentDefinition
	/** Media source — enables image-prop browse/upload. Absent → image props are URL-only. */
	media?: MediaSource
	mediaContext?: MediaContext
	onRemove: () => void
	/** Set when the component has a default slot — edits the markdown children. */
	onSlotContentChange?: (content: string) => void
	/** Set when there are no expression props — static props are editable. */
	onPropsChange?: (props: Record<string, string>) => void
}

const HTML_INPUT_TYPES: Record<string, string> = {
	number: 'number',
	url: 'url',
	date: 'date',
	datetime: 'datetime-local',
	time: 'time',
	email: 'email',
	tel: 'tel',
}

function looksLikeUrl(value: string): boolean {
	return value !== '' && /^(https?:\/\/|\/|\.\/)/.test(value)
}

const card: React.CSSProperties = { border: '1px solid #d4d4d8', borderRadius: 8, background: '#fafafa', margin: '8px 0', fontSize: 13 }
const header: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 8,
	padding: '6px 10px',
	borderBottom: '1px solid #ececed',
	background: '#f1f1f3',
	borderTopLeftRadius: 8,
	borderTopRightRadius: 8,
}
const nameStyle: React.CSSProperties = { fontWeight: 600, fontFamily: 'ui-monospace, monospace', color: '#3f3f46' }
const body: React.CSSProperties = { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }
const rowLabel: React.CSSProperties = { fontSize: 11, color: '#71717a', marginBottom: 2 }
const inputStyle: React.CSSProperties = {
	width: '100%',
	boxSizing: 'border-box',
	border: '1px solid #d4d4d8',
	borderRadius: 4,
	padding: '4px 6px',
	font: 'inherit',
	background: '#fff',
}
const roInput: React.CSSProperties = { ...inputStyle, background: '#f4f4f5', color: '#71717a' }
const exprBadge: React.CSSProperties = { fontSize: 10, color: '#a16207', background: '#fef9c3', borderRadius: 3, padding: '0 4px', marginLeft: 6 }
const removeBtn: React.CSSProperties = {
	border: 'none',
	background: 'transparent',
	color: '#a1a1aa',
	cursor: 'pointer',
	fontSize: 16,
	lineHeight: 1,
	padding: 2,
}
const browseBtn: React.CSSProperties = {
	border: '1px solid #d4d4d8',
	background: '#fff',
	borderRadius: 4,
	padding: '4px 8px',
	font: 'inherit',
	fontSize: 12,
	cursor: 'pointer',
	color: '#3f3f46',
	whiteSpace: 'nowrap',
}

// ---- typed prop field ----

function PropField({ name, value, propType, editable, hasMedia, onChange, onBrowse }: {
	name: string
	value: string
	propType: string
	editable: boolean
	hasMedia: boolean
	onChange: (value: string) => void
	onBrowse: () => void
}) {
	if (propType === 'boolean') {
		return (
			<label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<input type="checkbox" checked={value === 'true'} disabled={!editable} onChange={e => onChange(e.target.checked ? 'true' : 'false')} />
				<span style={{ color: '#52525b' }}>{value === 'true' ? 'Yes' : 'No'}</span>
			</label>
		)
	}

	if (propType === 'image') {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				{looksLikeUrl(value)
					? <img src={value} alt="" style={{ maxHeight: 96, maxWidth: '100%', objectFit: 'contain', borderRadius: 4, alignSelf: 'flex-start' }} />
					: null}
				<div style={{ display: 'flex', gap: 6 }}>
					<input
						style={editable ? inputStyle : roInput}
						value={value}
						readOnly={!editable}
						placeholder="Image URL or path"
						onChange={editable ? e => onChange(e.target.value) : undefined}
					/>
					{editable && hasMedia ? <button type="button" style={browseBtn} data-mdx-action="props" onClick={onBrowse}>Browse</button> : null}
				</div>
			</div>
		)
	}

	if (propType === 'color') {
		return (
			<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
				<input
					type="color"
					value={value || '#000000'}
					disabled={!editable}
					onChange={e => onChange(e.target.value)}
					style={{
						width: 30,
						height: 28,
						padding: 0,
						border: '1px solid #d4d4d8',
						borderRadius: 4,
						background: 'transparent',
						cursor: editable ? 'pointer' : 'default',
					}}
				/>
				<input
					style={editable ? inputStyle : roInput}
					value={value}
					readOnly={!editable}
					placeholder="#000000"
					onChange={editable
						? e => onChange(e.target.value)
						: undefined}
				/>
			</div>
		)
	}

	const htmlType = HTML_INPUT_TYPES[propType] ?? 'text'
	return (
		<input
			type={htmlType}
			style={editable ? inputStyle : roInput}
			value={value}
			readOnly={!editable}
			placeholder={`Enter ${name}…`}
			onChange={editable ? e => onChange(e.target.value) : undefined}
		/>
	)
}

export function MdxBlockCard({
	componentName,
	props,
	hasExpressions,
	slotContent,
	definition,
	media,
	mediaContext,
	onRemove,
	onSlotContentChange,
	onPropsChange,
}: MdxBlockCardProps) {
	const hasDefaultSlot = definition?.slots?.includes('default') ?? Boolean(onSlotContentChange)
	const entries = Object.entries(props)
	const [browseField, setBrowseField] = useState<string | null>(null)

	const propTypes = useMemo(() => {
		const map = new Map<string, ComponentProp>()
		for (const p of definition?.props ?? []) map.set(p.name, p)
		return map
	}, [definition])

	const setProp = (name: string, value: string) => {
		if (!onPropsChange) return
		onPropsChange({ ...props, [name]: value })
	}

	return (
		<div style={card} data-cms-ui="" contentEditable={false}>
			<div style={header}>
				<span style={nameStyle}>
					{`<${componentName} />`}
					{hasExpressions ? <span style={exprBadge}>expr · read-only</span> : null}
				</span>
				<button type="button" style={removeBtn} title="Remove block" data-mdx-action="remove" onClick={onRemove}>×</button>
			</div>
			<div style={body}>
				{hasDefaultSlot
					? (
						<div data-mdx-action="children">
							<div style={rowLabel}>Content</div>
							{onSlotContentChange
								? <SlotEditor value={slotContent} onChange={onSlotContentChange} />
								: <div style={{ ...roInput, whiteSpace: 'pre-wrap', minHeight: 40 }}>{slotContent}</div>}
						</div>
					)
					: null}

				{entries.length === 0 && !hasDefaultSlot ? <div style={{ color: '#a1a1aa', fontSize: 12 }}>No props</div> : null}

				{entries.map(([name, value]) => {
					const isExpr = value.startsWith(MDX_EXPR_PREFIX)
					const editable = Boolean(onPropsChange) && !isExpr
					const def = propTypes.get(name)
					const propType = (def?.type ?? '').toLowerCase()
					return (
						// A plain div (not a <label>): the boolean field renders its own <label>
						// around the checkbox, and nested <label>s double-fire the toggle click.
						<div key={name} style={{ display: 'block' }} data-mdx-action="props">
							<div style={rowLabel}>
								{name}
								{def?.required ? <span style={{ color: '#dc2626' }}>*</span> : null}
								{isExpr ? <span style={exprBadge}>expression</span> : null}
							</div>
							{isExpr
								? <input style={roInput} value={`{${value.slice(MDX_EXPR_PREFIX.length)}}`} readOnly />
								: (
									<PropField
										name={name}
										value={value}
										propType={propType}
										editable={editable}
										hasMedia={Boolean(media)}
										onChange={v => setProp(name, v)}
										onBrowse={() => setBrowseField(name)}
									/>
								)}
						</div>
					)
				})}
			</div>

			{browseField !== null && media
				? (
					<MediaLibrary
						media={media}
						context={mediaContext}
						field={browseField}
						accept="image/*"
						onSelect={(url) => {
							setProp(browseField, url)
							setBrowseField(null)
						}}
						onClose={() => setBrowseField(null)}
					/>
				)
				: null}
		</div>
	)
}
