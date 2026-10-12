/**
 * The `error` a media adapter answers with when it refuses what the caller named, or
 * when the file is not there. They are exact strings so a host can tell these apart
 * from a storage failure by comparing, not by reading the text of an arbitrary error:
 * an HTTP layer answers the first two with a 400 and the third with a 404.
 */
export const MEDIA_INVALID_ID = 'Invalid media id'
export const MEDIA_INVALID_FOLDER = 'Invalid folder name'
export const MEDIA_NOT_FOUND = 'Media file not found'

/**
 * The HTTP status for a failed media adapter result: 400 for an id or folder the adapter
 * refuses, 404 for a file that is not there, 500 for anything else. Only the exact
 * strings above decide; the text of any other error may come from an SDK or an upstream
 * service and is a storage failure whatever it says.
 */
export function mediaErrorStatus(error: string | undefined): 400 | 404 | 500 {
	if (error === MEDIA_INVALID_ID || error === MEDIA_INVALID_FOLDER) return 400
	if (error === MEDIA_NOT_FOUND) return 404
	return 500
}
