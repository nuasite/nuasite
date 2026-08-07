import type { FieldDefinition } from '../types'

export function partitionFields(fields: FieldDefinition[]): { sidebar: FieldDefinition[]; header: FieldDefinition[] } {
	const sidebar: FieldDefinition[] = []
	const header: FieldDefinition[] = []
	let toggleField: FieldDefinition | null = null
	for (const field of fields) {
		if (field.hidden) continue
		if (field.role === 'publish-toggle' && field.position !== 'header') {
			toggleField = field
			continue
		}
		if (field.position === 'sidebar') {
			sidebar.push(field)
		} else {
			header.push(field)
		}
	}
	if (toggleField) {
		const dateIdx = sidebar.findIndex((f) => f.role === 'publish-date')
		if (dateIdx >= 0) {
			sidebar.splice(dateIdx, 0, toggleField)
		} else {
			sidebar.unshift(toggleField)
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
// ComboBox option list + value acceptance (closed vs. suggested options)
// ============================================================================

/** One entry of a `ComboBoxField` dropdown. */
export interface ComboBoxOption {
	value: string
	label: string
	description?: string
}

/** Clears an optional closed field — an enum never lists `''` itself. */
export const COMBOBOX_NONE_LABEL = '— none —'

/**
 * Stands in for the unset value of a *required* closed field, so an empty field doesn't
 * read as one that was filled in. Never selectable: it is a prompt, not a value.
 */
export const COMBOBOX_SELECT_LABEL = '— select —'

/** Marks the stored value when it is no longer part of the declared option list. */
export function comboBoxCurrentLabel(current: string): string {
	return `${current} (current)`
}

/**
 * Build the dropdown of a combobox whose options are a closed set, the same way the
 * dashboard's `<select>` builds its `<option>`s, so both surfaces offer the same choices:
 * an explicit clear for an optional field, then the declared options, then the stored
 * value when the schema no longer lists it.
 *
 * The `— select —` prompt of a required-and-empty field is deliberately *not* in here —
 * a text input renders it as its placeholder, where it cannot be picked at all.
 */
export function buildClosedComboBoxOptions(options: readonly ComboBoxOption[], current: string, required: boolean): ComboBoxOption[] {
	const list: ComboBoxOption[] = []
	if (!required) list.push({ value: '', label: COMBOBOX_NONE_LABEL })
	list.push(...options)
	if (current !== '' && !options.some(o => o.value === current)) list.push({ value: current, label: comboBoxCurrentLabel(current) })
	return list
}

export interface ComboBoxCommitInput {
	/** Text typed into the input, or `null` when the user hasn't typed since focusing. */
	query: string | null
	/** Value currently stored on the entry. */
	current: string
	/** Values the dropdown offers. */
	options: readonly string[]
	/** The options are a declared enum, so a value outside them must not be written. */
	closed: boolean
	/** A required field has no empty member in its closed set — there is no `— none —`. */
	required?: boolean
}

/**
 * Decide what a combobox writes for text left in its input (on blur, or on Enter with
 * nothing highlighted). Returns the value to commit, or `null` to leave the stored value
 * exactly as it is.
 *
 * Picking from the list never goes through here — that is always an explicit write.
 */
export function resolveComboBoxCommit({ query, current, options, closed, required }: ComboBoxCommitInput): string | null {
	if (query === null || query === current) return null
	// Suggested options (inferred from existing entries) are a convenience, not a schema:
	// whatever was typed is a legitimate value.
	if (!closed) return query

	const typed = query.trim()
	if (typed === current) return null
	// `''` belongs to the closed set only while the field is optional, where it is what
	// the `— none —` item writes.
	if (typed === '') return required ? null : ''
	// Typing an option out in full counts as picking it. Anything else is discarded back
	// to the stored value — including a value the schema no longer lists, which stays put
	// precisely because the editor refuses to write over it.
	return options.find(o => o === typed) ?? options.find(o => o.toLowerCase() === typed.toLowerCase()) ?? null
}
