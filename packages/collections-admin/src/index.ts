/**
 * `@nuasite/collections-admin` — collections SPA over the cms-sidecar `/cms/v1`
 * HTTP contract (cms-headless F3.1 read-only + F3.2 editing). Host-agnostic:
 * mount `<CollectionsAdminApp apiBase={…} />` and it drives its own internal
 * view-state navigation (list → entries → editor/create), debounced optimistic
 * save and `409` conflict resolution. Self-contained styles ship at `./styles.css`.
 */

export { CollectionsAdminApp, type CollectionsAdminAppProps } from './app'
// Re-export the field-type contract values so consumers can drive field UIs off
// the same source of truth — and so `@nuasite/cms-types` is a genuine runtime
// dependency (not type-only), matching the shared-contract intent.
export { FIELD_TYPES, isFieldType } from '@nuasite/cms-types'
// The headless SDK (client + form model) now lives in `@nuasite/cms-client`; the
// default UI surfaces it verbatim so a single import covers UI + client.
export {
	type CmsApiError,
	type CmsCapabilities,
	type CmsClient,
	CmsClientError,
	type CmsConflict,
	type CmsEntriesListResult,
	type CmsErrorCode,
	type CmsPageEntry,
	type CmsProjectModel,
	createClient,
	type CreateEntryInput,
	type EntryDraft,
	type GetEntriesOptions,
	isMediaUnavailable,
	type MediaContext,
	type UpdateEntryInput,
	type UpdateEntryResult,
} from '@nuasite/cms-client'
