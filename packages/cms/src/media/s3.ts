import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { MediaListResult, MediaStorageAdapter, MediaUploadResult } from './types'

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
			const command = new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				MaxKeys: limit + 1,
				...(opts?.cursor ? { ContinuationToken: opts.cursor } : {}),
			})

			const result = await client.send(command)
			const contents = result.Contents ?? []
			const hasMore = contents.length > limit
			const items = contents.slice(0, limit).map((obj: any) => {
				const key = obj.Key as string
				const filename = key.split('/').pop() ?? key
				return {
					id: key,
					url: getUrl(key),
					filename,
					contentType: 'application/octet-stream',
					uploadedAt: obj.LastModified?.toISOString(),
				}
			})

			return {
				items,
				hasMore,
				cursor: hasMore ? result.NextContinuationToken : undefined,
			} satisfies MediaListResult
		},

		async upload(file, filename, contentType) {
			const { PutObjectCommand } = await loadS3()
			const client = await getClient()

			const ext = getFileExtension(filename)
			const uuid = randomUUID()
			const newFilename = `${uuid}${ext ? `.${ext}` : ''}`
			const key = prefix ? `${prefix}/${newFilename}` : newFilename

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

function getFileExtension(filename: string): string {
	const parts = filename.split('.')
	return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : ''
}
