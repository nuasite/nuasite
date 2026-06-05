/**
 * `@nuasite/collections-admin` — read-only collections SPA over the cms-sidecar
 * `/cms/v1` HTTP contract (cms-headless F3.1). Host-agnostic: mount
 * `<CollectionsAdminApp apiBase={…} />` and it drives its own internal view-state
 * navigation. Self-contained styles ship at `./styles.css` (imported by the app).
 */

export { CollectionsAdminApp, type CollectionsAdminAppProps } from './app'
export {
	type CmsApiError,
	type CmsCapabilities,
	type CmsClient,
	CmsClientError,
	type CmsEntriesListResult,
	type CmsErrorCode,
	type CmsPageEntry,
	type CmsProjectModel,
	createClient,
	type GetEntriesOptions,
} from './client'
