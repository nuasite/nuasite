export interface CollectionInfo {
	name: string
	slug: string
	file: string
}

export interface ParsedContent {
	frontmatter: Record<string, { value: string; line: number }>
	body: string
	bodyStartLine: number
	file: string
	collectionName: string
	collectionSlug: string
}

type FindCollectionSource = (pagePath: string, contentDir?: string) => Promise<CollectionInfo | undefined>
type ParseMarkdownContent = (collectionInfo: CollectionInfo) => Promise<ParsedContent | undefined>

let findCollectionSource: FindCollectionSource | undefined
let parseMarkdownContent: ParseMarkdownContent | undefined
let initialized = false

async function init() {
	if (initialized) return
	initialized = true

	try {
		const cmsMarker = await import('@nuasite/cms-marker')
		findCollectionSource = cmsMarker.findCollectionSource
		parseMarkdownContent = cmsMarker.parseMarkdownContent
	} catch {
		// cms-marker not available
	}
}

export async function getCollectionContent(
	pagePath: string,
	contentDir: string,
): Promise<ParsedContent | undefined> {
	await init()

	if (!findCollectionSource || !parseMarkdownContent) {
		return undefined
	}

	const collectionInfo = await findCollectionSource(pagePath, contentDir)
	if (!collectionInfo) {
		return undefined
	}

	return parseMarkdownContent(collectionInfo)
}

export function hasCmsMarker(): boolean {
	return findCollectionSource !== undefined && parseMarkdownContent !== undefined
}
