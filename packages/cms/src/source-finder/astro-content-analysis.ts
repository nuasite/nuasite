import { analyzeAstroScript, analyzeAstroSource, type AstroSourceAnalysis } from '@nuasite/cms-core'

import type { CachedParsedFile } from './types'

type AstroContentSourceType = 'astro' | 'script'

interface CachedAstroContentAnalysis {
	astro?: AstroSourceAnalysis
	script?: AstroSourceAnalysis
}

const analysisCache = new WeakMap<CachedParsedFile, CachedAstroContentAnalysis>()

/** Analyze cached source once while keeping Astro and standalone script parsing distinct. */
export function getAstroContentAnalysis(
	cached: CachedParsedFile,
	sourceType: AstroContentSourceType,
): AstroSourceAnalysis {
	let analyses = analysisCache.get(cached)
	if (!analyses) {
		analyses = {}
		analysisCache.set(cached, analyses)
	}

	const existing = analyses[sourceType]
	if (existing) return existing

	const analysis = sourceType === 'astro'
		? analyzeAstroSource(cached.content)
		: analyzeAstroScript(cached.content)
	analyses[sourceType] = analysis
	return analysis
}
