import type {
	AddRedirectRequest,
	DeleteRedirectRequest,
	GetRedirectsResponse,
	RedirectOperationResponse,
	RedirectRule,
	UpdateRedirectRequest,
} from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types.ts'
import { CMS_REDIRECTS_FILE, parseRedirectRule } from '../redirects.ts'

const DEFAULT_STATUS_CODE = 307
const REDIRECTS_FILE = CMS_REDIRECTS_FILE

export interface RedirectOpsDeps {
	fs: CmsFileSystem
}

export async function listRedirects(deps: RedirectOpsDeps): Promise<GetRedirectsResponse> {
	const lines = await readRedirectsFile(deps)
	return { rules: parseRedirectLines(lines) }
}

export async function addRedirect(deps: RedirectOpsDeps, request: AddRedirectRequest): Promise<RedirectOperationResponse> {
	const { source, destination, statusCode = DEFAULT_STATUS_CODE } = request

	const invalid = ruleError(source, destination, statusCode)
	if (invalid) return { success: false, error: invalid }

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

	// The same rules as adding: a line the editor list cannot show is one the editor cannot fix.
	const invalid = ruleError(source, destination, statusCode)
	if (invalid) return { success: false, error: invalid }

	const lines = await readRedirectsFile(deps)

	const currentLine = lines[lineIndex]?.trim()
	if (!currentLine || currentLine.startsWith('#')) {
		return { success: false, error: 'Line at index is no longer a redirect rule — please refresh and try again' }
	}
	// The build keeps the first rule for a source, so moving a rule onto a source another rule already
	// has would save and never apply. Editing a rule in place is always allowed, so a repeat already in
	// the file can still be fixed.
	const rules = parseRedirectLines(lines)
	const current = rules.find(r => r.lineIndex === lineIndex)
	if (current?.source !== source && rules.some(r => r.source === source && r.lineIndex !== lineIndex)) {
		return { success: false, error: `Redirect already exists for ${source}` }
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

function ruleError(source: string, destination: string, statusCode: number): string | undefined {
	if (!source || !destination) return 'Source and destination are required'
	if (/\s/.test(source) || /\s/.test(destination)) return 'Source and destination must not contain spaces'
	if (!source.startsWith('/')) return 'Source must start with /'
	// Editors redirect; proxying (200) and 4xx stay with code, which the build enforces too.
	if (![301, 302, 303, 307, 308].includes(statusCode)) return 'Status must be a redirect: 301, 302, 303, 307 or 308'
	// Read back the way the build reads it, so the editor never saves a rule the build would not apply.
	if (!parseRedirectRule(formatRedirectLine(source, destination, statusCode))) return 'Destination must start with / or http:// or https://'
	return undefined
}

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

		// The same reading as the build's merge. The editor only manages rules whose source is a path.
		const rule = parseRedirectRule(line)
		if (!rule || !rule.source.startsWith('/')) continue

		const statusCode = rule.status ? parseInt(rule.status, 10) : DEFAULT_STATUS_CODE
		rules.push({ source: rule.source, destination: rule.destination, statusCode, lineIndex: i })
	}

	return rules
}
