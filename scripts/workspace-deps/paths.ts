import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function packageDir(): string {
	// During pre/postpack, INIT_CWD points at the package being packed.
	return process.env.INIT_CWD ?? process.cwd()
}

export function ledgerPath(): string {
	// Put ledger in OS temp, unique per package path
	const pkgDir = packageDir()
	const key = Buffer.from(pkgDir).toString('base64url')
	const dir = path.join(os.tmpdir(), 'ws-ledgers')
	fs.mkdirSync(dir, { recursive: true })
	return path.join(dir, `${key}.json`)
}
