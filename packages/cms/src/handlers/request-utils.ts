import type { IncomingMessage, ServerResponse } from 'node:http'

/** Maximum request body size: 10 MB */
const MAX_BODY_SIZE = 10 * 1024 * 1024

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
	try {
		return JSON.parse(buf.toString('utf-8')) as T
	} catch {
		throw new Error('Invalid JSON in request body')
	}
}

export interface ParsedFile {
	buffer: Buffer
	filename: string
	contentType: string
}

/**
 * Minimal multipart/form-data parser.
 * Extracts the first file part from the request body.
 */
export function parseMultipartFile(body: Buffer, contentTypeHeader: string): ParsedFile | null {
	const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^\s;]+))/)
	if (!boundaryMatch) return null
	const boundary = boundaryMatch[1] ?? boundaryMatch[2]!

	const boundaryBuf = Buffer.from(`--${boundary}`)
	const crlfcrlf = Buffer.from('\r\n\r\n')

	// Find parts by splitting on the boundary buffer
	let offset = 0
	while (offset < body.length) {
		const partStart = body.indexOf(boundaryBuf, offset)
		if (partStart === -1) break

		const contentStart = partStart + boundaryBuf.length
		// Skip the \r\n after the boundary
		const afterBoundary = contentStart
		if (body[afterBoundary] === 0x2d && body[afterBoundary + 1] === 0x2d) {
			// End boundary (--boundary--)
			break
		}

		const nextBoundary = body.indexOf(boundaryBuf, contentStart)
		if (nextBoundary === -1) break

		// Extract the part between this boundary and the next
		// Skip leading \r\n after boundary line
		let partContentStart = contentStart
		if (body[partContentStart] === 0x0d && body[partContentStart + 1] === 0x0a) {
			partContentStart += 2
		}

		// Find header/body separator (\r\n\r\n)
		const headerEnd = body.indexOf(crlfcrlf, partContentStart)
		if (headerEnd === -1 || headerEnd >= nextBoundary) {
			offset = nextBoundary
			continue
		}

		// Headers are ASCII-safe, read as utf-8
		const headerSection = body.slice(partContentStart, headerEnd).toString('utf-8')

		// Body is raw binary data between header end and next boundary (minus trailing \r\n)
		const bodyStart = headerEnd + 4
		let bodyEnd = nextBoundary
		// Remove trailing \r\n before the next boundary
		if (bodyEnd >= 2 && body[bodyEnd - 2] === 0x0d && body[bodyEnd - 1] === 0x0a) {
			bodyEnd -= 2
		}

		// Check if this is a file part
		const dispositionMatch = headerSection.match(/Content-Disposition:\s*form-data;[\s\S]*?filename="([^"]*)"/)
		if (!dispositionMatch) {
			offset = nextBoundary
			continue
		}

		// Sanitize filename: strip path separators and dots prefix to prevent traversal
		const rawFilename = dispositionMatch[1] ?? 'upload'
		const filename = rawFilename.replace(/[/\\]/g, '_').replace(/^\.+/, '')  || 'upload'
		const ctMatch = headerSection.match(/Content-Type:\s*(\S+)/)
		const contentType = ctMatch?.[1] ?? 'application/octet-stream'

		return {
			buffer: body.slice(bodyStart, bodyEnd),
			filename,
			contentType,
		}
	}

	return null
}

function getCorsOrigin(req: IncomingMessage): string {
	const origin = req.headers.origin
	// In dev, allow the requesting origin if present; otherwise fall back to wildcard
	return origin ?? '*'
}

export function sendJson(res: ServerResponse, data: unknown, status = 200, req?: IncomingMessage): void {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': req ? getCorsOrigin(req) : '*',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	})
	res.end(JSON.stringify(data))
}

export function sendError(res: ServerResponse, message: string, status = 400, req?: IncomingMessage): void {
	sendJson(res, { error: message }, status, req)
}

/**
 * Handle CORS preflight. Returns true if the request was an OPTIONS request and was handled.
 */
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
