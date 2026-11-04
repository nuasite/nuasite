import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { build } from 'astro'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { agentsSummary } from '../../src/index.ts'

// The test preload registers happy-dom, whose timers return numbers. Vite 8 calls `.unref()` on a
// `setTimeout` handle while it starts, so the build runs on the runtime's own globals.
beforeAll(() => GlobalRegistrator.unregister())
afterAll(() => GlobalRegistrator.register({ settings: { fetch: { disableSameOriginPolicy: true } } }))

// A real Astro project, next to this file so it resolves `astro`, and never the working directory.
let root = ''

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('AGENTS.md', () => {
	test('is written to the Astro root, not the working directory', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.astro'), '<title>Home page</title><h1>Welcome home</h1>\n')
		const cwdAgents = path.join(process.cwd(), 'AGENTS.md')
		const cwdBefore = await readFile(cwdAgents, 'utf-8').catch(() => null)

		await build({ root, logLevel: 'error', integrations: [agentsSummary()] })

		expect(await readFile(path.join(root, 'AGENTS.md'), 'utf-8')).toContain('"title":"Home page"')
		expect(await readFile(cwdAgents, 'utf-8').catch(() => null)).toBe(cwdBefore)
	}, 30_000)
})
