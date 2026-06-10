#!/usr/bin/env bun
/**
 * `bunx @nuasite/cms-studio --root <project> [--port <n>] [--content-dir <dir>]`
 *
 * Boots the standalone Nua CMS over a project directory: an in-process
 * cms-sidecar (the `/cms/v1` brain over `createCmsCore(createNodeFs(root))`) plus
 * the prebuilt collections admin SPA, on one origin (see `./server`).
 *
 * Media defaults to the `local` adapter (project `public/uploads`) so the
 * standalone app works with zero config; the dir is pinned to an absolute path
 * under `--root` so uploads land in the project regardless of the launch cwd.
 * `CMS_MEDIA_ADAPTER` (and friends) still override it for `s3` / `contember`.
 */
import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { createServer, mediaFromEnv } from '@nuasite/cms-sidecar'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createStudioServer } from './server'

const DEFAULT_PORT = 4400

interface StudioArgs {
	port: number
	root: string
	contentDir?: string
	componentDirs?: string[]
}

/** Read `--<name> <value>` (or `--<name>=<value>`) from argv. */
function readFlag(args: string[], name: string): string | undefined {
	const eq = `--${name}=`
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === `--${name}`) return args[i + 1]
		if (arg.startsWith(eq)) return arg.slice(eq.length)
	}
	return undefined
}

function parseArgs(args: string[]): StudioArgs {
	const rawPort = readFlag(args, 'port') ?? process.env.PORT
	const port = rawPort !== undefined ? Number.parseInt(rawPort, 10) : DEFAULT_PORT
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error('--port must be a valid port (0-65535)')
	}
	const root = path.resolve(readFlag(args, 'root') ?? process.cwd())
	const contentDir = readFlag(args, 'content-dir')
	const rawComponents = readFlag(args, 'components-dir')
	const componentDirs = rawComponents
		? rawComponents.split(',').map(s => s.trim()).filter(Boolean)
		: undefined
	return { port, root, contentDir, componentDirs }
}

/**
 * Resolve the installed `@nuasite/cms-core` version for the `/health` payload by
 * walking up from its entry module to its `package.json`. Falls back to '0.0.0'.
 */
function resolveCoreVersion(): string {
	try {
		const require = createRequire(import.meta.url)
		let dir = path.dirname(require.resolve('@nuasite/cms-core'))
		for (;;) {
			const pkgPath = path.join(dir, 'package.json')
			if (fs.existsSync(pkgPath)) {
				const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
				if (
					parsed && typeof parsed === 'object' && 'name' in parsed && parsed.name === '@nuasite/cms-core' && 'version' in parsed
					&& typeof parsed.version === 'string'
				) {
					return parsed.version
				}
			}
			const parent = path.dirname(dir)
			if (parent === dir) break
			dir = parent
		}
	} catch {
		// fall through
	}
	return '0.0.0'
}

/**
 * Build the env mediaFromEnv reads, applying studio defaults without mutating the
 * process env: default to the `local` adapter, and pin its dir to an absolute
 * path under the project root so uploads land in the project (not the cwd).
 */
function studioMediaEnv(root: string): NodeJS.ProcessEnv {
	const env = { ...process.env }
	if (env.CMS_MEDIA_ADAPTER === undefined) env.CMS_MEDIA_ADAPTER = 'local'
	if (env.CMS_MEDIA_ADAPTER === 'local' && env.CMS_MEDIA_LOCAL_DIR === undefined) {
		env.CMS_MEDIA_LOCAL_DIR = path.join(root, 'public/uploads')
	}
	return env
}

function printUsage(): void {
	console.log('Usage: cms-studio [--root <dir>] [--port <port>] [--content-dir <dir>] [--components-dir <a,b>]')
	console.log('')
	console.log('Serves the Nua CMS collections admin UI and the /cms/v1 API for a project,')
	console.log('on a single origin. Media defaults to the local adapter (public/uploads);')
	console.log('set CMS_MEDIA_ADAPTER=s3|contember (+ its env) to use a hosted backend.')
}

function serve(args: string[]): void {
	const { port, root, contentDir, componentDirs } = parseArgs(args)

	const nodeFs = createNodeFs(root)
	const media = mediaFromEnv(studioMediaEnv(root))
	const core = createCmsCore(nodeFs, { contentDir, componentDirs, media: media.adapter })
	const sidecar = createServer({ core, fs: nodeFs, root, coreVersion: resolveCoreVersion(), contentDir })

	const spaDir = path.join(import.meta.dir, '..', 'dist', 'spa')
	const publicDir = path.join(root, 'public')
	const studio = createStudioServer({
		sidecar,
		spaDir,
		publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
	})

	const server = Bun.serve({ port, fetch: studio.fetch })
	console.log(`cms-studio: serving ${root}`)
	console.log(`cms-studio: admin + API on http://localhost:${server.port} (media: ${media.kind})`)
}

const [, , command, ...args] = process.argv

switch (command) {
	case undefined:
	case 'serve':
		serve(args)
		break
	case 'help':
	case '--help':
	case '-h':
		printUsage()
		break
	default:
		// Treat a bare flag (e.g. `cms-studio --root .`) as an implicit `serve`.
		if (command.startsWith('-')) {
			serve([command, ...args])
		} else {
			console.error(`Unknown command: ${command}`)
			printUsage()
			process.exit(1)
		}
}
