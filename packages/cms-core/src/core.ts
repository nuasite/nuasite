import type {
	AddRedirectRequest,
	CollectionDefinition,
	ComponentDefinition,
	CreatePageRequest,
	DeletePageRequest,
	DeleteRedirectRequest,
	DuplicatePageRequest,
	GetRedirectsResponse,
	LayoutInfo,
	MediaStorageAdapter,
	MutationResult,
	PageOperationResponse,
	RedirectOperationResponse,
	UpdateRedirectRequest,
} from '@nuasite/cms-types'
import { scanCollections } from './collection-scanner'
import { scanComponentDefinitions } from './component-registry'
import { type ParseCache } from './content-config-ast'
import type { CmsFileSystem } from './fs/types'
import {
	addArrayItem as addArrayItemOp,
	type AddArrayItemInput,
	createEntry as createEntryOp,
	type CreateEntryInput,
	deleteEntry as deleteEntryOp,
	type EntryAsset,
	type EntryOpsDeps,
	getEntry as getEntryOp,
	getEntryAsset as getEntryAssetOp,
	type GetEntryResult,
	removeArrayItem as removeArrayItemOp,
	type RemoveArrayItemInput,
	renameEntry as renameEntryOp,
	updateEntry as updateEntryOp,
	type UpdateEntryInput,
} from './handlers/entry-ops'
import {
	createPage as createPageOp,
	deletePage as deletePageOp,
	duplicatePage as duplicatePageOp,
	getLayouts as getLayoutsOp,
} from './handlers/page-ops'
import {
	addRedirect as addRedirectOp,
	deleteRedirect as deleteRedirectOp,
	listRedirects as listRedirectsOp,
	updateRedirect as updateRedirectOp,
} from './handlers/redirect-ops'

export interface CmsCoreOptions {
	/** Content collections directory, relative to the filesystem root. Defaults to `src/content`. */
	contentDir?: string
	/** Pluggable media storage adapter (local / s3 / contember). */
	media?: MediaStorageAdapter
	/** Directories to scan for Astro components (used for MDX import resolution). Defaults to `['src/components']`. */
	componentDirs?: string[]
}

/**
 * The framework-agnostic CMS brain over a `CmsFileSystem` port.
 *
 * Exposes the read/scan surface plus the structural mutations (entry / array /
 * page / redirect CRUD) and a pluggable media adapter. All I/O flows through the
 * injected `CmsFileSystem`; nothing here knows about Astro, Vite, HTTP or the
 * render-time page manifest.
 */
export interface CmsCore {
	// READ / SCAN
	/** Scan all content collections, returning their inferred definitions keyed by name. */
	scanCollections(): Promise<Record<string, CollectionDefinition>>
	/** Resolve the Astro component definitions used for MDX import injection. */
	scanComponents(): Promise<Record<string, ComponentDefinition>>
	/** Read a single entry's frontmatter + body, or `null` when it does not exist. */
	getEntry(collection: string, slug: string): Promise<GetEntryResult | null>
	/** Read an asset referenced by an entry (`image`/`file` value), resolving its path relative to the entry source. `null` when missing. */
	getEntryAsset(collection: string, slug: string, assetPath: string): Promise<EntryAsset | null>

	// ENTRY MUTATIONS
	createEntry(input: CreateEntryInput): Promise<MutationResult>
	updateEntry(input: UpdateEntryInput): Promise<MutationResult>
	deleteEntry(collection: string, slug: string): Promise<MutationResult>
	renameEntry(collection: string, from: string, to: string): Promise<MutationResult>

	// ENTRY-FRONTMATTER ARRAY FIELDS
	addArrayItem(input: AddArrayItemInput): Promise<MutationResult>
	removeArrayItem(input: RemoveArrayItemInput): Promise<MutationResult>

	// PAGES / REDIRECTS
	createPage(input: CreatePageRequest): Promise<PageOperationResponse>
	duplicatePage(input: DuplicatePageRequest): Promise<PageOperationResponse>
	deletePage(input: DeletePageRequest): Promise<PageOperationResponse>
	getLayouts(): Promise<LayoutInfo[]>
	listRedirects(): Promise<GetRedirectsResponse>
	addRedirect(input: AddRedirectRequest): Promise<RedirectOperationResponse>
	updateRedirect(input: UpdateRedirectRequest): Promise<RedirectOperationResponse>
	deleteRedirect(input: DeleteRedirectRequest): Promise<RedirectOperationResponse>

	// MEDIA (pluggable adapter; undefined when none is configured)
	media?: MediaStorageAdapter
}

export function createCmsCore(fs: CmsFileSystem, opts: CmsCoreOptions = {}): CmsCore {
	const contentDir = opts.contentDir ?? 'src/content'
	const componentDirs = opts.componentDirs ?? ['src/components']
	// One mtime-keyed content-config parse cache per core instance (per project root).
	const parseCache: ParseCache = new Map()

	const entryDeps: EntryOpsDeps = {
		fs,
		contentDir,
		parseCache,
		componentDirs,
		resolveComponentDefinitions: () => scanComponentDefinitions(fs, componentDirs),
	}

	return {
		scanCollections() {
			return scanCollections(fs, contentDir, parseCache)
		},
		scanComponents() {
			return scanComponentDefinitions(fs, componentDirs)
		},
		getEntry(collection, slug) {
			return getEntryOp(entryDeps, collection, slug)
		},
		getEntryAsset(collection, slug, assetPath) {
			return getEntryAssetOp(entryDeps, collection, slug, assetPath)
		},
		createEntry(input) {
			return createEntryOp(entryDeps, input)
		},
		updateEntry(input) {
			return updateEntryOp(entryDeps, input)
		},
		deleteEntry(collection, slug) {
			return deleteEntryOp(entryDeps, collection, slug)
		},
		renameEntry(collection, from, to) {
			return renameEntryOp(entryDeps, collection, from, to)
		},
		addArrayItem(input) {
			return addArrayItemOp(entryDeps, input)
		},
		removeArrayItem(input) {
			return removeArrayItemOp(entryDeps, input)
		},
		createPage(input) {
			return createPageOp({ fs }, input)
		},
		duplicatePage(input) {
			return duplicatePageOp({ fs }, input)
		},
		deletePage(input) {
			return deletePageOp({ fs }, input)
		},
		getLayouts() {
			return getLayoutsOp({ fs })
		},
		listRedirects() {
			return listRedirectsOp({ fs })
		},
		addRedirect(input) {
			return addRedirectOp({ fs }, input)
		},
		updateRedirect(input) {
			return updateRedirectOp({ fs }, input)
		},
		deleteRedirect(input) {
			return deleteRedirectOp({ fs }, input)
		},
		media: opts.media,
	}
}
