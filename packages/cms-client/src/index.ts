/**
 * `@nuasite/cms-client` — the headless TypeScript SDK for the Nua CMS.
 *
 * Framework-agnostic (zero React/DOM): a typed `fetch` client over the
 * cms-sidecar `/cms/v1` HTTP contract plus the pure entry-draft form model
 * (field coercion, wire ↔ native mapping, optimistic-concurrency helpers).
 *
 * Any host builds its own collections UI on top of this: webmaster's native
 * tab, the `@nuasite/collections-admin` default SPA, or a third party. The
 * structural contract types live in `@nuasite/cms-types`; this package adds
 * the thin HTTP envelope (project model, sparse entries list, error/conflict
 * shapes) and the editor-side draft logic.
 */

// Surface the field-type contract values from the SDK so UI consumers can drive
// field widgets off one import — and so `@nuasite/cms-types` is a genuine runtime
// dependency (not type-only), matching the shared-contract intent.
export { FIELD_TYPES, isFieldType } from '@nuasite/cms-types'
export type { CmsConfig, CmsListStyle } from '@nuasite/cms-types'
export * from './client'
export * from './form-model'
