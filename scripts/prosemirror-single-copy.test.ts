import { expect, test } from 'bun:test'
import path from 'node:path'

// The editors bundle every ProseMirror copy the lockfile nests, and each copy keeps its own step
// registry and classes, so steps and nodes from one copy fail `instanceof` checks in another.
// Bun keeps a nested resolution once it is locked, even when the hoisted version satisfies the range.

const lockfile = path.join(import.meta.dir, '..', 'bun.lock')

test('bun.lock holds a single copy of each ProseMirror package', async () => {
	const parsed: unknown = Bun.JSONC.parse(await Bun.file(lockfile).text())
	const packages = typeof parsed === 'object' && parsed !== null && 'packages' in parsed ? parsed.packages : undefined
	if (typeof packages !== 'object' || packages === null) throw new Error('bun.lock has no packages map')
	// A nested entry is keyed by its parent's path (`prosemirror-state/prosemirror-view`); a top-level scoped
	// package (`@scope/prosemirror-x`) is not nested.
	const nested = Object.keys(packages).filter(key => /\/prosemirror-[^/]+$/.test(key) && !/^@[^/]+\/prosemirror-[^/]+$/.test(key))
	// To fix: delete these entries from bun.lock and run `bun install`; the hoisted copy satisfies them.
	expect(nested).toEqual([])
})
