import type { CmsClient } from '@nuasite/cms-client'
import type { FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type EditorContext, FieldEditor } from '../src/field-editor'

// A no-op client; the widgets we render to static markup never hit effects
// (renderToStaticMarkup runs the initial render only), so its methods are unused
// here but the shape must satisfy `CmsClient`.
const noopClient: CmsClient = {
	getProject: () => Promise.reject(new Error('unused')),
	getCollections: () => Promise.reject(new Error('unused')),
	getComponents: () => Promise.reject(new Error('unused')),
	getEntries: () => Promise.reject(new Error('unused')),
	getEntry: () => Promise.reject(new Error('unused')),
	updateEntry: () => Promise.reject(new Error('unused')),
	createEntry: () => Promise.reject(new Error('unused')),
	deleteEntry: () => Promise.reject(new Error('unused')),
	renameEntry: () => Promise.reject(new Error('unused')),
	addArrayItem: () => Promise.reject(new Error('unused')),
	removeArrayItem: () => Promise.reject(new Error('unused')),
	listMedia: () => Promise.reject(new Error('unused')),
	uploadMedia: () => Promise.reject(new Error('unused')),
	mediaFileUrl: (collection, entry, path) => `/cms/v1/collections/${collection}/entries/${entry}/asset?path=${encodeURIComponent(path)}`,
	deleteMedia: () => Promise.reject(new Error('unused')),
	createFolder: () => Promise.reject(new Error('unused')),
}

const ctx: EditorContext = { client: noopClient, collection: 'blog', slug: 'hello' }

function render(field: FieldDefinition, value: unknown): string {
	return renderToStaticMarkup(createElement(FieldEditor, { field, value, onChange: () => {}, ctx }))
}

describe('FieldEditor — field → widget mapping', () => {
	test('text → text input', () => {
		const html = render({ name: 'title', type: 'text', required: true }, 'Hi')
		expect(html).toContain('<input')
		expect(html).toContain('type="text"')
		expect(html).toContain('value="Hi"')
	})

	test('url/email/tel → typed inputs', () => {
		expect(render({ name: 'u', type: 'url', required: false }, '')).toContain('type="url"')
		expect(render({ name: 'e', type: 'email', required: false }, '')).toContain('type="email"')
		expect(render({ name: 't', type: 'tel', required: false }, '')).toContain('type="tel"')
	})

	test('textarea → <textarea>', () => {
		const html = render({ name: 'desc', type: 'textarea', required: false }, 'body')
		expect(html).toContain('<textarea')
	})

	test('number → number input with min/max/step hints', () => {
		const html = render({ name: 'n', type: 'number', required: false, hints: { min: 1, max: 10, step: 2 } }, 5)
		expect(html).toContain('type="number"')
		expect(html).toContain('min="1"')
		expect(html).toContain('max="10"')
		expect(html).toContain('step="2"')
	})

	test('year → bounded number input', () => {
		const html = render({ name: 'y', type: 'year', required: false }, 2026)
		expect(html).toContain('type="number"')
		expect(html).toContain('max="9999"')
	})

	test('date/datetime/time/month → native temporal inputs', () => {
		expect(render({ name: 'd', type: 'date', required: false }, '')).toContain('type="date"')
		expect(render({ name: 'd', type: 'datetime', required: false }, '')).toContain('type="datetime-local"')
		expect(render({ name: 'd', type: 'time', required: false }, '')).toContain('type="time"')
		expect(render({ name: 'd', type: 'month', required: false }, '')).toContain('type="month"')
	})

	test('boolean → role=switch toggle; publish-toggle gets the publish class', () => {
		const plain = render({ name: 'flag', type: 'boolean', required: false }, true)
		expect(plain).toContain('role="switch"')
		expect(plain).toContain('aria-checked="true"')
		const publish = render({ name: 'draft', type: 'boolean', required: false, role: 'publish-toggle' }, false)
		expect(publish).toContain('nua-cadmin-toggle-publish')
	})

	test('select → <select> with options', () => {
		const html = render({ name: 's', type: 'select', required: true, options: ['a', 'b'] }, 'a')
		expect(html).toContain('<select')
		expect(html).toContain('<option value="a"')
		expect(html).toContain('<option value="b"')
	})

	test('image → media picker URL input (initial render, pre-probe)', () => {
		const html = render({ name: 'cover', type: 'image', required: false }, '/uploads/x.png')
		expect(html).toContain('nua-cadmin-media')
		expect(html).toContain('<input')
		// A path-like value renders the preview <img>.
		expect(html).toContain('<img')
	})

	test('reference → renders (loading state on initial render)', () => {
		const html = render({ name: 'ref', type: 'reference', required: false, collection: 'authors' }, '')
		// Effects do not run under static render, so we see the loading placeholder.
		expect(html).toContain('Loading authors')
	})

	test('array → repeater with an add button; renders item widgets', () => {
		const html = render({ name: 'tags', type: 'array', required: false, itemType: 'text' }, ['a', 'b'])
		expect(html).toContain('nua-cadmin-array')
		expect(html).toContain('Add item')
		// Two text inputs for the two items.
		expect(html.match(/type="text"/g)?.length).toBe(2)
	})

	test('object → nested group with sub-field labels', () => {
		const field: FieldDefinition = {
			name: 'seo',
			type: 'object',
			required: false,
			fields: [
				{ name: 'metaTitle', type: 'text', required: false },
				{ name: 'noindex', type: 'boolean', required: false },
			],
		}
		const html = render(field, { metaTitle: 'T', noindex: true })
		expect(html).toContain('nua-cadmin-object')
		expect(html).toContain('metaTitle')
		expect(html).toContain('noindex')
		expect(html).toContain('role="switch"')
	})
})
