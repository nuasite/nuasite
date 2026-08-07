import { describe, expect, test } from 'bun:test'
import {
	buildClosedComboBoxOptions,
	COMBOBOX_NONE_LABEL,
	COMBOBOX_SELECT_LABEL,
	comboBoxCurrentLabel,
	resolveComboBoxCommit,
} from '../../../src/editor/components/field-utils'

// The decision `ComboBoxField` delegates to on blur and on Enter: may the text left in the
// input be written? A declared `(z|n).enum([…])` says no to anything outside the list; the
// options a scan infers from existing entries are suggestions and say yes to everything.
describe('resolveComboBoxCommit — closed options', () => {
	const closed = { options: ['zpravy', 'tipy'], closed: true }

	test('free text typed into a closed field is discarded back to the stored value', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: 'xyz' })).toBeNull()
	})

	test('free text typed into an empty closed field writes nothing at all', () => {
		expect(resolveComboBoxCommit({ ...closed, current: '', query: 'xyz' })).toBeNull()
	})

	test('a prefix of an option is a filter, not a value', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: 'zpr' })).toBeNull()
	})

	test('typing an option out in full counts as picking it', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: 'zpravy' })).toBe('zpravy')
	})

	test('a fully typed option is matched case-insensitively and written in its declared spelling', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: 'ZPRAVY' })).toBe('zpravy')
	})

	test('surrounding whitespace is trimmed off a typed option', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: '  zpravy ' })).toBe('zpravy')
	})

	test('retyping the stored value writes nothing', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: 'tipy' })).toBeNull()
	})

	test('not typing at all writes nothing', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: null })).toBeNull()
	})

	// Closedness governs new writes. A value the schema no longer lists is data that already
	// exists — opening and closing the editor must not rewrite it.
	test('a stored value outside the list survives an untouched visit', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'zruseno', query: null })).toBeNull()
		expect(resolveComboBoxCommit({ ...closed, current: 'zruseno', query: 'zruseno' })).toBeNull()
	})

	test('a stored value outside the list cannot be re-typed into a different unlisted one', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'zruseno', query: 'zruseno2' })).toBeNull()
	})

	test('clearing an optional closed field empties it', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: '' })).toBe('')
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: '   ', required: false })).toBe('')
	})

	test('clearing a required closed field is refused', () => {
		expect(resolveComboBoxCommit({ ...closed, current: 'tipy', query: '', required: true })).toBeNull()
	})
})

describe('resolveComboBoxCommit — suggested options', () => {
	const open = { options: ['zpravy', 'tipy'], closed: false }

	test('free text is a valid value when the options are only suggestions', () => {
		expect(resolveComboBoxCommit({ ...open, current: 'tipy', query: 'xyz' })).toBe('xyz')
	})

	test('a half-typed value is written as-is, whitespace and all', () => {
		expect(resolveComboBoxCommit({ ...open, current: '', query: ' zpr ' })).toBe(' zpr ')
	})

	test('a required field with suggested options can still be emptied by typing nothing', () => {
		expect(resolveComboBoxCommit({ ...open, current: 'tipy', query: '', required: true })).toBe('')
	})

	test('an unedited field writes nothing', () => {
		expect(resolveComboBoxCommit({ ...open, current: 'tipy', query: null })).toBeNull()
	})
})

describe('buildClosedComboBoxOptions', () => {
	const options = [{ value: 'zpravy', label: 'zpravy' }, { value: 'tipy', label: 'tipy' }]

	test('an optional field gets an explicit clear item, since an enum never lists the empty value', () => {
		expect(buildClosedComboBoxOptions(options, 'tipy', false)).toEqual([
			{ value: '', label: COMBOBOX_NONE_LABEL },
			...options,
		])
		expect(COMBOBOX_NONE_LABEL).toBe('— none —')
	})

	test('a required field gets no clear item', () => {
		expect(buildClosedComboBoxOptions(options, 'tipy', true)).toEqual(options)
	})

	// The `— select —` prompt of a required-and-empty field is the input's placeholder, not a
	// list item: a text input renders it where it cannot be picked as a value.
	test('the required-and-empty prompt is not offered as a choice', () => {
		const list = buildClosedComboBoxOptions(options, '', true)
		expect(list.some(o => o.label === COMBOBOX_SELECT_LABEL)).toBe(false)
		expect(list).toEqual(options)
		expect(COMBOBOX_SELECT_LABEL).toBe('— select —')
	})

	test('a stored value the schema no longer lists is offered as (current)', () => {
		expect(buildClosedComboBoxOptions(options, 'zruseno', true)).toEqual([
			...options,
			{ value: 'zruseno', label: 'zruseno (current)' },
		])
		expect(comboBoxCurrentLabel('zruseno')).toBe('zruseno (current)')
	})

	test('a stored value that is a listed option is not duplicated', () => {
		expect(buildClosedComboBoxOptions(options, 'tipy', true)).toEqual(options)
	})

	test('an empty stored value is not offered as (current)', () => {
		expect(buildClosedComboBoxOptions(options, '', false)).toEqual([
			{ value: '', label: COMBOBOX_NONE_LABEL },
			...options,
		])
	})
})
