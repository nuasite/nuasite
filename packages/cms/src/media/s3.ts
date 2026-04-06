import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getFileExtension, mimeFromExt } from './local'
import type { MediaFolderItem, MediaListResult, MediaStorageAdapter, MediaUploadResult } from './types'

export interface S3StorageOptions {
	bucket: string
	region: string
	accessKeyId?: string
	secretAccessKey?: string
	endpoint?: string
	cdnPrefix?: string
	prefix?: string
}

// Dynamic import helper to avoid TS2307 for optional peer dependency
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
			const folder = opts?.folder ?? ''

			// Build the S3 prefix: base prefix + subfolder
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

			// Extract subfolders from CommonPrefixes
			const folders: MediaFolderItem[] = (result.CommonPrefixes ?? []).map((cp: any) => {
				const fullPrefix = (cp.Prefix as string).replace(/\/$/, '')
				const name = fullPrefix.split('/').pop() ?? fullPrefix
				const relativePath = prefix ? fullPrefix.slice(prefix.length + 1) : fullPrefix
				return { name, path: relativePath }
			})

			// Extract files (exclude folder marker keys)
			const contents = (result.Contents ?? []).filter((obj: any) => {
				const key = obj.Key as string
				return key !== delimiterPrefix
			})

			const hasMore = contents.length > limit
			const items = contents.slice(0, limit).map((obj: any) => {
				const key = obj.Key as string
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
			const { PutObjectCommand } = await loadS3()
			const client = await getClient()

			const ext = getFileExtension(filename)
			const uuid = randomUUID()
			const newFilename = `${uuid}${ext ? `.${ext}` : ''}`
			const folder = uploadOpts?.folder ?? ''
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
				const message = error instanceof Error ? error.message : String(error)
				return { success: false, error: message }
			}
		},
	}
}
