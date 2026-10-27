import type {
	CmsEditorState,
	CmsManifest,
	CmsOpenEntryMessage,
	CmsPageNavigatedMessage,
	CmsPostMessage,
	CmsReadyMessage,
	CmsSelectedElement,
	CmsStateChangedMessage,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ManifestEntry,
	PageSeoData,
} from '../types.ts'
import type { ComponentInstance } from '../types.ts'

/** Send a postMessage to the parent window (no-op when not in an iframe) */
export function postToParent(msg: CmsPostMessage): void {
	if (window.parent !== window) {
		window.parent.postMessage(msg, '*')
	}
}

/** Build a CmsSelectedElement from manifest data and outline state */
export function buildSelectedElement(opts: {
	cmsId: string | null
	isComponent: boolean
	componentName?: string
	componentId?: string
	tagName?: string
	rect: { x: number; y: number; width: number; height: number } | null
	entry?: ManifestEntry
	instance?: ComponentInstance
}): CmsSelectedElement {
	const { cmsId, isComponent, componentName, componentId, tagName, rect, entry, instance } = opts
	return {
		cmsId,
		isComponent,
		componentName: componentName ?? instance?.componentName,
		componentId,
		tagName: tagName ?? entry?.tag,
		rect,
		...(entry && {
			text: entry.text,
			html: entry.html,
			sourcePath: entry.sourcePath,
			sourceLine: entry.sourceLine,
			sourceSnippet: entry.sourceSnippet,
			sourceHash: entry.sourceHash,
			stableId: entry.stableId,
			contentPath: entry.contentPath,
			parentComponentId: entry.parentComponentId,
			childCmsIds: entry.childCmsIds,
			imageMetadata: entry.imageMetadata,
			backgroundImage: entry.backgroundImage,
			colorClasses: entry.colorClasses,
			attributes: entry.attributes,
			constraints: entry.constraints,
			allowStyling: entry.allowStyling,
			textResolved: entry.textResolved,
			collectionName: entry.collectionName,
			collectionSlug: entry.collectionSlug,
		}),
		...(instance && {
			component: {
				name: instance.componentName,
				file: instance.file,
				sourcePath: instance.sourcePath,
				sourceLine: instance.sourceLine,
				props: instance.props,
				slots: instance.slots,
			},
		}),
	}
}

/** Build a CmsReadyMessage from the loaded manifest */
export function buildReadyMessage(manifest: CmsManifest, pathname: string): CmsReadyMessage {
	const seo = (manifest as any).seo as PageSeoData | undefined
	const pageTitle = seo?.title?.content ?? manifest.pages?.find(p => p.pathname === pathname)?.title

	return {
		type: 'cms-ready',
		data: {
			pathname,
			pageTitle,
			seo,
			pages: manifest.pages,
			collectionDefinitions: manifest.collectionDefinitions,
			componentDefinitions: manifest.componentDefinitions,
			availableColors: manifest.availableColors,
			availableTextStyles: manifest.availableTextStyles,
			metadata: manifest.metadata,
		},
	}
}

/** Build a CmsPageNavigatedMessage */
export function buildPageNavigatedMessage(manifest: CmsManifest, pathname: string): CmsPageNavigatedMessage {
	const seo = (manifest as any).seo as PageSeoData | undefined
	const pageTitle = seo?.title?.content ?? manifest.pages?.find(p => p.pathname === pathname)?.title

	return {
		type: 'cms-page-navigated',
		page: {
			pathname,
			title: pageTitle,
		},
	}
}

/** Build a CmsEditorState snapshot from current signal values */
export function buildEditorState(opts: {
	isEditing: boolean
	dirtyCount: CmsEditorState['dirtyCount']
	canUndo: boolean
	canRedo: boolean
}): CmsEditorState {
	return {
		isEditing: opts.isEditing,
		hasChanges: opts.dirtyCount.total > 0,
		dirtyCount: opts.dirtyCount,
		canUndo: opts.canUndo,
		canRedo: opts.canRedo,
	}
}

/** Build a CmsStateChangedMessage */
export function buildStateChangedMessage(state: CmsEditorState): CmsStateChangedMessage {
	return {
		type: 'cms-state-changed',
		state,
	}
}

/** Compare paths as the scan and the markers may spell them: with either separator, with or without a leading `./` */
const normalizeSourcePath = (sourcePath: string): string => sourcePath.replace(/\\/g, '/').replace(/^\.\//, '')

/** Entries the host edits under `openEntriesInParent`: content collections. Data and hidden collections stay in the page. */
export function isEditedInHost(definition: CollectionDefinition): boolean {
	return definition.type !== 'data' && !definition.hidden
}

/**
 * The collection entry whose file this is, as the collection scan lists it. A directory can hold
 * more than one collection (a nested collection shares its parent's base), so the file is matched,
 * not its directory.
 */
function findScannedEntry(manifest: CmsManifest, file: string): { definition: CollectionDefinition; entry: CollectionEntryInfo } | undefined {
	const sourcePath = normalizeSourcePath(file)
	for (const definition of Object.values(manifest.collectionDefinitions ?? {})) {
		const entry = definition.entries?.find(e => normalizeSourcePath(e.sourcePath) === sourcePath)
		if (entry) return { definition, entry }
	}
	return undefined
}

function toOpenEntryMessage(definition: CollectionDefinition, entry: CollectionEntryInfo, pathname: string): CmsOpenEntryMessage {
	return { type: 'cms-open-entry', entry: { collection: definition.name, slug: entry.slug, sourcePath: entry.sourcePath, pathname } }
}

/**
 * Build a CmsOpenEntryMessage for the collection entry whose file this is — the file a field on
 * the page was read from, or a markdown body's content file. Undefined when the file is no entry
 * the host edits (an .astro component, a JSON/YAML file, an entry of a data or hidden collection):
 * its fields stay editable in the page.
 *
 * The collection scan names the collection and slug the way the host's collection API (the
 * sidecar, which runs the same scan) does.
 */
export function buildOpenEntryMessageForFile(manifest: CmsManifest, file: string, pathname: string): CmsOpenEntryMessage | undefined {
	const scanned = findScannedEntry(manifest, file)
	return scanned && isEditedInHost(scanned.definition) ? toOpenEntryMessage(scanned.definition, scanned.entry, pathname) : undefined
}

/**
 * Build a CmsOpenEntryMessage for the collection entry a page renders, or undefined when the scan
 * lists it in a collection the host does not edit.
 *
 * The page's entry is matched to its file by URL: its collection is the content directory and its
 * slug the URL's tail. The scan's entry for the same file is sent when there is one (see
 * {@link buildOpenEntryMessageForFile}), the page entry's own names otherwise.
 */
export function buildOpenEntryMessage(entry: CollectionEntry, manifest: CmsManifest, pathname: string): CmsOpenEntryMessage | undefined {
	const scanned = findScannedEntry(manifest, entry.sourcePath)
	if (scanned) return isEditedInHost(scanned.definition) ? toOpenEntryMessage(scanned.definition, scanned.entry, pathname) : undefined
	return { type: 'cms-open-entry', entry: { collection: entry.collectionName, slug: entry.collectionSlug, sourcePath: entry.sourcePath, pathname } }
}
