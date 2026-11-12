// Waits until the npm registry serves every exact version a packed package pins, so publishing it
// never leaves `npm install` with a version that does not resolve yet.
// Usage: bun scripts/npm-publish/wait-for-pins.ts <package.tgz> [--timeout-seconds <n>]

const REGISTRY = 'https://registry.npmjs.org'
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const POLL_INTERVAL_MS = 20_000

type StringMap = Record<string, string>

export interface Manifest {
	name: string
	version: string
	dependencies: StringMap
	peerDependencies: StringMap
	optionalPeers: Set<string>
}

export interface Pin {
	name: string
	version: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, field: string): string {
	const value = record[field]
	if (typeof value !== 'string') throw new Error(`package.json: "${field}" must be a string`)
	return value
}

function stringMap(value: unknown, field: string): StringMap {
	if (value === undefined) return {}
	if (!isRecord(value)) throw new Error(`package.json: "${field}" must be an object`)
	const out: StringMap = {}
	for (const [key, range] of Object.entries(value)) {
		if (typeof range !== 'string') throw new Error(`package.json: "${field}.${key}" must be a string`)
		out[key] = range
	}
	return out
}

export function parseManifest(json: unknown): Manifest {
	if (!isRecord(json)) throw new Error('package.json must be an object')
	const meta = json.peerDependenciesMeta
	if (meta !== undefined && !isRecord(meta)) throw new Error('package.json: "peerDependenciesMeta" must be an object')
	const optionalPeers = new Set<string>()
	for (const [name, entry] of Object.entries(meta ?? {})) {
		if (isRecord(entry) && entry.optional === true) optionalPeers.add(name)
	}
	return {
		name: stringField(json, 'name'),
		version: stringField(json, 'version'),
		dependencies: stringMap(json.dependencies, 'dependencies'),
		peerDependencies: stringMap(json.peerDependencies, 'peerDependencies'),
		optionalPeers,
	}
}

/** Exact versions that `npm install` must resolve: dependencies and required peers, which npm installs too. */
export function exactPins(manifest: Manifest): Pin[] {
	const pins = new Map<string, string>()
	for (const [name, range] of Object.entries(manifest.dependencies)) {
		if (EXACT_VERSION.test(range)) pins.set(name, range)
	}
	for (const [name, range] of Object.entries(manifest.peerDependencies)) {
		if (!manifest.optionalPeers.has(name) && EXACT_VERSION.test(range)) pins.set(name, range)
	}
	return [...pins].map(([name, version]) => ({ name, version }))
}

export function readManifest(tarball: string): Manifest {
	const result = Bun.spawnSync(['tar', '-xzOf', tarball, 'package/package.json'])
	if (result.exitCode !== 0) throw new Error(`cannot read package/package.json from ${tarball}: ${result.stderr.toString()}`)
	return parseManifest(JSON.parse(result.stdout.toString()))
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** Served means both the version metadata and its tarball answer 200, which is what an install needs. */
export async function isServed(pin: Pin, fetchFn: Fetch): Promise<boolean> {
	const noCache = { 'cache-control': 'no-cache' }
	try {
		const meta = await fetchFn(`${REGISTRY}/${pin.name.replace('/', '%2F')}/${pin.version}`, { headers: noCache })
		if (meta.status !== 200) return false
		const body: unknown = await meta.json()
		const tarball = isRecord(body) && isRecord(body.dist) ? body.dist.tarball : undefined
		if (typeof tarball !== 'string') return false
		const head = await fetchFn(tarball, { method: 'HEAD', headers: noCache })
		return head.status === 200
	} catch {
		return false
	}
}

export interface WaitOptions {
	isServed: (pin: Pin) => Promise<boolean>
	timeoutMs: number
	intervalMs: number
	now: () => number
	sleep: (ms: number) => Promise<void>
	log: (line: string) => void
}

/** Returns the pins still not served when the timeout runs out; an empty list means all are served. */
export async function waitForPins(pins: Pin[], options: WaitOptions): Promise<Pin[]> {
	const deadline = options.now() + options.timeoutMs
	let missing = pins
	for (;;) {
		const served = await Promise.all(missing.map(pin => options.isServed(pin)))
		missing = missing.filter((_, i) => !served[i])
		if (missing.length === 0) return []
		const left = deadline - options.now()
		if (left <= 0) return missing
		options.log(`waiting for npm to serve: ${missing.map(formatPin).join(', ')}`)
		await options.sleep(Math.min(options.intervalMs, left))
	}
}

export function formatPin(pin: Pin): string {
	return `${pin.name}@${pin.version}`
}

function parseArgs(argv: string[]): { tarball: string; timeoutMs: number } {
	const [tarball, ...rest] = argv
	if (!tarball) throw new Error('usage: wait-for-pins.ts <package.tgz> [--timeout-seconds <n>]')
	let timeoutMs = 420_000
	if (rest.length > 0) {
		const seconds = Number(rest[1])
		if (rest[0] !== '--timeout-seconds' || rest.length !== 2 || !Number.isInteger(seconds) || seconds < 0) {
			throw new Error('usage: wait-for-pins.ts <package.tgz> [--timeout-seconds <n>]')
		}
		timeoutMs = seconds * 1000
	}
	return { tarball, timeoutMs }
}

if (import.meta.main) {
	const { tarball, timeoutMs } = parseArgs(process.argv.slice(2))
	const manifest = readManifest(tarball)
	const pins = exactPins(manifest)
	console.log(`${manifest.name}@${manifest.version} pins ${pins.length} exact versions`)
	const missing = await waitForPins(pins, {
		isServed: pin => isServed(pin, fetch),
		timeoutMs,
		intervalMs: POLL_INTERVAL_MS,
		now: Date.now,
		sleep: ms => Bun.sleep(ms),
		log: line => console.log(line),
	})
	if (missing.length > 0) {
		const list = missing.map(formatPin).join(', ')
		console.log(
			`::error::npm does not serve ${list} after ${timeoutMs / 1000} s. ${manifest.name} was not published. Re-run the failed job once they appear.`,
		)
		process.exit(1)
	}
	console.log(`npm serves every pinned version; ${manifest.name} can be published`)
}
