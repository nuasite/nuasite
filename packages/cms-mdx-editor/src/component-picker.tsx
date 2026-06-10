/**
 * Component picker for inserting an MDX block. A searchable list of the project's
 * Astro components; selecting one inserts it at the cursor with its props
 * pre-seeded (defaults where declared), then props/children are edited in the
 * block-card. Self-contained inline styles.
 */
import type { ComponentDefinition } from '@nuasite/cms-types'
import { useMemo, useState } from 'react'

export interface ComponentPickerProps {
	open: boolean
	components: ComponentDefinition[]
	onInsert: (componentName: string, props: Record<string, string>, children?: string) => void
	onClose: () => void
}

function defaultProps(def: ComponentDefinition): Record<string, string> {
	const props: Record<string, string> = {}
	for (const p of def.props) props[p.name] = p.defaultValue ?? ''
	return props
}

const backdrop: React.CSSProperties = {
	position: 'fixed',
	inset: 0,
	background: 'rgba(0,0,0,0.35)',
	display: 'flex',
	alignItems: 'flex-start',
	justifyContent: 'center',
	paddingTop: '12vh',
	zIndex: 1000,
}
const modal: React.CSSProperties = {
	width: 'min(440px, 92vw)',
	maxHeight: '70vh',
	display: 'flex',
	flexDirection: 'column',
	background: '#fff',
	border: '1px solid #d4d4d8',
	borderRadius: 10,
	boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
	overflow: 'hidden',
	fontSize: 13,
}
const searchStyle: React.CSSProperties = { border: 'none', borderBottom: '1px solid #ececed', padding: '10px 12px', font: 'inherit', outline: 'none' }
const itemStyle: React.CSSProperties = {
	textAlign: 'left',
	border: 'none',
	background: 'transparent',
	padding: '8px 12px',
	cursor: 'pointer',
	borderRadius: 0,
}

export function ComponentPicker({ open, components, onInsert, onClose }: ComponentPickerProps) {
	const [query, setQuery] = useState('')

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return components.filter(c => q === '' || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
	}, [components, query])

	if (!open) return null

	return (
		<div style={backdrop} onMouseDown={onClose}>
			<div style={modal} onMouseDown={(e) => e.stopPropagation()}>
				<input style={searchStyle} placeholder="Search components…" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
				<div style={{ overflowY: 'auto' }}>
					{filtered.length === 0 ? <div style={{ padding: 12, color: '#a1a1aa' }}>No components</div> : null}
					{filtered.map(def => (
						<button
							key={def.name}
							type="button"
							style={itemStyle}
							onClick={() => {
								onInsert(def.name, defaultProps(def))
								onClose()
							}}
						>
							<div style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace', color: '#3f3f46' }}>{def.name}</div>
							{def.description ? <div style={{ color: '#71717a', fontSize: 12 }}>{def.description}</div> : null}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
