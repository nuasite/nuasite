/**
 * How the collections of a project are arranged in a collection browser — the one answer
 * every browser renders from.
 *
 * It lives here for the reason `field-values.ts` does: there is more than one browser
 * (`@nuasite/cms`'s in-page editor, `@nuasite/collections-admin`, webmaster's collections
 * panel), each had its own sort and its own idea of where a nested collection goes, and
 * `cms-types` is the one package all of them already depend on. The inputs are the
 * collection-level keys of `defineCmsCollection({ cms: { label, hidden, order, group } })`
 * as the scan carries them on a `CollectionDefinition`.
 *
 * The rule, in the order it is applied:
 *
 * 1. `hidden` collections are dropped. Only from this arrangement — they stay in the list
 *    the caller holds, which is what reference pickers and entry routes resolve through.
 * 2. The rest is sorted by `order` (lower first, undeclared last), then by label, then by
 *    name. WHY the name: the sidecar serves collections in no particular order, and two
 *    collections may share a label, so without a last word the list would reshuffle between
 *    reloads.
 * 3. A collection is listed under its `parentCollection`. One level, as every browser draws
 *    it: a child whose parent is hidden, missing or itself a child is listed at the top
 *    level instead, so nothing reachable disappears from the browser.
 * 4. Top-level collections without a `group` come first, then one section per group, in the
 *    order their first member sorted. A nested collection follows its parent; its own
 *    `group` only matters once it is listed at the top level.
 */

import type { CollectionDefinition } from './index'

/** A top-level collection and the collections nested under it. */
export interface CollectionNavItem {
	collection: CollectionDefinition
	/** Collections whose `parentCollection` is this one, already ordered. */
	children: CollectionDefinition[]
}

/** One block of the browser: the leading ungrouped block, or the collections of one `group`. */
export interface CollectionNavSection {
	/** Section heading. Absent on the leading block of collections that declare no `group`. */
	group?: string
	items: CollectionNavItem[]
}

export interface CollectionNavOptions {
	/**
	 * Locale the labels are compared in — the language of the site's content, when the host
	 * knows it (`'cs'` puts "Č" after "C"). Defaults to the runtime's own locale, which is what
	 * `localeCompare` without an argument uses; a tag `Intl` rejects falls back to it too.
	 */
	locale?: Intl.LocalesArgument
}

function labelCollator(locale: Intl.LocalesArgument): Intl.Collator {
	try {
		return new Intl.Collator(locale)
	} catch {
		// A malformed tag (`<html lang="cs_CZ">`) throws; a browser that cannot list
		// collections is a worse outcome than one sorted in the default locale.
		return new Intl.Collator()
	}
}

/** Arrange collections for a collection browser. Pure; the input is not modified. */
export function resolveCollectionNav(collections: readonly CollectionDefinition[], options: CollectionNavOptions = {}): CollectionNavSection[] {
	const collator = labelCollator(options.locale)
	const sorted = collections.filter(collection => !collection.hidden).sort((a, b) => {
		const orderA = a.order ?? Number.POSITIVE_INFINITY
		const orderB = b.order ?? Number.POSITIVE_INFINITY
		if (orderA !== orderB) return orderA < orderB ? -1 : 1
		return collator.compare(a.label, b.label) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
	})

	const byName = new Map(sorted.map(collection => [collection.name, collection]))
	const visibleParent = (collection: CollectionDefinition): CollectionDefinition | undefined =>
		collection.parentCollection === undefined || collection.parentCollection === collection.name ? undefined : byName.get(collection.parentCollection)

	const itemsByName = new Map<string, CollectionNavItem>()
	const ungrouped: CollectionNavItem[] = []
	const groups = new Map<string, CollectionNavItem[]>()
	const nested: Array<[parent: CollectionDefinition, child: CollectionDefinition]> = []

	for (const collection of sorted) {
		const parent = visibleParent(collection)
		if (parent && !visibleParent(parent)) {
			nested.push([parent, collection])
			continue
		}
		const item: CollectionNavItem = { collection, children: [] }
		itemsByName.set(collection.name, item)
		if (!collection.group) {
			ungrouped.push(item)
			continue
		}
		const members = groups.get(collection.group)
		if (members) members.push(item)
		else groups.set(collection.group, [item])
	}
	// After the pass above, because a child may sort ahead of the parent it belongs under.
	for (const [parent, child] of nested) itemsByName.get(parent.name)?.children.push(child)

	const sections: CollectionNavSection[] = ungrouped.length > 0 ? [{ items: ungrouped }] : []
	for (const [group, items] of groups) sections.push({ group, items })
	return sections
}
