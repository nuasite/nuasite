import { describe, expect, test } from 'bun:test'
import { parse } from 'node-html-parser'
import { clusterComponentEntries } from '../../src/build-processor'

type HTMLNode = ReturnType<ReturnType<typeof parse>['querySelector']>

/** Build a findLCA helper for a parsed DOM tree */
function createFindLCA() {
	return (elements: NonNullable<HTMLNode>[]): HTMLNode => {
		if (elements.length === 0) return null
		if (elements.length === 1) return elements[0]!

		const getAncestors = (el: HTMLNode): HTMLNode[] => {
			const ancestors: HTMLNode[] = []
			let current = el?.parentNode as HTMLNode
			while (current) {
				ancestors.unshift(current)
				current = current.parentNode as HTMLNode
			}
			return ancestors
		}

		const chains = elements.map(el => getAncestors(el))
		const minLen = Math.min(...chains.map(c => c.length))
		let lcaIdx = 0
		for (let i = 0; i < minLen; i++) {
			if (chains.every(chain => chain[i] === chains[0]![i])) {
				lcaIdx = i
			} else {
				break
			}
		}
		return chains[0]![lcaIdx] ?? null
	}
}

describe('clusterComponentEntries', () => {
	test('returns single cluster for a single entry', () => {
		const root = parse('<main><section><h1 id="e1">Hello</h1></section></main>')
		const el = root.querySelector('#e1')!
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries([el], ['cms-1'], findLCA)

		expect(clusters).toHaveLength(1)
		expect(clusters[0]!.clusterEntryIds).toEqual(['cms-1'])
	})

	test('returns single cluster when all entries are in the same subtree', () => {
		const root = parse(`
			<main>
				<section>
					<h1 id="e1">Title</h1>
					<p id="e2">Description</p>
				</section>
			</main>
		`)
		const elements = [root.querySelector('#e1')!, root.querySelector('#e2')!]
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries(elements, ['cms-1', 'cms-2'], findLCA)

		expect(clusters).toHaveLength(1)
		expect(clusters[0]!.clusterEntryIds).toEqual(['cms-1', 'cms-2'])
	})

	test('splits entries into two clusters when in different subtrees', () => {
		const root = parse(`
			<main>
				<section id="s1">
					<h2 id="e1">CTA Title 1</h2>
					<a id="e2">Click here</a>
				</section>
				<section id="other">
					<p>Other component content</p>
				</section>
				<section id="s2">
					<h2 id="e3">CTA Title 2</h2>
					<a id="e4">Click here</a>
				</section>
			</main>
		`)
		const elements = [
			root.querySelector('#e1')!,
			root.querySelector('#e2')!,
			root.querySelector('#e3')!,
			root.querySelector('#e4')!,
		]
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries(
			elements,
			['cms-1', 'cms-2', 'cms-3', 'cms-4'],
			findLCA,
		)

		expect(clusters).toHaveLength(2)
		expect(clusters[0]!.clusterEntryIds).toEqual(['cms-1', 'cms-2'])
		expect(clusters[1]!.clusterEntryIds).toEqual(['cms-3', 'cms-4'])
	})

	test('splits entries into three clusters for three instances', () => {
		const root = parse(`
			<main>
				<div id="d1"><h2 id="e1">A</h2></div>
				<div id="d2"><h2 id="e2">B</h2></div>
				<div id="d3"><h2 id="e3">C</h2></div>
			</main>
		`)
		const elements = [
			root.querySelector('#e1')!,
			root.querySelector('#e2')!,
			root.querySelector('#e3')!,
		]
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries(elements, ['cms-1', 'cms-2', 'cms-3'], findLCA)

		expect(clusters).toHaveLength(3)
		expect(clusters[0]!.clusterEntryIds).toEqual(['cms-1'])
		expect(clusters[1]!.clusterEntryIds).toEqual(['cms-2'])
		expect(clusters[2]!.clusterEntryIds).toEqual(['cms-3'])
	})

	test('handles deeply nested entries in different subtrees', () => {
		const root = parse(`
			<main>
				<section>
					<div><div><h1 id="e1">Deep 1</h1></div></div>
				</section>
				<section>
					<div><div><h1 id="e2">Deep 2</h1></div></div>
				</section>
			</main>
		`)
		const elements = [root.querySelector('#e1')!, root.querySelector('#e2')!]
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries(elements, ['cms-1', 'cms-2'], findLCA)

		expect(clusters).toHaveLength(2)
	})

	test('keeps entries together when nested in same deep subtree', () => {
		const root = parse(`
			<main>
				<section>
					<div>
						<h1 id="e1">Title</h1>
						<div>
							<p id="e2">Nested paragraph</p>
						</div>
					</div>
				</section>
			</main>
		`)
		const elements = [root.querySelector('#e1')!, root.querySelector('#e2')!]
		const findLCA = createFindLCA()

		const clusters = clusterComponentEntries(elements, ['cms-1', 'cms-2'], findLCA)

		expect(clusters).toHaveLength(1)
		expect(clusters[0]!.clusterEntryIds).toEqual(['cms-1', 'cms-2'])
	})
})
