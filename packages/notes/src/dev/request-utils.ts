/**
 * Tiny HTTP helpers for the notes dev API. Mirrors `@nuasite/cms`'s
 * `handlers/request-utils.ts` but kept local so notes has no runtime
 * dependency on CMS internals (only on the published source-finder
 * surface, used in Phase 4).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY_SIZE = 2 * 1024 * 1024 // 2 MB — notes are text, no uploads

export function readBody(req: IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let totalSize = 0
		req.on('data', (chunk: Buffer) => {
			totalSize += chunk.length
			if (totalSize > maxSize) {
				req.destroy()
				reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`))
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
	})
}

export async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
	const buf = await readBody(req)
	if (buf.length === 0) return {} as T
	try {
		return JSON.parse(buf.toString('utf-8')) as T
	} catch {
		throw new Error('Invalid JSON in request body')
	}
}

function getCorsOrigin(req: IncomingMessage): string {
	return req.headers.origin ?? '*'
}

export function sendJson(res: ServerResponse, data: unknown, status = 200, req?: IncomingMessage): void {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-store',
		'Access-Control-Allow-Origin': req ? getCorsOrigin(req) : '*',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	})
	res.end(JSON.stringify(data))
}

export function sendError(res: ServerResponse, message: string, status = 400, req?: IncomingMessage): void {
	sendJson(res, { error: message }, status, req)
}

export function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': getCorsOrigin(req),
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Access-Control-Max-Age': '86400',
		})
		res.end()
		return true
	}
	return false
}
