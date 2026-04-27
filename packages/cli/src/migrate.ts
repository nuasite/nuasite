import { migrateAstroImages } from '@nuasite/cms'
import path from 'node:path'

interface MigrateArgs {
	target: string
	dryRun: boolean
}

export async function migrate(args: MigrateArgs): Promise<void> {
	if (args.target !== 'astro-image') {
		console.error(`Unknown migrate target: ${args.target}`)
		console.error('Available targets: astro-image')
		process.exit(1)
	}

	if (args.dryRun) console.log('Dry run — no files will be modified.\n')

	const result = await migrateAstroImages({ dryRun: args.dryRun })

	if (result.migrations.length === 0) {
		console.log('No entries needed migration.')
	} else {
		console.log(`${result.migrations.length} field(s) to migrate:\n`)
		for (const m of result.migrations) {
			console.log(`  ${m.entrySourcePath}`)
			console.log(`    ${m.fieldName}: ${m.originalValue} → ${m.newValue}`)
			console.log(`      copy: ${path.relative(process.cwd(), m.copiedFrom)} → ${path.relative(process.cwd(), m.copiedTo)}`)
		}
	}

	if (result.skipped.length > 0) {
		console.log(`\n${result.skipped.length} skipped:`)
		for (const s of result.skipped) {
			console.log(`  ${s.entrySourcePath} ${s.fieldName}: ${s.reason}`)
		}
	}

	if (!args.dryRun && result.migrations.length > 0) {
		console.log('\nDone. Run your dev server and verify Astro processes the images correctly.')
	}
}
