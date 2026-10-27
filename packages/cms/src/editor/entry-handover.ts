import type { CmsManifest, CmsOpenEntryMessage, ManifestEntry } from '../types.ts'
import { CSS } from './constants.ts'
import { buildOpenEntryMessage, buildOpenEntryMessageForFile } from './post-message.ts'
import * as signals from './signals.ts'

const MARKDOWN_ATTRIBUTE = 'data-cms-markdown'

type ReferencedBy = NonNullable<ManifestEntry['referencedBy']>

/**
 * The collection entry the host edits in place of this element, when it edits entries
 * (`openEntriesInParent`): the entry whose file a field was read from, a markdown body's content
 * file, and for a reference the entry whose field holds it. Undefined when the element stays
 * edited in the page.
 */
export function entryHandoverFor(el: HTMLElement): CmsOpenEntryMessage | undefined {
	if (!signals.opensEntriesInParent.value) return undefined
	const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)
	const manifest = signals.manifest.value
	const entry = cmsId ? manifest.entries[cmsId] : undefined
	if (!entry) return undefined
	const pathname = window.location.pathname

	// A reference's text is read from the referenced entry, but picking it edits the referencing one.
	if (entry.referenceCollection && entry.referencedBy?.length) {
		return referencingEntryHandover(el, entry.referencedBy, manifest, pathname)
	}
	if (el.hasAttribute(MARKDOWN_ATTRIBUTE)) {
		const file = entry.contentPath ?? entry.sourcePath
		if (file) return buildOpenEntryMessageForFile(manifest, file, pathname)
		// A body without a file of its own is the page's.
		return pageEntryHandover(manifest, pathname)
	}
	return entry.sourcePath ? buildOpenEntryMessageForFile(manifest, entry.sourcePath, pathname) : undefined
}

function pageEntryHandover(manifest: CmsManifest, pathname: string): CmsOpenEntryMessage | undefined {
	const pageEntry = signals.currentPageCollection.value
	return pageEntry ? buildOpenEntryMessage(pageEntry, manifest, pathname) : undefined
}

function referencingEntryHandover(
	el: HTMLElement,
	referencedBy: ReferencedBy,
	manifest: CmsManifest,
	pathname: string,
): CmsOpenEntryMessage | undefined {
	const owner = findOwnerEntry(el, manifest, referencedBy)
	const ownerFile = owner && manifest.collectionDefinitions?.[owner.collection]?.entries?.find(e => e.slug === owner.slug)?.sourcePath
	if (ownerFile) return buildOpenEntryMessageForFile(manifest, ownerFile, pathname)
	// The owner's slug can be the URL's tail rather than the scan's; on an entry's page the page's entry holds the reference.
	const page = pageEntryHandover(manifest, pathname)
	return page && referencedBy.some(ref => ref.collection === page.entry.collection) ? page : undefined
}

/**
 * Walk up the DOM from a reference element to find the owning collection entry.
 * At each parent level, only checks direct children (not nested descendants)
 * to avoid matching elements from adjacent cards on listing pages.
 */
export function findOwnerEntry(
	element: HTMLElement,
	manifest: { entries: Record<string, ManifestEntry> },
	referencedBy: ReferencedBy,
): { collection: string; slug: string; fieldName: string; isArray?: boolean } | undefined {
	const refMap = new Map(referencedBy.map(r => [r.collection, r]))
	let current: HTMLElement | null = element

	while (current && current !== document.body) {
		const parent: HTMLElement | null = current.parentElement
		if (!parent) break

		for (const sibling of parent.children) {
			if (sibling === current || !(sibling instanceof HTMLElement)) continue

			const candidates: Element[] = sibling.hasAttribute('data-cms-id') ? [sibling] : []
			candidates.push(...sibling.querySelectorAll('[data-cms-id]'))

			for (const el of candidates) {
				const id = el.getAttribute('data-cms-id')
				if (!id) continue
				const entry = manifest.entries[id]
				if (!entry?.collectionSlug || !entry.collectionName) continue

				const ref = refMap.get(entry.collectionName)
				if (!ref) continue

				return {
					collection: entry.collectionName,
					slug: entry.collectionSlug,
					fieldName: ref.fieldName,
					isArray: ref.isArray,
				}
			}
		}
		current = parent
	}
	return undefined
}
