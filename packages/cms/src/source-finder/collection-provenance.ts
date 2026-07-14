import type { CollectionDefinition } from '../types'
import { getAstroContentAnalysis } from './astro-content-analysis'
import { resolveMapChain } from './search-index'
import type { CachedParsedFile, ImageMatch } from './types'

export interface CollectionImageProvenance {
	collectionName: string
	fieldName: string
}

const provenanceCache = new WeakMap<CachedParsedFile, Map<string, CollectionImageProvenance | null>>()

function accessorFromText(expression: string): { base: string; suffix: string } | undefined {
	const normalized = expression.trim().replaceAll('?.', '.')
	const match = normalized.match(/^([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*|\[\d+\])*)$/)
	return match?.[1] !== undefined ? { base: match[1], suffix: match[2] ?? '' } : undefined
}

function traceCollectionImageProvenance(
	image: ImageMatch,
	cached: CachedParsedFile,
): CollectionImageProvenance | undefined {
	let cachedProvenance = provenanceCache.get(cached)
	if (!cachedProvenance) {
		cachedProvenance = new Map()
		provenanceCache.set(cached, cachedProvenance)
	}
	const cacheKey = `${image.src}\0${image.expressionTexts?.join('\0') ?? ''}`
	if (cachedProvenance.has(cacheKey)) return cachedProvenance.get(cacheKey) ?? undefined

	const analysis = getAstroContentAnalysis(cached, 'astro')
	const findBinding = (name: string) => analysis.collectionBindings.find(binding => binding.localName === name)
	const expression = image.src.trim()
	const mapped = image.expressionTexts?.length
		? resolveMapChain(image.expressionTexts, expression)
		: null

	let binding: (typeof analysis.collectionBindings)[number] | undefined
	let fieldPath: string | undefined
	if (mapped && /^[A-Za-z_$][\w$]*$/.test(mapped.arrayPath)) {
		binding = findBinding(mapped.arrayPath)
		fieldPath = binding ? binding.itemPath + mapped.leafSuffix : undefined
	} else {
		const accessor = accessorFromText(expression)
		binding = accessor ? findBinding(accessor.base) : undefined
		fieldPath = binding && accessor ? binding.itemPath + accessor.suffix : undefined
	}
	if (!binding || !fieldPath) {
		cachedProvenance.set(cacheKey, null)
		return undefined
	}

	const fieldName = fieldPath.match(/^\.data\.([A-Za-z_$][\w$]*)$/)?.[1]
	const provenance = fieldName ? { collectionName: binding.collectionName, fieldName } : undefined
	cachedProvenance.set(cacheKey, provenance ?? null)
	return provenance
}

/** Prove that an unresolved image expression reads a concrete image field from a collection. */
export function findCollectionImageProvenance(
	image: ImageMatch,
	cached: CachedParsedFile,
	collections: Record<string, CollectionDefinition>,
): CollectionImageProvenance | undefined {
	const provenance = traceCollectionImageProvenance(image, cached)
	if (!provenance) return undefined
	const field = collections[provenance.collectionName]?.fields.find(candidate => candidate.name === provenance.fieldName)
	if (field?.type !== 'image') return undefined

	return provenance
}
