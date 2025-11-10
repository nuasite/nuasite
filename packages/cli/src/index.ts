#!/usr/bin/env bun
import { agentsSummary } from '@nuasite/agent-summary'
import { type AstroInlineConfig, build as astroBuild, dev, preview } from 'astro'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , command, ...args] = process.argv

function hasNuaIntegration(configPath: string): boolean {
	try {
		const content = readFileSync(configPath, 'utf-8')
		return content.includes('@nuasite/agent-summary') || content.includes('agentsSummary')
	} catch {
		return false
	}
}

function findAstroConfig(): string | null {
	const possibleConfigs = [
		'astro.config.mjs',
		'astro.config.js',
		'astro.config.ts',
		'astro.config.mts',
	]

	for (const config of possibleConfigs) {
		const configPath = join(process.cwd(), config)
		if (existsSync(configPath)) {
			return configPath
		}
	}
	return null
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
	console.log('  build   Run astro build with the Nua defaults')
	console.log('  preview Run astro preview with the Nua defaults')
	console.log('  dev     Run astro dev with the Nua defaults')
	console.log('  help    Show this message')
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
			const options: AstroInlineConfig = {
				root: process.cwd(),
				integrations: [agentsSummary()],
				vite: {
					server: {}
				}
			}

			for (let i = 0; i < args.length; i++) {
				if (args[i] === '--port' && args[i + 1]) {
					options.vite!.server!.port = parseInt(args[i + 1] ?? '', 10)
					i++
				} else if (args[i] === '--host' && args[i + 1]) {
					options.vite!.server!.host = args[i + 1]
					i++
				}
			}

			const runner = command === 'dev' ? dev : preview
			runner(options).catch((error) => {
				console.error('Error:', error)
				process.exit(1)
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
