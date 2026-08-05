// `slugify` names the file a new entry is written to, so what it does with
// diacritics decides whether a host can derive a slug from a title at all.
import { slugify, slugifyHref } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

describe('slugify', () => {
	test('folds diacritics instead of deleting them', () => {
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

	test('keeps `/`, which is what separates it from slugifyHref', () => {
		expect(slugify('news/2026/Přehled')).toBe('news/2026/prehled')
		expect(slugifyHref('news/2026/Přehled')).toBe('/news2026prehled')
	})

	test('is idempotent, so re-slugifying a slug a host already built is a no-op', () => {
		const once = slugify('Vedra jako zdravotní problém')
		expect(slugify(once)).toBe(once)
	})

	test('yields an empty string when nothing slug-worthy is left', () => {
		expect(slugify('???')).toBe('')
		expect(slugify('   ')).toBe('')
	})
})
