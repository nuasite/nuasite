import * as fs from 'node:fs/promises'
import { Glob } from 'bun'

;(async () => {
	const cwd = process.cwd()
	const version = process.argv[2]
	const glob = new Glob(process.cwd() + '/packages/*')
	const dirs = [cwd, ...await Array.fromAsync(glob.scan({ onlyFiles: false }))]

	await Promise.all(dirs.map(async (dir): Promise<void> => {
		const packageJsonPath = `${dir}/package.json`
		try {
			await fs.access(packageJsonPath)
		} catch {
			return
		}
		try {
			const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
			const newPackageJson = {
				...packageJson,
				version,
			}
			await fs.writeFile(packageJsonPath, JSON.stringify(newPackageJson, null, '\t') + '\n', 'utf8')
		} catch (e) {
			console.log(dir)
			throw e
		}
	}))
})().catch(e => {
	console.error(e)
	process.exit(1)
})
