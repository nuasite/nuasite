import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from '../config'
import type { AddRedirectRequest, DeleteRedirectRequest, RedirectOperationResponse, RedirectRule, UpdateRedirectRequest } from '../types'
import { acquireFileLock, isNodeError } from '../utils'

const DEFAULT_STATUS_CODE = 307
const REDIRECTS_FILE = 'src/_redirects'

function getRedirectsFilePath(): string {
	return path.join(getProjectRoot(), REDIRECTS_FILE)
}

export async function handleGetRedirects(): Promise<{ rules: RedirectRule[] }> {
	const lines = await readRedirectsFile(getRedirectsFilePath())
	return { rules: parseRedirectLines(lines) }
}

export async function handleAddRedirect(request: AddRedirectRequest): Promise<RedirectOperationResponse> {
	const { source, destination, statusCode = DEFAULT_STATUS_CODE } = request

	if (!source || !destination) {
		return { success: false, error: 'Source and destination are required' }
	}
	if (!source.startsWith('/')) {
		return { success: false, error: 'Source must start with /' }
	}
	if (!destination.startsWith('/') && !destination.startsWith('http')) {
		return { success: false, error: 'Destination must start with / or http' }
	}

	const filePath = getRedirectsFilePath()
	const release = await acquireFileLock(filePath)

	try {
		const lines = await readRedirectsFile(filePath)
		const existing = parseRedirectLines(lines)

		if (existing.some(r => r.source === source)) {
			return { success: false, error: `Redirect already exists for ${source}` }
		}

		lines.push(formatRedirectLine(source, destination, statusCode))
		await writeRedirectsFile(filePath, lines)
		return { success: true }
	} finally {
		release()
	}
}

export async function handleUpdateRedirect(request: UpdateRedirectRequest): Promise<RedirectOperationResponse> {
	const { lineIndex, source, destination, statusCode = DEFAULT_STATUS_CODE } = request

	if (!source || !destination) {
		return { success: false, error: 'Source and destination are required' }
	}

	const filePath = getRedirectsFilePath()
	const release = await acquireFileLock(filePath)

	try {
		const lines = await readRedirectsFile(filePath)

		// Guard against stale line index
		const currentLine = lines[lineIndex]?.trim()
		if (!currentLine || currentLine.startsWith('#')) {
			return { success: false, error: 'Line at index is no longer a redirect rule — please refresh and try again' }
		}

		lines[lineIndex] = formatRedirectLine(source, destination, statusCode)
		await writeRedirectsFile(filePath, lines)
		return { success: true }
	} finally {
		release()
	}
}

export async function handleDeleteRedirect(request: DeleteRedirectRequest): Promise<RedirectOperationResponse> {
	const { lineIndex } = request

	const filePath = getRedirectsFilePath()
	const release = await acquireFileLock(filePath)

	try {
		const lines = await readRedirectsFile(filePath)

		if (lineIndex < 0 || lineIndex >= lines.length) {
			return { success: false, error: `Invalid line index: ${lineIndex}` }
		}

		const line = lines[lineIndex]!.trim()
		if (!line || line.startsWith('#')) {
			return { success: false, error: 'Line is not a redirect rule' }
		}

		lines.splice(lineIndex, 1)
		await writeRedirectsFile(filePath, lines)
		return { success: true }
	} finally {
		release()
	}
}

// --- Internal helpers ---

function formatRedirectLine(source: string, destination: string, statusCode: number): string {
	return statusCode === DEFAULT_STATUS_CODE
		? `${source} ${destination}`
		: `${source} ${destination} ${statusCode}`
}

async function readRedirectsFile(filePath: string): Promise<string[]> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		return content.split('\n')
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return []
		throw error
	}
}

async function writeRedirectsFile(filePath: string, lines: string[]): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })

	const trimmed = lines.slice()
	while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === '') {
		trimmed.pop()
	}

	if (trimmed.length === 0) {
		await fs.writeFile(filePath, '', 'utf-8')
		return
	}

	await fs.writeFile(filePath, trimmed.join('\n') + '\n', 'utf-8')
}

function parseRedirectLines(lines: string[]): RedirectRule[] {
	const rules: RedirectRule[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.trim()
		if (!line || line.startsWith('#')) continue

		const parts = line.split(/\s+/)
		if (parts.length < 2) continue

		const source = parts[0]!
		if (!source.startsWith('/')) continue

		const destination = parts[1]!
		const statusCode = parts[2] ? parseInt(parts[2], 10) : DEFAULT_STATUS_CODE

		rules.push({
			source,
			destination,
			statusCode: Number.isNaN(statusCode) ? DEFAULT_STATUS_CODE : statusCode,
			lineIndex: i,
		})
	}

	return rules
}
