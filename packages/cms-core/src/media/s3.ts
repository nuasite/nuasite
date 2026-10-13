import type { MediaFolderItem, MediaListResult, MediaStorageAdapter, MediaUploadResult } from '@nuasite/cms-types'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { MEDIA_INVALID_FOLDER, MEDIA_INVALID_ID } from './errors'
import { getFileExtension, mimeFromExt } from './mime'
import { hasDotSegment, isUnsafeFolder } from './names'

/*
 * S3 keys are literal, so `.` and `..` name nothing special there. Whatever sits in
 * front of the bucket (a CDN, a proxy, the URL built from the key) may still resolve
 * them, so the adapter neither builds nor accepts one in what a caller supplies: a
 * folder (spelled out, percent-encoded or with a backslash, see `isUnsafeFolder`), or
 * the part of a key after the configured prefix.
 */

/**
 * A `folder` option as the `a/b` spelling keys are built from. Stray slashes are dropped
 * (`/a//b/` is `a/b`), as the local adapter does, so no key `upload` hands out holds an
 * empty segment that `delete` would refuse.
 */
function normalizeFolder(folder: string | undefined): string {
	return (folder ?? '').split('/').filter(Boolean).join('/')
}

export interface S3StorageOptions {
	bucket: string
	region: string
	accessKeyId?: string
	secretAccessKey?: string
	endpoint?: string
	cdnPrefix?: string
	prefix?: string
}

// Dynamic import helper to avoid TS2307 for the optional `@aws-sdk/client-s3` peer dependency.
const s3Module = '@aws-sdk/client-s3'
async function loadS3(): Promise<any> {
	return import(/* @vite-ignore */ s3Module)
}

export function createS3StorageAdapter(options: S3StorageOptions): MediaStorageAdapter {
	const { bucket, region, accessKeyId, secretAccessKey, endpoint, cdnPrefix, prefix = 'uploads' } = options

	let s3Client: any = null

	async function getClient() {
		if (s3Client) return s3Client
		const { S3Client } = await loadS3()
		s3Client = new S3Client({
			region,
			...(endpoint ? { endpoint } : {}),
			...(accessKeyId && secretAccessKey
				? { credentials: { accessKeyId, secretAccessKey } }
				: {}),
		})
		return s3Client
	}

	function getUrl(key: string): string {
		if (cdnPrefix) {
			return `${cdnPrefix.replace(/\/$/, '')}/${key}`
		}
		if (endpoint) {
			return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
		}
		return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
	}

	return {
		async list(opts) {
			const { ListObjectsV2Command } = await loadS3()
			const client = await getClient()

			const limit = opts?.limit ?? 50
			const folder = normalizeFolder(opts?.folder)
			if (isUnsafeFolder(folder)) return { items: [], folders: [], hasMore: false } satisfies MediaListResult

			const listPrefix = [prefix, folder].filter(Boolean).join('/')
			const delimiterPrefix = listPrefix ? `${listPrefix}/` : ''

			const command = new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: delimiterPrefix,
				Delimiter: '/',
				MaxKeys: limit + 1,
				...(opts?.cursor ? { ContinuationToken: opts.cursor } : {}),
			})

			const result = await client.send(command)

			const folders: MediaFolderItem[] = (result.CommonPrefixes ?? []).map((cp: any) => {
				const fullPrefix = String(cp.Prefix).replace(/\/$/, '')
				const name = fullPrefix.split('/').pop() ?? fullPrefix
				const relativePath = prefix ? fullPrefix.slice(prefix.length + 1) : fullPrefix
				return { name, path: relativePath }
			})

			const contents = (result.Contents ?? []).filter((obj: any) => {
				const key: string = obj.Key
				return key !== delimiterPrefix
			})

			const hasMore = contents.length > limit
			const items = contents.slice(0, limit).map((obj: any) => {
				const key: string = obj.Key
				const filename = key.split('/').pop() ?? key
				return {
					id: key,
					url: getUrl(key),
					filename,
					contentType: mimeFromExt(path.extname(key).toLowerCase()),
					uploadedAt: obj.LastModified?.toISOString(),
					folder: folder || undefined,
				}
			})

			return {
				items,
				folders,
				hasMore,
				cursor: hasMore ? result.NextContinuationToken : undefined,
			} satisfies MediaListResult
		},

		async upload(file, filename, contentType, uploadOpts) {
			const folder = normalizeFolder(uploadOpts?.folder)
			if (isUnsafeFolder(folder)) return { success: false, error: MEDIA_INVALID_FOLDER }
			const { PutObjectCommand } = await loadS3()
			const client = await getClient()

			const ext = getFileExtension(filename)
			const uuid = randomUUID()
			const newFilename = `${uuid}${ext ? `.${ext}` : ''}`
			const keyParts = [prefix, folder, newFilename].filter(Boolean)
			const key = keyParts.join('/')

			const command = new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: file,
				ContentType: contentType,
			})

			await client.send(command)

			return {
				success: true,
				url: getUrl(key),
				filename: newFilename,
				id: key,
			} satisfies MediaUploadResult
		},

		async delete(id) {
			// An id is the object key `list` and `upload` hand out, so it always sits under the
			// configured prefix. Anything else in the bucket is not this adapter's to remove.
			// The prefix is the operator's and taken as configured; only what follows it is checked.
			// What follows it names an object: not empty, and no empty, `.` or `..` segment in it.
			if (prefix && !id.startsWith(`${prefix}/`)) return { success: false, error: MEDIA_INVALID_ID }
			const rest = prefix ? id.slice(prefix.length + 1) : id
			if (rest.split('/').includes('') || hasDotSegment(rest)) return { success: false, error: MEDIA_INVALID_ID }
			try {
				const { DeleteObjectCommand } = await loadS3()
				const client = await getClient()

				const command = new DeleteObjectCommand({
					Bucket: bucket,
					Key: id,
				})

				await client.send(command)
				return { success: true }
			} catch (error) {
				// Prefixed, so no text the SDK or the service comes up with can pass for one of the
				// adapter's own refusals.
				const message = error instanceof Error ? error.message : String(error)
				return { success: false, error: `Delete failed: ${message}` }
			}
		},
	}
}
