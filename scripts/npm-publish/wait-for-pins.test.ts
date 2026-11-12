import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exactPins, type Fetch, isServed, parseManifest, type Pin, readManifest, waitForPins } from './wait-for-pins'

// The publish workflow publishes @nuasite/nua only after this reports every exact pin as served.

const tempDirs: string[] = []
afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const cms: Pin = { name: '@nuasite/cms', version: '1.2.0' }
const cli: Pin = { name: '@nuasite/cli', version: '1.2.0' }

describe('exactPins', () => {
	test('takes exact dependencies and required exact peers, nothing else', () => {
		const manifest = parseManifest({
			name: '@nuasite/nua',
			version: '1.2.0',
			dependencies: { '@nuasite/cms': '1.2.0', '@nuasite/beta': '1.2.0-beta.3', astro: '^6.0.0', tagged: 'latest' },
			peerDependencies: { '@nuasite/cli': '1.2.0', '@astrojs/check': '0.9.4', react: '>=18' },
			peerDependenciesMeta: { '@astrojs/check': { optional: true } },
		})
		expect(exactPins(manifest)).toEqual([
			cms,
			{ name: '@nuasite/beta', version: '1.2.0-beta.3' },
			cli,
		])
	})

	test('rejects a manifest whose dependency range is not a string', () => {
		expect(() => parseManifest({ name: 'a', version: '1.0.0', dependencies: { b: 1 } })).toThrow('"dependencies.b" must be a string')
	})
})

describe('readManifest', () => {
	test('reads package/package.json from an npm tarball', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wait-for-pins-'))
		tempDirs.push(dir)
		fs.mkdirSync(path.join(dir, 'package'))
		fs.writeFileSync(path.join(dir, 'package', 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { b: '2.0.0' } }))
		const tarball = path.join(dir, 'a-1.0.0.tgz')
		expect(spawnSync('tar', ['-czf', tarball, '-C', dir, 'package']).status).toBe(0)

		expect(exactPins(readManifest(tarball))).toEqual([{ name: 'b', version: '2.0.0' }])
	})
})

describe('isServed', () => {
	const registry = (responses: Record<string, Response | Error>): { fetch: Fetch; urls: string[] } => {
		const urls: string[] = []
		return {
			urls,
			fetch: async url => {
				urls.push(url)
				const response = responses[url]
				if (response instanceof Error) throw response
				return response ?? new Response('not found', { status: 404 })
			},
		}
	}
	const meta = 'https://registry.npmjs.org/@nuasite%2Fcms/1.2.0'
	const tarball = 'https://registry.npmjs.org/@nuasite/cms/-/cms-1.2.0.tgz'

	test('needs both the version metadata and the tarball', async () => {
		const both = registry({ [meta]: Response.json({ dist: { tarball } }), [tarball]: new Response(null, { status: 200 }) })
		expect(await isServed(cms, both.fetch)).toBe(true)
		expect(both.urls).toEqual([meta, tarball])

		const metadataOnly = registry({ [meta]: Response.json({ dist: { tarball } }) })
		expect(await isServed(cms, metadataOnly.fetch)).toBe(false)
	})

	test('a missing version, a malformed body or a network error is not served', async () => {
		expect(await isServed(cms, registry({}).fetch)).toBe(false)
		expect(await isServed(cms, registry({ [meta]: Response.json({ dist: {} }) }).fetch)).toBe(false)
		expect(await isServed(cms, registry({ [meta]: new Error('ECONNRESET') }).fetch)).toBe(false)
	})
})

describe('waitForPins', () => {
	const clock = () => {
		let time = 0
		const logs: string[] = []
		return {
			logs,
			now: () => time,
			sleep: async (ms: number) => {
				time += ms
			},
			log: (line: string) => logs.push(line),
		}
	}

	test('returns once every pin is served, and checks a served pin only once', async () => {
		const checks: string[] = []
		const servedAt: Record<string, number> = { [cms.name]: 0, [cli.name]: 40_000 }
		const c = clock()
		const missing = await waitForPins([cms, cli], {
			...c,
			isServed: async pin => {
				checks.push(pin.name)
				return c.now() >= (servedAt[pin.name] ?? Infinity)
			},
			timeoutMs: 60_000,
			intervalMs: 20_000,
		})
		expect(missing).toEqual([])
		expect(checks).toEqual([cms.name, cli.name, cli.name, cli.name])
		expect(c.logs).toEqual(['waiting for npm to serve: @nuasite/cli@1.2.0', 'waiting for npm to serve: @nuasite/cli@1.2.0'])
	})

	test('returns the pins still missing when the timeout runs out, without sleeping past it', async () => {
		const c = clock()
		const missing = await waitForPins([cms, cli], {
			...c,
			isServed: async pin => pin.name === cms.name,
			timeoutMs: 50_000,
			intervalMs: 20_000,
		})
		expect(missing).toEqual([cli])
		expect(c.now()).toBe(50_000)
	})
})
