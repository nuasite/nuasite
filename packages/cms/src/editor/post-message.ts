import type {
	CmsEditorState,
	CmsManifest,
	CmsPageNavigatedMessage,
	CmsPostMessage,
	CmsReadyMessage,
	CmsSelectedElement,
	CmsStateChangedMessage,
	ManifestEntry,
	PageSeoData,
} from '../types'
import type { ComponentInstance } from '../types'

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
	deploymentStatus: CmsEditorState['deployment']['status']
	lastDeployedAt: string | null
	canUndo: boolean
	canRedo: boolean
}): CmsEditorState {
	return {
		isEditing: opts.isEditing,
		hasChanges: opts.dirtyCount.total > 0,
		dirtyCount: opts.dirtyCount,
		deployment: {
			status: opts.deploymentStatus,
			lastDeployedAt: opts.lastDeployedAt,
		},
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
