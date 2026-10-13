/**
 * Absolute paths of files the CMS is about to delete. When the dev server's watcher reports
 * one of them gone, the event is swallowed so the deletion does not trigger a full reload.
 */
export const expectedDeletions = new Set<string>()
