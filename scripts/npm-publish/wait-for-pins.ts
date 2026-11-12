// Waits until the npm registry serves every exact version a packed package pins, directly or through its
// pinned dependencies, so publishing it never leaves `npm install` with a version that does not resolve yet.
// Usage: bun scripts/npm-publish/wait-for-pins.ts <package.tgz> [--timeout-seconds <n>]

const REGISTRY = 'https://registry.npmjs.org'
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const POLL_INTERVAL_MS = 20_000
const REQUEST_TIMEOUT_MS = 15_000
// The CDN caches each packument form separately: npm resolves new dependencies from the full one,
// npm with a lockfile, pnpm, bun and yarn from the abbreviated one.
const PACKUMENT_ACCEPTS = ['application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*', 'application/json']

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

/**
 * The manifest of a pinned version once npm serves it to an install, or undefined while it does not.
 * The version must be listed in both cached packument forms, and its tarball must answer 200.
 */
export async function servedManifest(pin: Pin, fetchFn: Fetch, log: (line: string) => void): Promise<Manifest | undefined> {
	try {
		let entry: Record<string, unknown> | undefined
		for (const accept of PACKUMENT_ACCEPTS) {
			const packument = await fetchFn(`${REGISTRY}/${pin.name.replace('/', '%2F')}`, {
				headers: { accept },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
			if (packument.status !== 200) return undefined
			const body: unknown = await packument.json()
			const listed = isRecord(body) && isRecord(body.versions) ? body.versions[pin.version] : undefined
			if (!isRecord(listed)) return undefined
			entry ??= listed
		}
		if (entry === undefined) return undefined
		const manifest = parseManifest(entry)
		const tarball = isRecord(entry.dist) ? entry.dist.tarball : undefined
		if (typeof tarball !== 'string') throw new Error('no dist.tarball')
		const head = await fetchFn(tarball, { method: 'HEAD', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
		return head.status === 200 ? manifest : undefined
	} catch (error) {
		log(`${formatPin(pin)}: ${error instanceof Error ? error.message : String(error)}`)
		return undefined
	}
}

export interface WaitOptions {
	served: (pin: Pin) => Promise<Manifest | undefined>
	timeoutMs: number
	intervalMs: number
	now: () => number
	sleep: (ms: number) => Promise<void>
	log: (line: string) => void
}

export interface WaitResult {
	/** Pins still not served when the timeout ran out; empty when every pin is served. */
	missing: Pin[]
	checked: number
}

/**
 * Waits for the pins and, transitively, for the exact pins of every served version, because an install
 * resolves those too. A served pin is checked once.
 */
export async function waitForPins(pins: Pin[], options: WaitOptions): Promise<WaitResult> {
	const deadline = options.now() + options.timeoutMs
	const seen = new Set(pins.map(formatPin))
	let pending = pins
	for (;;) {
		const manifests = await Promise.all(pending.map(pin => options.served(pin)))
		const missing: Pin[] = []
		const discovered: Pin[] = []
		pending.forEach((pin, i) => {
			const manifest = manifests[i]
			if (manifest === undefined) {
				missing.push(pin)
				return
			}
			for (const dependency of exactPins(manifest)) {
				const key = formatPin(dependency)
				if (seen.has(key)) continue
				seen.add(key)
				discovered.push(dependency)
			}
		})
		pending = [...missing, ...discovered]
		if (pending.length === 0) return { missing: [], checked: seen.size }
		// Newly found pins are checked at once; a sleep only waits for the registry.
		if (discovered.length > 0) continue
		const left = deadline - options.now()
		if (left <= 0) return { missing, checked: seen.size }
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
	let timeoutMs = 300_000
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
	const log = (line: string) => console.log(line)
	const { missing, checked } = await waitForPins(pins, {
		served: pin => servedManifest(pin, fetch, log),
		timeoutMs,
		intervalMs: POLL_INTERVAL_MS,
		now: Date.now,
		sleep: ms => Bun.sleep(ms),
		log,
	})
	if (missing.length > 0) {
		const list = missing.map(formatPin).join(', ')
		console.log(
			`::error::npm does not serve ${list} after ${timeoutMs / 1000} s. ${manifest.name} was not published. Re-run the failed job once they appear.`,
		)
		process.exit(1)
	}
	console.log(`npm serves all ${checked} pinned versions, dependencies included; ${manifest.name} can be published`)
}
