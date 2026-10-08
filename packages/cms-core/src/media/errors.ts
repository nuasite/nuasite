/**
 * The `error` a media adapter answers with when it refuses what the caller named, or
 * when the file is not there. They are exact strings so a host can tell these apart
 * from a storage failure by comparing, not by reading the text of an arbitrary error:
 * an HTTP layer answers the first two with a 400 and the third with a 404.
 */
export const MEDIA_INVALID_ID = 'Invalid media id'
export const MEDIA_INVALID_FOLDER = 'Invalid folder name'
export const MEDIA_NOT_FOUND = 'Media file not found'
