import { createContemberStorageAdapter, createLocalStorageAdapter, createS3StorageAdapter } from '@nuasite/cms-core'
import type { MediaStorageAdapter } from '@nuasite/cms-types'

/**
 * Pick the media storage adapter from the environment.
 *
 * `CMS_MEDIA_ADAPTER` selects the backend:
 *   - `contember` (default): proxies to the Contember worker's CMS media API.
 *       NUA_SITE_API_BASE_URL   — worker API base, e.g. https://api.example.com
 *       NUA_SITE_PROJECT_SLUG   — project slug used in the media API path
 *       NUA_SITE_SESSION_TOKEN  — session token (NUA_SITE_SESSION_TOKEN cookie value)
 *   - `s3`: an S3-compatible bucket (needs the optional `@aws-sdk/client-s3` peer).
 *       CMS_MEDIA_S3_BUCKET             — bucket name (required)
 *       CMS_MEDIA_S3_REGION            — region (required)
 *       CMS_MEDIA_S3_ACCESS_KEY_ID     — access key (optional; falls back to the SDK chain)
 *       CMS_MEDIA_S3_SECRET_ACCESS_KEY — secret key (optional)
 *       CMS_MEDIA_S3_ENDPOINT          — custom endpoint (optional, e.g. R2)
 *       CMS_MEDIA_S3_CDN_PREFIX        — public CDN URL prefix (optional)
 *       CMS_MEDIA_S3_PREFIX            — key prefix (optional, default 'uploads')
 *   - `local`: filesystem under `public/uploads`.
 *       CMS_MEDIA_LOCAL_DIR        — storage dir (optional, default 'public/uploads')
 *       CMS_MEDIA_LOCAL_URL_PREFIX — served URL prefix (optional, default '/uploads')
 *   - `none`: no media adapter (media routes answer 501 unsupported).
 *
 * Reads are confined to this module; the adapters themselves never touch
 * `process.env`. Returns `undefined` when no adapter is configured.
 */
export type MediaAdapterKind = 'contember' | 's3' | 'local' | 'none'

const VALID_KINDS: readonly MediaAdapterKind[] = ['contember', 's3', 'local', 'none']

function isMediaAdapterKind(value: string): value is MediaAdapterKind {
	return (VALID_KINDS as readonly string[]).includes(value)
}

export interface MediaFromEnvResult {
	kind: MediaAdapterKind
	adapter?: MediaStorageAdapter
}

export function mediaFromEnv(env: NodeJS.ProcessEnv = process.env): MediaFromEnvResult {
	const requested = env.CMS_MEDIA_ADAPTER?.trim().toLowerCase()
	const kind: MediaAdapterKind = requested && isMediaAdapterKind(requested) ? requested : 'contember'

	switch (kind) {
		case 'none':
			return { kind }

		case 'local':
			return {
				kind,
				adapter: createLocalStorageAdapter({
					dir: env.CMS_MEDIA_LOCAL_DIR,
					urlPrefix: env.CMS_MEDIA_LOCAL_URL_PREFIX,
				}),
			}

		case 's3': {
			const bucket = env.CMS_MEDIA_S3_BUCKET
			const region = env.CMS_MEDIA_S3_REGION
			if (!bucket || !region) {
				throw new Error('CMS_MEDIA_ADAPTER=s3 requires CMS_MEDIA_S3_BUCKET and CMS_MEDIA_S3_REGION')
			}
			return {
				kind,
				adapter: createS3StorageAdapter({
					bucket,
					region,
					accessKeyId: env.CMS_MEDIA_S3_ACCESS_KEY_ID,
					secretAccessKey: env.CMS_MEDIA_S3_SECRET_ACCESS_KEY,
					endpoint: env.CMS_MEDIA_S3_ENDPOINT,
					cdnPrefix: env.CMS_MEDIA_S3_CDN_PREFIX,
					prefix: env.CMS_MEDIA_S3_PREFIX,
				}),
			}
		}

		case 'contember': {
			const apiBaseUrl = env.NUA_SITE_API_BASE_URL
			const projectSlug = env.NUA_SITE_PROJECT_SLUG
			// Without the API base + project slug we cannot reach the worker; treat as
			// "no media configured" rather than constructing a broken adapter.
			if (!apiBaseUrl || !projectSlug) {
				return { kind: 'none' }
			}
			return {
				kind,
				adapter: createContemberStorageAdapter({
					apiBaseUrl,
					projectSlug,
					sessionToken: env.NUA_SITE_SESSION_TOKEN,
				}),
			}
		}
	}
}
