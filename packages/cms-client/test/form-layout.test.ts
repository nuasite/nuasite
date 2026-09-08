import type { CollectionLayout, FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { fieldLabel, findTitleField, resolveFormLayout } from '../src/form-layout'

const field = (name: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ name, type: 'text', required: false, ...extra })

/** An events collection as `scanCollections` reports one: title sidebar'd by name, cover by type. */
const eventFields: FieldDefinition[] = [
	field('title', { position: 'sidebar' }),
	field('credits', { type: 'array' }),
	field('showings', { type: 'array' }),
	field('slug', { hidden: true }),
	field('cover', { type: 'image', position: 'sidebar' }),
	field('draft', { type: 'boolean', position: 'sidebar', role: 'publish-toggle' }),
]

const names = (fields: FieldDefinition[]): string[] => fields.map(f => f.name)
const sectionNames = (layout: ReturnType<typeof resolveFormLayout>): [string | undefined, string[]][] =>
	layout.sections.map(section => [section.title, names(section.fields)])

describe('the headline field leads the form', () => {
	test('title is lifted out of the scanner’s sidebar and never lands inside a section', () => {
		const layout = resolveFormLayout(eventFields)
		expect(layout.title?.name).toBe('title')
		expect(names(layout.sidebar)).not.toContain('title')
		expect(layout.sections.flatMap(s => names(s.fields))).not.toContain('title')
	})

	test('an explicit placement wins over the heuristic', () => {
		expect(resolveFormLayout(eventFields, { sidebar: ['title'] }).title).toBeUndefined()
		expect(names(resolveFormLayout(eventFields, { sidebar: ['title'] }).sidebar)).toContain('title')
		expect(resolveFormLayout(eventFields, { sections: [{ title: 'Meta', fields: ['title'] }] }).title).toBeUndefined()
		expect(resolveFormLayout([field('title', { position: 'header' })]).title).toBeUndefined()
	})

	test('only a text field named for a headline qualifies', () => {
		expect(findTitleField([field('name', { type: 'reference' })])).toBeUndefined()
		expect(findTitleField([field('head_line')])?.name).toBe('head_line')
		expect(findTitleField([field('body', { type: 'textarea' }), field('Heading')])?.name).toBe('Heading')
	})
})

describe('declared sections order the main column', () => {
	const layout: CollectionLayout = { sections: [{ title: 'Termíny a vstupenky', fields: ['showings'] }] }

	test('a declared section runs before the fields nobody placed', () => {
		expect(sectionNames(resolveFormLayout(eventFields, layout))).toEqual([
			['Termíny a vstupenky', ['showings']],
			['Other', ['credits']],
		])
	})

	// The bug this structure exists to prevent: rendered as one flat list, `credits` follows the
	// "Termíny a vstupenky" heading with nothing between them and reads as part of that section.
	test('leftovers get their own block rather than inheriting the previous heading', () => {
		const resolved = resolveFormLayout(eventFields, layout)
		expect(resolved.sections.at(-1)?.title).toBe('Other')
		expect(resolved.sections.every(section => section.fields.length > 0)).toBe(true)
	})

	test('unknown, hidden, repeated and sidebar’d names are skipped, not rendered blank', () => {
		const resolved = resolveFormLayout(eventFields, {
			sections: [{ title: 'Schedule', fields: ['missing', 'slug', 'cover', 'showings', 'showings'] }, { title: 'Again', fields: ['showings'] }],
			sidebar: ['cover'],
		})
		expect(sectionNames(resolved)).toEqual([['Schedule', ['showings']], ['Other', ['credits']]])
	})

	test('without a declared layout, nested fields become their own collapsed blocks', () => {
		expect(sectionNames(resolveFormLayout(eventFields))).toEqual([['Credits', ['credits']], ['Showings', ['showings']]])
		expect(resolveFormLayout(eventFields).sections.every(section => section.collapsed)).toBe(true)
	})
})

describe('the side column', () => {
	test('declared order is kept, and publish controls float above it', () => {
		const resolved = resolveFormLayout(eventFields, { sidebar: ['cover', 'credits'] })
		expect(names(resolved.sidebar)).toEqual(['draft', 'cover', 'credits'])
	})

	test('a field the config sidebars leaves the main column', () => {
		expect(sectionNames(resolveFormLayout(eventFields, { sidebar: ['credits'] }))).toEqual([['Showings', ['showings']]])
	})
})

describe('the header strip is an author’s choice', () => {
	// `position: 'header'` used to be the scanner's default for every unrecognised field, which
	// put the whole form in the strip. Nothing carries it now unless somebody asked for it.
	test('only fields explicitly positioned there', () => {
		const resolved = resolveFormLayout([field('title'), field('perex', { position: 'header' }), field('body', { type: 'textarea' })])
		expect(names(resolved.header)).toEqual(['perex'])
		expect(sectionNames(resolved)).toEqual([[undefined, ['body']]])
	})
})

describe('presentation details every UI should share', () => {
	test('hidden fields reach no slot at all', () => {
		const resolved = resolveFormLayout(eventFields, { sections: [{ title: 'S', fields: ['slug'] }], sidebar: ['slug'] })
		const everywhere = [...names(resolved.header), ...names(resolved.sidebar), ...resolved.sections.flatMap(s => names(s.fields))]
		expect(everywhere).not.toContain('slug')
	})

	test('`order` is a weight around the schema order, not a replacement for it', () => {
		const resolved = resolveFormLayout([field('a'), field('b', { order: -2 }), field('c'), field('d', { order: 5 })])
		expect(sectionNames(resolved)).toEqual([[undefined, ['b', 'a', 'c', 'd']]])
	})

	test('tabs kick in once the stack outgrows a column', () => {
		const many = Array.from({ length: 5 }, (_, i) => field(`group${i}`, { type: 'object' }))
		expect(resolveFormLayout(many).display).toBe('tabs')
		expect(resolveFormLayout(many.slice(0, 4)).display).toBe('sections')
		expect(resolveFormLayout(many, { display: 'sections' }).display).toBe('sections')
	})

	test('the declared label is what the field is called', () => {
		expect(fieldLabel(field('showings', { label: 'Termíny' }))).toBe('Termíny')
		expect(fieldLabel(field('showings'))).toBe('showings')
	})
})

describe('an author’s placement is not the scanner’s guess', () => {
	// `scanCollections` marks every image, every boolean and every well-known name
	// `position: 'sidebar'`, and the side column used to sweep them up before sections were
	// resolved — so the fields a declared section named were gone by the time it looked for them.
	test('a declared section keeps the fields the scanner would have sidebar’d', () => {
		const fields = [field('date', { position: 'sidebar' }), field('program'), field('cover', { type: 'image', position: 'sidebar' })]
		const resolved = resolveFormLayout(fields, { sections: [{ title: 'Schedule', fields: ['date', 'program', 'cover'] }] })
		expect(sectionNames(resolved)).toEqual([['Schedule', ['date', 'program', 'cover']]])
		expect(names(resolved.sidebar)).toEqual([])
	})

	test('a declared `cms.sidebar` still outranks a section naming the same field', () => {
		const resolved = resolveFormLayout(eventFields, { sections: [{ title: 'S', fields: ['cover', 'showings'] }], sidebar: ['cover'] })
		expect(sectionNames(resolved)).toEqual([['S', ['showings']], ['Other', ['credits']]])
		expect(names(resolved.sidebar)).toContain('cover')
	})

	// `n.text({ sidebar: true })` and a `@position sidebar` directive reach the wire as the same
	// `position: 'sidebar'` the heuristic writes. Without `positionDeclared` the hoist below could
	// not tell them apart, and lifted the headline out of the column the author put it in.
	test('a declared sidebar position stops the headline hoist', () => {
		const declared = [field('title', { position: 'sidebar', positionDeclared: true }), field('body', { type: 'textarea' })]
		const resolved = resolveFormLayout(declared)
		expect(resolved.title).toBeUndefined()
		expect(names(resolved.sidebar)).toEqual(['title'])
	})

	test('the scanner’s own sidebar guess does not', () => {
		expect(resolveFormLayout([field('title', { position: 'sidebar' }), field('body', { type: 'textarea' })]).title?.name).toBe('title')
	})
})
