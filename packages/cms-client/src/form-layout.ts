/**
 * Where each field goes in an entry form — the one answer every collections UI renders from.
 *
 * This is the layout half of the form model, and it lives here for the reason `field-values.ts`
 * lives in `cms-types`: there is more than one editor, and a rule only some of them implement is
 * a rule that drifts. `@nuasite/collections-admin` and webmaster's collections panel had a copy
 * each, and the copies disagreed about the two things below that carry a `WHY` — one of them
 * rendered a collection's declared `cms.sections` and the other could not.
 *
 * Pure and React-free (the package promise), so both a React SPA and a server-rendered form can
 * ask it, and so the interesting cases are unit tests rather than a screenshot.
 *
 * The output is a render plan, not a component tree:
 *
 * - `title` — the entry's headline field, ahead of everything. WHY: `scanCollections` puts
 *   `title` in `SIDEBAR_FIELD_NAMES`, so left alone the heuristic files an entry's headline in
 *   the side column, and in a narrow viewport that lands it halfway down the stack. Explicit
 *   placement still wins; this only fires when nothing in the config placed the field.
 * - `header` — fields the *author* pinned to a top strip (`@position header`,
 *   `n.text({ position: 'header' })`). WHY it is safe to read now: the scanner used to stamp
 *   `position: 'header'` on every field it did not recognise, so a strip built from it swallowed
 *   the whole form and left `sections` empty. It no longer writes that default, so `'header'`
 *   means somebody asked for it.
 * - `sidebar` — declared `cms.sidebar` first, in the order it was declared, then the fields the
 *   scanner or config marked `position: 'sidebar'`, with publish controls floated to the top.
 * - `sections` — the main column, as titled blocks. Declared `cms.sections` win, in their
 *   declared order, and whatever they leave out lands in a trailing `Other` rather than
 *   inheriting the previous block's heading.
 * - `display` — stacked or tabbed, defaulting to tabs once there are more blocks than a column
 *   reads well as.
 */

import type { CollectionLayout, FieldDefinition } from '@nuasite/cms-types'

/** Above this many main sections, default to tabs instead of a long stack. */
const AUTO_TAB_THRESHOLD = 4

/** Names (normalized) of the field that leads the form as the entry's headline. */
const TITLE_FIELD_NAMES = ['title', 'name', 'heading', 'headline']

/** One titled block of the main column. An absent `title` renders as bare fields, no chrome. */
export interface RenderSection {
	title?: string
	fields: FieldDefinition[]
	collapsed?: boolean
}

/** The render plan for one entry form. */
export interface RenderLayout {
	/** The headline field, rendered ahead of every section — never inside one. */
	title: FieldDefinition | undefined
	header: FieldDefinition[]
	sidebar: FieldDefinition[]
	sections: RenderSection[]
	display: 'sections' | 'tabs'
}

/** Normalize a field name for case-/separator-insensitive matching. */
function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[_-]/g, '')
}

/**
 * The text field that holds the entry's headline, by name.
 *
 * Only `text`/`textarea` qualify: a collection whose `name` is a reference or a select means
 * something else by it, and promoting that to the headline slot would be a guess about data.
 */
export function findTitleField(fields: FieldDefinition[]): FieldDefinition | undefined {
	const textual = fields.filter(field => field.type === 'text' || field.type === 'textarea')
	for (const wanted of TITLE_FIELD_NAMES) {
		const match = textual.find(field => normalizeName(field.name) === wanted)
		if (match) return match
	}
	return undefined
}

/** What a field is called in the form. The declared `label` is the author's wording; the raw name is the fallback. */
export function fieldLabel(field: FieldDefinition): string {
	return field.label ?? field.name
}

/** Prettify a raw field name for a section title (e.g. `pricing_tiers` → `Pricing tiers`). */
function prettify(name: string): string {
	const spaced = name.replace(/[_-]+/g, ' ').trim()
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Publish toggle, then publish date, then everything else. */
function roleRank(field: FieldDefinition): number {
	return field.role === 'publish-toggle' ? 0 : field.role === 'publish-date' ? 1 : 2
}

/**
 * Stable sort by explicit `order`.
 *
 * Unset counts as `0`, not as "last": `order` is a weight around the schema's own order, so
 * `order: -2` pulls a field to the front and `order: 5` pushes it back, and everything untouched
 * keeps the position the schema gave it.
 */
function sortByOrder(fields: FieldDefinition[]): FieldDefinition[] {
	return fields
		.map((field, index) => [field, index] as const)
		.sort((a, b) => (a[0].order ?? 0) - (b[0].order ?? 0) || a[1] - b[1])
		.map(([field]) => field)
}

/**
 * Default sections when no `cms.sections` are declared: scalar fields group by `group`
 * (consecutive same-group fields share a section; ungrouped → an untitled section), and each
 * nested `object`/`array` field becomes its own collapsible section — so a big schema reads as
 * discrete blocks rather than one long column.
 */
function deriveDefaultSections(main: FieldDefinition[]): RenderSection[] {
	const scalarSections: RenderSection[] = []
	const byGroup = new Map<string, RenderSection>()
	const structural: RenderSection[] = []
	for (const field of main) {
		if (field.type === 'object' || field.type === 'array') {
			structural.push({ title: field.label ?? prettify(field.name), fields: [field], collapsed: true })
		} else {
			const key = field.group ?? ''
			let section = byGroup.get(key)
			if (!section) {
				section = { title: field.group, fields: [] }
				byGroup.set(key, section)
				scalarSections.push(section)
			}
			section.fields.push(field)
		}
	}
	return [...scalarSections, ...structural]
}

/** Every field name the config placed by hand — the set the title heuristic must not override. */
function declaredNames(layout: CollectionLayout | undefined): Set<string> {
	const names = new Set(layout?.sidebar ?? [])
	for (const section of layout?.sections ?? []) {
		for (const name of section.fields) names.add(name)
	}
	return names
}

/**
 * Build the render plan from a collection's fields and its declarative layout, if any.
 *
 * `hidden` fields are dropped up front and never reach any slot: they are the fields no form can
 * fill in, which is a property of the field, not of where it would have gone.
 */
export function resolveFormLayout(fields: FieldDefinition[], layout?: CollectionLayout): RenderLayout {
	const visible = sortByOrder(fields.filter(field => !field.hidden))
	const byName = new Map(visible.map(field => [field.name, field] as const))
	const placed = declaredNames(layout)

	// The headline leads the form — unless the config placed that field itself, in which case the
	// author has already said where it goes and this heuristic has nothing to add.
	const candidate = findTitleField(visible)
	const title = candidate && !placed.has(candidate.name) && candidate.position !== 'header' ? candidate : undefined

	const header = visible.filter(field => field !== title && field.position === 'header')

	// Declared order first — `cms.sidebar` is a list, and a list the author wrote in an order is
	// an order they meant. The scanner's own picks follow, then publish controls float to the top.
	const sidebar: FieldDefinition[] = []
	const inSidebar = new Set<string>()
	for (const name of layout?.sidebar ?? []) {
		const field = byName.get(name)
		if (field && field !== title && field.position !== 'header' && !inSidebar.has(name)) {
			sidebar.push(field)
			inSidebar.add(name)
		}
	}
	for (const field of visible) {
		if (field === title || field.position === 'header' || inSidebar.has(field.name)) continue
		if (field.position === 'sidebar' || field.role !== undefined) {
			sidebar.push(field)
			inSidebar.add(field.name)
		}
	}
	sidebar.sort((a, b) => roleRank(a) - roleRank(b))

	const main = visible.filter(field => field !== title && field.position !== 'header' && !inSidebar.has(field.name))

	let sections: RenderSection[]
	if (layout?.sections && layout.sections.length > 0) {
		const used = new Set<string>()
		sections = layout.sections
			.map(section => {
				// Declared order, and only fields that are actually in the main column: a name that is
				// unknown, hidden, sidebar'd or repeated is silently skipped rather than duplicating a
				// field or rendering a blank row for one that does not exist.
				const sectionFields = sortedSectionFields(section.fields, byName, main, used)
				return { title: section.title, fields: sectionFields, collapsed: section.collapsed }
			})
			.filter(section => section.fields.length > 0)
		// Anything the declared sections left out gets its own block. WHY it is not simply appended:
		// a trailing run of unlisted fields rendered flat reads as belonging to the last section's
		// heading, which is the opposite of what the author declared.
		const leftover = main.filter(field => !used.has(field.name))
		if (leftover.length > 0) sections.push({ title: 'Other', fields: leftover })
	} else {
		sections = deriveDefaultSections(main)
	}

	const display = layout?.display ?? (sections.length > AUTO_TAB_THRESHOLD ? 'tabs' : 'sections')
	return { title, header, sidebar, sections, display }
}

/** Resolve one declared section's field names against the main column, marking what it consumed. */
function sortedSectionFields(
	names: string[],
	byName: Map<string, FieldDefinition>,
	main: FieldDefinition[],
	used: Set<string>,
): FieldDefinition[] {
	const fields: FieldDefinition[] = []
	for (const name of names) {
		const field = byName.get(name)
		if (!field || used.has(name) || !main.includes(field)) continue
		used.add(name)
		fields.push(field)
	}
	return fields
}
