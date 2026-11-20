#!/usr/bin/env bun
import { spawn } from 'node:child_process'

const [, , command, ...args] = process.argv

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
	console.log('  build              Run astro build with the Nua defaults')
	console.log('  dev                Run astro dev with the Nua defaults')
	console.log('  preview            Run astro preview with the Nua defaults')
	console.log('  check              Validate collections and parse the source (no build). --json, --strict, --content-only, --no-live,')
	console.log('                     --fail-on <file,...> (fail only on errors in these files), --files <file,...> (parse only')
	console.log('                     these source files; content is still checked in full). --no-live also keeps the')
	console.log("                     project's own tailwindcss unloaded; stylesheets are then parsed with the bundled one")
	console.log('  init               Convert a standard Astro project to use Nua')
	console.log('  clean              Eject to a standard Astro project (remove @nuasite/* deps)')
	console.log('  migrate <target>   Run a content migration. Targets: astro-image')
	console.log('  help               Show this message')
	console.log('\nAll Astro CLI options are supported.\n')
}

if (command && ['build', 'dev', 'preview'].includes(command)) {
	proxyToAstroCLI(command, args)
} else {
	switch (command) {
		case 'check': {
			const { check, CheckUsageError, parseCheckArgs } = await import('./check')
			let options: ReturnType<typeof parseCheckArgs>
			try {
				options = parseCheckArgs(args, process.cwd())
			} catch (error) {
				if (!(error instanceof CheckUsageError)) throw error
				console.error(error.message)
				process.exit(2)
			}
			process.exit(await check(options))
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
		case 'migrate': {
			const target = args.find(a => !a.startsWith('-'))
			if (!target) {
				console.error('Usage: nua migrate <target> [--dry-run]')
				console.error('Available targets: astro-image')
				process.exit(1)
			}
			const { migrate } = await import('./migrate')
			await migrate({ target, dryRun: args.includes('--dry-run') })
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
