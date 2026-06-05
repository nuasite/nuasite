/**
 * Read-only field rendering, driven by a collection's `FieldDefinition`.
 *
 * Scalar types (text/number/boolean/date/select/image/url/email/tel/color) show
 * their value directly; structural types (array/object/reference) show their
 * structure. Nothing here mutates — editing arrives in F3.2.
 */

import type { FieldDefinition, FieldType } from '@nuasite/cms-types'

/**
 * Frontmatter values arrive from the sidecar already stringified
 * (`{ value: string; line: number }`). For structural types the string is a
 * JSON payload; we parse it best-effort for a structured render and fall back to
 * the raw string when it is not JSON.
 */
function parseStructured(raw: string): unknown {
	const trimmed = raw.trim()
	if (trimmed === '') return undefined
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return raw
	try {
		return JSON.parse(trimmed)
	} catch {
		return raw
	}
}

function StructuredValue({ raw }: { raw: string }) {
	const parsed = parseStructured(raw)
	if (parsed === undefined) {
		return <span className="nua-cadmin-field-empty">—</span>
	}
	if (typeof parsed === 'string') {
		return <span>{parsed}</span>
	}
	return <pre className="nua-cadmin-field-structured">{JSON.stringify(parsed, null, 2)}</pre>
}

function BooleanValue({ raw }: { raw: string }) {
	const on = raw === 'true' || raw === '1' || raw.toLowerCase() === 'yes'
	return <span className={on ? 'nua-cadmin-bool-on' : 'nua-cadmin-bool-off'}>{on ? 'Yes' : 'No'}</span>
}

function ImageValue({ raw }: { raw: string }) {
	if (raw === '') return <span className="nua-cadmin-field-empty">—</span>
	const looksLikeUrl = /^(https?:\/\/|\/)/.test(raw)
	return (
		<div>
			{looksLikeUrl ? <img className="nua-cadmin-img" src={raw} alt="" /> : null}
			<div className="nua-cadmin-cell-mono">{raw}</div>
		</div>
	)
}

const STRUCTURAL_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['array', 'object', 'reference'])

export function FieldValueView({ field, raw }: { field: FieldDefinition; raw: string | undefined }) {
	if (raw === undefined || raw === '') {
		return <div className="nua-cadmin-field-value nua-cadmin-field-empty">—</div>
	}

	let content: React.ReactNode
	switch (field.type) {
		case 'boolean':
			content = <BooleanValue raw={raw} />
			break
		case 'image':
		case 'file':
			content = <ImageValue raw={raw} />
			break
		default:
			content = STRUCTURAL_TYPES.has(field.type) ? <StructuredValue raw={raw} /> : <span>{raw}</span>
	}

	return <div className="nua-cadmin-field-value">{content}</div>
}

export function FieldRow({ field, raw }: { field: FieldDefinition; raw: string | undefined }) {
	return (
		<div className="nua-cadmin-field">
			<div className="nua-cadmin-field-label">
				<span>{field.name}</span>
				<span className="nua-cadmin-field-type">{field.type}{field.required ? ' · required' : ''}</span>
			</div>
			<FieldValueView field={field} raw={raw} />
		</div>
	)
}
