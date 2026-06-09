/**
 * Media capability the editor consumes to browse/upload assets (the gallery in
 * `media-library.tsx`, image props in the block card, prose image insertion).
 *
 * It is a *structural* subset of `@nuasite/cms-client`'s `CmsClient` — the host
 * passes its `client` straight in (`media={client}`) without this package taking a
 * dependency on the SDK. `createFolder` is optional so an older client (or a
 * sidecar with a folder-less adapter) still satisfies it; the gallery hides the
 * "new folder" affordance when it is absent.
 */
import type { MediaListResult, MediaUploadResult } from '@nuasite/cms-types'

/** Where an upload is filed — mirrors the SDK's `MediaContext`. */
export interface MediaUploadContext {
	collection?: string
	entry?: string
	field?: string
	/** Subfolder under the media root. */
	folder?: string
}

export interface MediaSource {
	listMedia(options?: { folder?: string; cursor?: string; limit?: number }): Promise<MediaListResult>
	uploadMedia(file: File, context?: MediaUploadContext): Promise<MediaUploadResult>
	createFolder?(folder: string): Promise<{ success: boolean; error?: string }>
}

/** Editor-level upload context (the field name is added per call-site). */
export interface MediaContext {
	collection?: string
	entry?: string
}

/**
 * Whether a thrown error means "media is not wired" — the deployed sidecar may
 * answer media routes with `501 unsupported`. Duck-typed (no dependency on the
 * SDK's `CmsClientError`) so the gallery degrades to a manual-URL hint instead of
 * a hard error.
 */
export function isMediaUnavailableError(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false
	if ('status' in err && err.status === 501) return true
	if ('code' in err && err.code === 'unsupported') return true
	return false
}
