import type {
	AddRedirectRequest,
	DeleteRedirectRequest,
	GetRedirectsResponse,
	RedirectOperationResponse,
	RedirectRule,
	UpdateRedirectRequest,
} from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types'

const DEFAULT_STATUS_CODE = 307
const REDIRECTS_FILE = 'src/_redirects'

export interface RedirectOpsDeps {
	fs: CmsFileSystem
}

export async function listRedirects(deps: RedirectOpsDeps): Promise<GetRedirectsResponse> {
	const lines = await readRedirectsFile(deps)
	return { rules: parseRedirectLines(lines) }
}

export async function addRedirect(deps: RedirectOpsDeps, request: AddRedirectRequest): Promise<RedirectOperationResponse> {
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

	const lines = await readRedirectsFile(deps)
	const existing = parseRedirectLines(lines)

	if (existing.some(r => r.source === source)) {
		return { success: false, error: `Redirect already exists for ${source}` }
	}

	lines.push(formatRedirectLine(source, destination, statusCode))
	await writeRedirectsFile(deps, lines)
	return { success: true }
}

export async function updateRedirect(deps: RedirectOpsDeps, request: UpdateRedirectRequest): Promise<RedirectOperationResponse> {
	const { lineIndex, source, destination, statusCode = DEFAULT_STATUS_CODE } = request

	if (!source || !destination) {
		return { success: false, error: 'Source and destination are required' }
	}

	const lines = await readRedirectsFile(deps)

	const currentLine = lines[lineIndex]?.trim()
	if (!currentLine || currentLine.startsWith('#')) {
		return { success: false, error: 'Line at index is no longer a redirect rule — please refresh and try again' }
	}

	lines[lineIndex] = formatRedirectLine(source, destination, statusCode)
	await writeRedirectsFile(deps, lines)
	return { success: true }
}

export async function deleteRedirect(deps: RedirectOpsDeps, request: DeleteRedirectRequest): Promise<RedirectOperationResponse> {
	const { lineIndex } = request

	const lines = await readRedirectsFile(deps)

	if (lineIndex < 0 || lineIndex >= lines.length) {
		return { success: false, error: `Invalid line index: ${lineIndex}` }
	}

	const line = lines[lineIndex]!.trim()
	if (!line || line.startsWith('#')) {
		return { success: false, error: 'Line is not a redirect rule' }
	}

	lines.splice(lineIndex, 1)
	await writeRedirectsFile(deps, lines)
	return { success: true }
}

// --- Internal helpers ---

function formatRedirectLine(source: string, destination: string, statusCode: number): string {
	return statusCode === DEFAULT_STATUS_CODE
		? `${source} ${destination}`
		: `${source} ${destination} ${statusCode}`
}

async function readRedirectsFile(deps: RedirectOpsDeps): Promise<string[]> {
	if (!(await deps.fs.exists(REDIRECTS_FILE))) return []
	const content = await deps.fs.readFile(REDIRECTS_FILE)
	return content.split('\n')
}

async function writeRedirectsFile(deps: RedirectOpsDeps, lines: string[]): Promise<void> {
	const trimmed = lines.slice()
	while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === '') {
		trimmed.pop()
	}

	if (trimmed.length === 0) {
		await deps.fs.writeFile(REDIRECTS_FILE, '')
		return
	}

	await deps.fs.writeFile(REDIRECTS_FILE, trimmed.join('\n') + '\n')
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
