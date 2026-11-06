import type { RootNode } from '@astrojs/compiler/types'
import { describe, expect, test } from 'bun:test'
import { ProjectState } from '../../src/project/state'
import type { CachedParsedFile } from '../../src/source-finder/types'

const FILE = '/project/src/components/Card.astro'

function parsedOf(content: string): CachedParsedFile {
	const ast: RootNode = { type: 'root', children: [] }
	return {
		content,
		lines: content.split('\n'),
		ast,
		frontmatterContent: null,
		frontmatterAnalysis: null,
		frontmatterStartLine: 0,
		variableDefinitions: [],
		propAliases: new Map(),
		imports: [],
	}
}

/** A state whose last `clear` dropped a parse of `content` for FILE. */
function stateWithEarlierParse(content: string): { state: ProjectState; parsed: CachedParsedFile } {
	const state = new ProjectState()
	const parsed = parsedOf(content)
	state.parsedFiles.set(FILE, parsed)
	state.clear()
	return { state, parsed }
}

describe('ProjectState: parses kept across a clear', () => {
	test('a kept parse is handed out once, for the content it was made from', () => {
		const { state, parsed } = stateWithEarlierParse('<h1>Card</h1>')

		expect(state.takeEarlierParse(FILE, '<h1>Card</h1>')).toBe(parsed)
		expect(state.takeEarlierParse(FILE, '<h1>Card</h1>')).toBeUndefined()
	})

	test('a kept parse of other content is let go when its file is read', () => {
		const { state } = stateWithEarlierParse('<h1>Card</h1>')

		expect(state.takeEarlierParse(FILE, '<h1>Changed</h1>')).toBeUndefined()
		expect(state.takeEarlierParse(FILE, '<h1>Card</h1>')).toBeUndefined()
	})

	test('a file marked dirty has no kept parse', () => {
		const { state } = stateWithEarlierParse('<h1>Card</h1>')

		state.markFileDirty(FILE)

		expect(state.takeEarlierParse(FILE, '<h1>Card</h1>')).toBeUndefined()
	})
})
