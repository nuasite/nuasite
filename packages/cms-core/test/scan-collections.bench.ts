// Rescan time after one entry save, with and without the frontmatter memo.
// Not a `*.test.ts`, so `bun test` skips it; run it by hand:
//   bun --conditions=typescript packages/cms-core/test/scan-collections.bench.ts [entries] [runs]
import { createNodeFs, type FrontmatterCache, scanCollections } from '@nuasite/cms-core'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ENTRIES = Number(process.argv[2] ?? 1500)
const RUNS = Number(process.argv[3] ?? 15)
const COLLECTIONS = ['blog', 'news', 'docs']

function entry(i: number, revision: number): string {
	return [
		'---',
		`title: "Entry ${i} revision ${revision}"`,
		`description: "A synthetic description for entry ${i}, long enough to look like a real perex."`,
		`date: 2024-${String(i % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`,
		`draft: ${i % 9 === 0}`,
		`author: author-${i % 17}`,
		`image: /assets/entries/${i}.jpg`,
		'tags:',
		`  - topic-${i % 7}`,
		`  - topic-${i % 11}`,
		'seo:',
		`  title: "Entry ${i} | Site"`,
		'  noindex: false',
		'links:',
		`  - label: "Related ${i}"`,
		`    href: /blog/entry-${(i + 1) % ENTRIES}`,
		'---',
		'',
		`Body of entry ${i}.`,
		'',
	].join('\n')
}

function median(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)]!
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nuasite-scan-bench-'))
try {
	for (const name of COLLECTIONS) await fs.mkdir(path.join(root, 'src/content', name), { recursive: true })
	await Promise.all(Array.from({ length: ENTRIES }, (_, i) => {
		const collection = COLLECTIONS[i % COLLECTIONS.length]!
		return fs.writeFile(path.join(root, 'src/content', collection, `entry-${i}.md`), entry(i, 0))
	}))
	const cmsFs = createNodeFs(root)
	const parseCache = new Map()
	const saved = path.join(root, 'src/content', COLLECTIONS[0]!, 'entry-0.md')

	/** One save of a single entry, then the full rescan that follows it; returns the rescan's ms. */
	async function saveAndRescan(revision: number, frontmatterCache: FrontmatterCache | undefined): Promise<number> {
		await fs.writeFile(saved, entry(0, revision))
		const start = performance.now()
		const collections = await scanCollections(cmsFs, 'src/content', parseCache, { frontmatterCache })
		const elapsed = performance.now() - start
		const title = collections[COLLECTIONS[0]!]?.entries?.find(e => e.slug === 'entry-0')?.title
		if (title !== `Entry 0 revision ${revision}`) throw new Error(`stale entry list: ${title}`)
		return elapsed
	}

	let revision = 0
	// Warm up the runtime and the OS page cache before timing either variant.
	for (let i = 0; i < 3; i++) await saveAndRescan(++revision, undefined)

	const without: number[] = []
	for (let i = 0; i < RUNS; i++) without.push(await saveAndRescan(++revision, undefined))

	const memo: FrontmatterCache = new Map()
	const firstWithMemo = await saveAndRescan(++revision, memo)
	const withMemo: number[] = []
	for (let i = 0; i < RUNS; i++) withMemo.push(await saveAndRescan(++revision, memo))

	console.log(`${ENTRIES} entries, ${RUNS} runs, rescan after saving one entry (median ms)`)
	console.log(`  without memo:            ${median(without).toFixed(1)}`)
	console.log(`  with memo, first scan:   ${firstWithMemo.toFixed(1)}`)
	console.log(`  with memo, after a save: ${median(withMemo).toFixed(1)}`)
} finally {
	await fs.rm(root, { recursive: true, force: true })
}
