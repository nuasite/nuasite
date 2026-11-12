import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exactPins, type Fetch, type Manifest, parseManifest, type Pin, readManifest, servedManifest, waitForPins } from './wait-for-pins'

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

describe('servedManifest', () => {
	const registry = (responses: Record<string, Response | Error>): { fetch: Fetch; requests: { url: string; init: RequestInit }[] } => {
		const requests: { url: string; init: RequestInit }[] = []
		return {
			requests,
			fetch: async (url, init) => {
				requests.push({ url, init })
				const response = responses[url]
				if (response instanceof Error) throw response
				return response ?? new Response('not found', { status: 404 })
			},
		}
	}
	const packumentUrl = 'https://registry.npmjs.org/@nuasite%2Fcms'
	const tarball = 'https://registry.npmjs.org/@nuasite/cms/-/cms-1.2.0.tgz'
	const packument = (versions: Record<string, unknown>) => Response.json({ name: '@nuasite/cms', versions })
	const cmsEntry = { name: '@nuasite/cms', version: '1.2.0', dependencies: { '@nuasite/cms-types': '1.2.0' }, dist: { tarball } }

	test('reads the install packument and needs the version and its tarball', async () => {
		const both = registry({ [packumentUrl]: packument({ '1.2.0': cmsEntry }), [tarball]: new Response(null, { status: 200 }) })
		const manifest = await servedManifest(cms, both.fetch, () => {})
		expect(manifest && exactPins(manifest)).toEqual([{ name: '@nuasite/cms-types', version: '1.2.0' }])
		expect(both.requests.map(r => r.url)).toEqual([packumentUrl, tarball])
		expect(new Headers(both.requests[0]?.init.headers).get('accept')).toStartWith('application/vnd.npm.install-v1+json')
		expect(both.requests.every(r => r.init.signal instanceof AbortSignal)).toBe(true)

		const packumentOnly = registry({ [packumentUrl]: packument({ '1.2.0': cmsEntry }) })
		expect(await servedManifest(cms, packumentOnly.fetch, () => {})).toBeUndefined()
	})

	test('a packument without the version, a 404 or a network error is not served, and errors are logged', async () => {
		const logs: string[] = []
		const log = (line: string) => logs.push(line)
		expect(await servedManifest(cms, registry({ [packumentUrl]: packument({ '1.1.0': cmsEntry }) }).fetch, log)).toBeUndefined()
		expect(await servedManifest(cms, registry({}).fetch, log)).toBeUndefined()
		expect(await servedManifest(cms, registry({ [packumentUrl]: new Error('ECONNRESET') }).fetch, log)).toBeUndefined()
		expect(logs).toEqual(['@nuasite/cms@1.2.0: ECONNRESET'])
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
	const manifestOf = (pin: Pin, dependencies: Record<string, string> = {}): Manifest =>
		parseManifest({ name: pin.name, version: pin.version, dependencies })
	const types: Pin = { name: '@nuasite/cms-types', version: '1.2.0' }

	test('returns once every pin is served, and checks a served pin only once', async () => {
		const checks: string[] = []
		const servedAt: Record<string, number> = { [cms.name]: 0, [cli.name]: 40_000 }
		const c = clock()
		const result = await waitForPins([cms, cli], {
			...c,
			served: async pin => {
				checks.push(pin.name)
				return c.now() >= (servedAt[pin.name] ?? Infinity) ? manifestOf(pin) : undefined
			},
			timeoutMs: 60_000,
			intervalMs: 20_000,
		})
		expect(result).toEqual({ missing: [], checked: 2 })
		expect(checks).toEqual([cms.name, cli.name, cli.name, cli.name])
		expect(c.logs).toEqual(['waiting for npm to serve: @nuasite/cli@1.2.0', 'waiting for npm to serve: @nuasite/cli@1.2.0'])
	})

	test('waits for the exact pins of served dependencies too', async () => {
		const c = clock()
		const result = await waitForPins([cms], {
			...c,
			served: async pin => {
				if (pin.name === cms.name) return manifestOf(cms, { '@nuasite/cms-types': '1.2.0', yaml: '^2.0.0' })
				return c.now() >= 20_000 ? manifestOf(pin, { '@nuasite/cms': '1.2.0' }) : undefined
			},
			timeoutMs: 60_000,
			intervalMs: 20_000,
		})
		expect(result).toEqual({ missing: [], checked: 2 })
		expect(c.logs).toEqual(['waiting for npm to serve: @nuasite/cms-types@1.2.0'])
	})

	test('returns the pins still missing when the timeout runs out, without sleeping past it', async () => {
		const c = clock()
		const result = await waitForPins([cms, cli], {
			...c,
			served: async pin => (pin.name === cms.name ? manifestOf(pin, { '@nuasite/cms-types': '1.2.0' }) : undefined),
			timeoutMs: 50_000,
			intervalMs: 20_000,
		})
		expect(result).toEqual({ missing: [cli, types], checked: 3 })
		expect(c.now()).toBe(50_000)
	})
})
