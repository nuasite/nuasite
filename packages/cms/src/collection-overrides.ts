import type { CollectionDefinition } from '@nuasite/cms-types'

/**
 * Per-collection overrides from the Astro config (`nua.cms.collections`), keyed by
 * collection name.
 */
export type CollectionOverrides = Record<string, {
	/**
	 * Display label shown in the CMS (overrides the name-derived default, e.g. "Jsem Otazky" → "Otázky").
	 * Wins over `defineCmsCollection({ cms: { label } })` wherever this integration serves
	 * collections: the in-page editor and the local `/_nua/admin`. A standalone sidecar does
	 * not load the Astro config, so declare the label in the content config to reach it too.
	 */
	label?: string
	fields?: Record<string, { position?: 'sidebar' | 'header'; group?: string }>
}>

/**
 * Lay the Astro-config overrides over freshly scanned definitions, in place.
 *
 * The overrides are the highest-priority answer, and a scan knows nothing about them — so
 * every scan this integration hands on has to pass through here, not only the first one.
 * They used to be applied once at startup; the rescan after an entry create or delete then
 * served the scanner's own labels, and a collection changed its name (and its place in a
 * label-sorted list) the first time an editor saved something.
 */
export function applyCollectionOverrides(
	definitions: Record<string, CollectionDefinition>,
	overrides: CollectionOverrides | undefined,
): Record<string, CollectionDefinition> {
	if (!overrides) return definitions
	for (const [collectionName, override] of Object.entries(overrides)) {
		const def = definitions[collectionName]
		if (!def) continue
		if (override.label) def.label = override.label
		if (!override.fields) continue
		for (const field of def.fields) {
			const fieldOverride = override.fields[field.name]
			if (!fieldOverride) continue
			// `positionDeclared` alongside it, for the same reason the config and directive paths
			// set it: on the wire this `'sidebar'` is the one the scanner also guesses, and a
			// layout that cannot tell them apart overrides the highest-priority answer there is.
			if (fieldOverride.position) {
				field.position = fieldOverride.position
				field.positionDeclared = true
			}
			if (fieldOverride.group) field.group = fieldOverride.group
		}
	}
	return definitions
}
