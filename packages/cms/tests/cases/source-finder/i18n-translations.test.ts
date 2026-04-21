/**
 * Source finder tests: i18n translation lookups
 *
 * Covers projects that render navigation / body text through a translation
 * helper like `{t(locale, 'nav.whatsHappening')}` where the actual strings
 * live in JSON dictionaries (e.g. `src/i18n/cs.json`). Before the fix the
 * source finder had no way to associate the rendered text with the JSON
 * entry, so these elements ended up without a sourcePath in the manifest.
 */

import { expect, test } from 'bun:test'
import path from 'node:path'
import { findSourceLocation, initializeSearchIndex, markFileDirty, reindexDirtyFiles } from '../../../src/source-finder'
import { enhanceManifestWithSourceSnippets } from '../../../src/source-finder/snippet-utils'
import type { ManifestEntry } from '../../../src/types'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - i18n JSON dictionaries', (getCtx) => {
	test('resolves <a>{t(locale, "nav.whatsHappening")} to the cs.json entry', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.welcome": "Vítejte u nás",',
				'  "nav.whatsHappening": "Co se děje v EduArt?",',
				'  "nav.contact": "Kontakt"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/i18n/en.json',
			[
				'{',
				'  "nav.welcome": "Welcome",',
				'  "nav.whatsHappening": "What is happening at EduArt?",',
				'  "nav.contact": "Contact"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/i18n/index.ts',
			[
				"import cs from './cs.json'",
				"import en from './en.json'",
				'',
				'const dictionaries = { cs, en } as const',
				'type Locale = keyof typeof dictionaries',
				'type Key = keyof typeof cs',
				'',
				'export function t(locale: Locale, key: Key): string {',
				'  return (dictionaries[locale] as Record<string, string>)[key]',
				'    ?? (dictionaries.cs as Record<string, string>)[key]',
				'    ?? key',
				'}',
				'',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/components/Header.astro',
			[
				'---',
				"import { t } from '../i18n'",
				'',
				"type Locale = 'cs' | 'en'",
				'interface Props { locale: Locale }',
				'const { locale } = Astro.props',
				'---',
				'<nav>',
				'  <a href="/n/co-se-deje/">{t(locale, \'nav.whatsHappening\')}</a>',
				'</nav>',
				'',
			].join('\n'),
		)

		await initializeSearchIndex()

		const result = await findSourceLocation('Co se děje v EduArt?', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/i18n/cs.json')
		expect(result?.line).toBe(3)
		expect(result?.snippet).toContain('Co se děje v EduArt?')
	})

	test('matches translations from nested i18n subdirectories', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/locales/cs')

		await ctx.writeFile(
			'src/locales/cs/common.json',
			[
				'{',
				'  "footer": {',
				'    "copyright": "© 2022 Mateřská škola Eduart"',
				'  }',
				'}',
				'',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/components/Footer.astro',
			[
				'---',
				"import cs from '../locales/cs/common.json'",
				'---',
				'<footer>{cs.footer.copyright}</footer>',
				'',
			].join('\n'),
		)

		await initializeSearchIndex()

		const result = await findSourceLocation('© 2022 Mateřská škola Eduart', 'footer')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/locales/cs/common.json')
		expect(result?.line).toBe(3)
	})

	test('enhances a manifest entry with no sourcePath via the translation index', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.whatsHappening": "Co se děje v EduArt?"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/components/Header.astro',
			[
				'---',
				"import cs from '../i18n/cs.json'",
				'---',
				'<a>{cs["nav.whatsHappening"]}</a>',
				'',
			].join('\n'),
		)

		const entries: Record<string, ManifestEntry> = {
			'cms-24': {
				id: 'cms-24',
				tag: 'a',
				text: 'Co se děje v EduArt?',
				stableId: 'a6cc4b4f370b',
			},
		}

		const enhanced = await enhanceManifestWithSourceSnippets(entries)

		expect(enhanced['cms-24']?.sourcePath).toBe('src/i18n/cs.json')
		expect(enhanced['cms-24']?.sourceLine).toBe(2)
		expect(enhanced['cms-24']?.sourceSnippet).toContain('Co se děje v EduArt?')
	})

	test('enhances a manifest entry whose sourcePath points at the template', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.whatsHappening": "Co se děje v EduArt?"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/components/Header.astro',
			[
				'---',
				"import { t } from '../i18n'",
				"type Locale = 'cs' | 'en'",
				'const locale: Locale = Astro.props.locale ?? "cs"',
				'---',
				"<a>{t(locale, 'nav.whatsHappening')}</a>",
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/i18n/index.ts',
			[
				"import cs from './cs.json'",
				'export const t = (_locale: string, key: string): string =>',
				'  (cs as Record<string, string>)[key] ?? key',
				'',
			].join('\n'),
		)

		const entries: Record<string, ManifestEntry> = {
			'cms-24': {
				id: 'cms-24',
				tag: 'a',
				text: 'Co se děje v EduArt?',
				stableId: 'a6cc4b4f370b',
				// Marked with the template as sourcePath (as Astro's dev attributes would)
				sourcePath: 'src/components/Header.astro',
				sourceLine: 6,
			},
		}

		const enhanced = await enhanceManifestWithSourceSnippets(entries)

		expect(enhanced['cms-24']?.sourcePath).toBe('src/i18n/cs.json')
		expect(enhanced['cms-24']?.sourceLine).toBe(2)
		expect(enhanced['cms-24']?.sourceSnippet).toContain('Co se děje v EduArt?')
	})

	test('attribute and colorClass sources point at the template even when text lives in JSON', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.welcome": "Vítejte u nás",',
				'  "nav.whatsHappening": "Co se děje v EduArt?"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/i18n/index.ts',
			[
				"import cs from './cs.json'",
				'export const t = (_locale: string, key: string): string =>',
				'  (cs as Record<string, string>)[key] ?? key',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/components/Header.astro',
			[
				'---',
				"import { t } from '../i18n'",
				"type Locale = 'cs' | 'en'",
				"const locale: Locale = Astro.props.locale ?? 'cs'",
				"const whatsHappeningUrl = '/n/co-se-deje/'",
				'---',
				'<nav>',
				'  <a',
				'    href={whatsHappeningUrl}',
				'    class="font-normal no-underline text-[#2A2937] hover:text-[#FC9C9E]"',
				"  >{t(locale, 'nav.whatsHappening')}</a>",
				'</nav>',
				'',
			].join('\n'),
		)

		const entries: Record<string, ManifestEntry> = {
			'cms-24': {
				id: 'cms-24',
				tag: 'a',
				text: 'Co se děje v EduArt?',
				stableId: 'a6cc4b4f370b',
				colorClasses: {
					text: { value: 'text-[#2A2937]' },
					hoverText: { value: 'hover:text-[#FC9C9E]' },
					fontWeight: { value: 'font-normal' },
					textDecoration: { value: 'no-underline' },
				},
				attributes: {
					href: { value: '/n/co-se-deje/' },
				},
			},
		}

		const enhanced = await enhanceManifestWithSourceSnippets(entries)
		const result = enhanced['cms-24']!

		// Text edits point at the JSON dictionary
		expect(result.sourcePath).toBe('src/i18n/cs.json')
		expect(result.sourceSnippet).toContain('Co se děje v EduArt?')

		// Class/attribute edits point back at the template
		expect(result.colorClasses?.text?.sourcePath).toBe('src/components/Header.astro')
		expect(result.colorClasses?.text?.sourceLine).toBeGreaterThan(0)
		expect(result.colorClasses?.hoverText?.sourcePath).toBe('src/components/Header.astro')
		expect(result.attributes?.href?.sourcePath).toBe('src/components/Header.astro')
		expect(result.attributes?.href?.sourceLine).toBeGreaterThan(0)
	})

	test('re-indexes the translation JSON file after a live edit', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.whatsHappening": "Co se děje v EduArt?"',
				'}',
				'',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/components/Header.astro',
			[
				'---',
				"import cs from '../i18n/cs.json'",
				'---',
				'<a>{cs["nav.whatsHappening"]}</a>',
				'',
			].join('\n'),
		)

		await initializeSearchIndex()
		const initial = await findSourceLocation('Co se děje v EduArt?', 'a')
		expect(initial?.file).toBe('src/i18n/cs.json')

		// Simulate the user editing the JSON (the CMS source-writer or a manual edit)
		await ctx.writeFile(
			'src/i18n/cs.json',
			[
				'{',
				'  "nav.whatsHappening": "Nový text v EduArt"',
				'}',
				'',
			].join('\n'),
		)
		markFileDirty(path.join(ctx.tempDir, 'src/i18n/cs.json'))
		await reindexDirtyFiles()

		const stale = await findSourceLocation('Co se děje v EduArt?', 'a')
		expect(stale).toBeUndefined()

		const fresh = await findSourceLocation('Nový text v EduArt', 'a')
		expect(fresh?.file).toBe('src/i18n/cs.json')
		expect(fresh?.snippet).toContain('Nový text v EduArt')
	})

	test('prefers the first dictionary line over sibling locales with same key', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/i18n')

		// Both files have distinct text — only the Czech one matches
		await ctx.writeFile(
			'src/i18n/cs.json',
			'{\n  "hero.title": "Unikátní český titulek"\n}\n',
		)
		await ctx.writeFile(
			'src/i18n/en.json',
			'{\n  "hero.title": "Unique english title"\n}\n',
		)

		await ctx.writeFile(
			'src/components/Hero.astro',
			[
				'---',
				"import cs from '../i18n/cs.json'",
				'---',
				'<h1>{cs["hero.title"]}</h1>',
				'',
			].join('\n'),
		)

		await initializeSearchIndex()

		const csResult = await findSourceLocation('Unikátní český titulek', 'h1')
		expect(csResult?.file).toBe('src/i18n/cs.json')

		const enResult = await findSourceLocation('Unique english title', 'h1')
		expect(enResult?.file).toBe('src/i18n/en.json')
	})
}, { setupAstro: false })
