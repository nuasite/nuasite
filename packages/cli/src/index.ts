#!/usr/bin/env bun
import { agentsSummary } from '@nuasite/agent-summary'
import { type AstroInlineConfig, build as astroBuild, dev, preview } from 'astro'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findAstroConfig } from './utils'

const [, , command, ...args] = process.argv

function hasNuaIntegration(configPath: string): boolean {
	try {
		const content = readFileSync(configPath, 'utf-8')
		return content.includes('@nuasite/agent-summary') || content.includes('agentsSummary')
	} catch {
		return false
	}
}

function proxyToAstroCLI(command: string, args: string[]) {
	const astro = spawn('npx', ['astro', command, ...args], {
		stdio: 'inherit',
		shell: true,
	})

	astro.on('close', (code) => {
		process.exit(code || 0)
	})

	astro.on('error', (error) => {
		console.error('Error running astro command:', error)
		process.exit(1)
	})
}

function printUsage() {
	console.log('Usage: nua <command> [options]')
	console.log('\nCommands:')
	console.log('  build    Run astro build with the Nua defaults')
	console.log('  dev      Run astro dev with the Nua defaults')
	console.log('  preview  Run astro preview with the Nua defaults')
	console.log('  init     Convert a standard Astro project to use Nua')
	console.log('  clean    Eject to a standard Astro project (remove @nuasite/* deps)')
	console.log('  help     Show this message')
	console.log('\nAll Astro CLI options are supported.\n')
}

const configPath = findAstroConfig()
const canProxyDirectly = configPath && hasNuaIntegration(configPath)

if (canProxyDirectly && command && ['build', 'dev', 'preview'].includes(command)) {
	proxyToAstroCLI(command, args)
} else {
	switch (command) {
		case 'build':
			astroBuild({
				root: process.cwd(),
				integrations: [agentsSummary()],
			}).catch((error) => {
				console.error('Error:', error)
				process.exit(1)
			})
			break
		case 'dev':
		case 'preview': {
			const server: { port?: number; host?: string } = {}

			for (let i = 0; i < args.length; i++) {
				if (args[i] === '--port' && args[i + 1]) {
					server.port = parseInt(args[i + 1]!, 10)
					i++
				} else if (args[i] === '--host' && args[i + 1]) {
					server.host = args[i + 1]
					i++
				}
			}

			const options: AstroInlineConfig = {
				root: process.cwd(),
				integrations: [agentsSummary()],
				server,
			}

			const runner = command === 'dev' ? dev : preview
			runner(options).catch((error) => {
				console.error('Error:', error)
				process.exit(1)
			})
			break
		}
		case 'init': {
			const { init } = await import('./init')
			await init({
				cwd: process.cwd(),
				dryRun: args.includes('--dry-run'),
				yes: args.includes('--yes') || args.includes('-y'),
			})
			break
		}
		case 'clean': {
			const { clean } = await import('./clean')
			await clean({
				cwd: process.cwd(),
				dryRun: args.includes('--dry-run'),
				yes: args.includes('--yes') || args.includes('-y'),
			})
			break
		}
		case 'help':
		case '--help':
		case '-h':
			printUsage()
			break
		default:
			console.error(command ? `Unknown command: ${command}` : 'No command specified.')
			printUsage()
			process.exit(1)
	}
}
