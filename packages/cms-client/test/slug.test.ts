// A host deriving a slug locally is predicting the write the sidecar will make, so the two
// implementations have to agree exactly — these are the cases where they once did not.
import { describe, expect, test } from 'bun:test'
import { nextFreeSlug, slugify } from '../src/index'

describe('slugify', () => {
	test('folds diacritics to their base letter — the case that makes a derived slug usable', () => {
		// Without the fold, `[^\w\s\-/]` drops them and this reads "vedra-jako-zdravotn-i-sociln-problm".
		expect(slugify('Vedra jako zdravotní i sociální problém. Kdo je nejvíce v ohrožení?'))
			.toBe('vedra-jako-zdravotni-i-socialni-problem-kdo-je-nejvice-v-ohrozeni')
		expect(slugify('Příliš žluťoučký kůň úpěl ďábelské ódy')).toBe('prilis-zlutoucky-kun-upel-dabelske-ody')
		expect(slugify('Lidé')).toBe('lide')
	})

	test('lowercases, collapses whitespace and underscores, trims separators', () => {
		expect(slugify('  Hello   World  ')).toBe('hello-world')
		expect(slugify('snake_case_name')).toBe('snake-case-name')
		expect(slugify('--edges--')).toBe('edges')
	})

	test('drops punctuation the server drops too', () => {
		expect(slugify('What? Really! (yes)')).toBe('what-really-yes')
	})

	test('keeps `/`, so a nested entry path survives', () => {
		expect(slugify('news/2024/Hello There')).toBe('news/2024/hello-there')
	})

	test('is idempotent, so the server re-slugifying a client-derived slug is a no-op', () => {
		const once = slugify('Vedra jako zdravotní problém')
		expect(slugify(once)).toBe(once)
	})

	test('a title with nothing slug-worthy yields an empty slug, not a stray separator', () => {
		expect(slugify('???')).toBe('')
		expect(slugify('   ')).toBe('')
	})
})

describe('nextFreeSlug', () => {
	test('suffixes from 2 and skips taken ones', () => {
		expect(nextFreeSlug('rozhovor', new Set(['rozhovor']))).toBe('rozhovor-2')
		expect(nextFreeSlug('rozhovor', new Set(['rozhovor', 'rozhovor-2', 'rozhovor-3']))).toBe('rozhovor-4')
	})

	test('offers -2 even when the base is free — the caller asks only once it knows it is not', () => {
		expect(nextFreeSlug('rozhovor', new Set())).toBe('rozhovor-2')
	})
})
