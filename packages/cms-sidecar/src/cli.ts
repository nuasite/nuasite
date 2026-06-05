#!/usr/bin/env bun
import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { mediaFromEnv } from './media-from-env'
import { createServer } from './server'

interface ServeArgs {
	port: number
	root: string
	contentDir?: string
}

/**
 * Resolve the installed `@nuasite/cms-core` version for the capabilities/health
 * payload: locate cms-core's entry module, walk up to its `package.json`, read
 * `version`. Avoids a deep `package.json` import. Falls back to '0.0.0'.
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

function parseServeArgs(args: string[]): ServeArgs {
	const rawPort = readFlag(args, 'port')
	const port = rawPort !== undefined ? Number.parseInt(rawPort, 10) : Number.NaN
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error('serve requires a valid --port <0-65535>')
	}
	const rawRoot = readFlag(args, 'root')
	const root = path.resolve(rawRoot ?? process.cwd())
	const contentDir = readFlag(args, 'content-dir')
	return { port, root, contentDir }
}

function printUsage(): void {
	console.log('Usage: cms-sidecar serve --port <port> [--root <dir>] [--content-dir <dir>]')
	console.log('')
	console.log('Runs a thin HTTP server exposing @nuasite/cms-core over /cms/v1.')
	console.log('Media adapter is selected by CMS_MEDIA_ADAPTER (contember|s3|local|none).')
}

function serve(args: string[]): void {
	const { port, root, contentDir } = parseServeArgs(args)
	const fs = createNodeFs(root)
	const media = mediaFromEnv()
	const core = createCmsCore(fs, { contentDir, media: media.adapter })
	const coreVersion = resolveCoreVersion()
	const server = createServer({ core, fs, root, coreVersion, contentDir })

	const bunServer = Bun.serve({ port, fetch: server.fetch })
	// Ready line — the contract with the F2 service runtime (`readyPattern`).
	// Must match /cms-sidecar listening on .*:\d+/.
	console.log(`cms-sidecar listening on :${bunServer.port}`)
}

const [, , command, ...args] = process.argv

switch (command) {
	case 'serve':
		serve(args)
		break
	case 'help':
	case '--help':
	case '-h':
	case undefined:
		printUsage()
		break
	default:
		console.error(`Unknown command: ${command}`)
		printUsage()
		process.exit(1)
}
