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
		// Insert the publish toggle above the publish-date field in sidebar; otherwise prepend.
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
