import { Glob } from 'bun'
import JSON5 from 'json5'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join, normalize } from 'node:path'
import ts from 'typescript'

const globalModules = new Set(['vitest'])
const allowedUnused = new Set([
	'stacktracey',
])

const allowedDirectoryImports = new Set(['@astrojs/compiler/types', 'preact/hooks'])

const processPackage = async (dir: string, projectList: ProjectList) => {
	const glob = new Glob(`${dir}/src/**/*.{ts,tsx}`)
	const excludeGlob = new Glob(`${dir}/**/src/generated/**`)
	const allFiles = Array.from(glob.scanSync())
	const excludedFiles = new Set(Array.from(excludeGlob.scanSync()))
	// Exclude pre-bundled editor source (bundled into dist/editor.js)
	if (dir.endsWith('/cms')) {
		for (const f of allFiles) {
			if (f.includes('/src/editor/')) excludedFiles.add(f)
		}
	}
	const files = allFiles.filter(file => !excludedFiles.has(file))
	const contents = await Promise.all(files.map(async (it): Promise<[file: string, content: string]> => [it, await fs.readFile(it, 'utf-8')]))
	const imports = new Set<string>()
	const errors: { file: string; message: string; type: string }[] = []
	for (const [file, content] of contents) {
		const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext)
		sourceFile.forEachChild(node => {
			if (node.kind === ts.SyntaxKind.ImportDeclaration || node.kind === ts.SyntaxKind.ExportDeclaration) {
				const moduleSpecifier = (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier
				if (!moduleSpecifier) {
					return
				}
				const module = (moduleSpecifier as ts.StringLiteral).text
				if (module === '.' || module === '..') {
					errors.push({ file, message: `Dot import ("${module}") is forbidden`, type: 'forbidden_import' })
				}
				if (!module.startsWith('node:') && !module.startsWith('bun:') && !module.startsWith('.') && !globalModules.has(module)) {
					const moduleMatch = module.match(/^((?:@[\w_-]+\/)?[.\w_-]+)(\/.+)?$/)
					if (!moduleMatch) {
						throw new Error(`Invalid module ${module}`)
					}
					if (moduleMatch[2] && !allowedDirectoryImports.has(module)) {
						errors.push({ file, message: `Forbidden file/directory import found: ${module}`, type: 'forbidden_import' })
					}
					imports.add(moduleMatch[1])
				}
			}
		})
	}
	const thisProject = projectList.getByDir(dir)
	const allProjectNames = projectList.projects.map(it => it.name)
	const referencedProjects = thisProject.tsconfig.references?.map(it => projectList.getByDir(normalize(join(dir, 'src', it.path)))) ?? []
	const referencedProjectNames = referencedProjects.map(it => it.name)

	for (const module of Array.from(imports.values())) {
		if (!thisProject.packageJson.dependencies?.[module] && !thisProject.packageJson.peerDependencies?.[module]) {
			errors.push({ file: dir, message: `Module ${module} is missing in package.json`, type: 'package_missing' })
		}
		if (allProjectNames.includes(module) && !referencedProjectNames.includes(module)) {
			errors.push({ file: dir, message: `Module ${module} is not referenced from tsconfig.json`, type: 'tsconfig_missing' })
		}
	}
	for (const referenced of referencedProjectNames) {
		if (!imports.has(referenced)) {
			errors.push({ file: dir, message: `Project ${referenced} referenced from tsconfig.json is not used`, type: 'tsconfig_unused' })
		}
	}
	for (const key in thisProject.packageJson.dependencies ?? {}) {
		if (!imports.has(key) && !allowedUnused.has(key)) {
			errors.push({ file: dir, message: `Module ${key} from package.json dependencies is unused`, type: 'package_unused' })
		}
	}

	if (errors.length > 0) {
		console.log(`${dir}:\n`)
		for (const { message } of errors.sort((a, b) => a.type.localeCompare(b.type) || a.message.localeCompare(b.message))) {
			console.log(`${message}`)
		}
		console.log('')
		return false
	}
	return true
}

class ProjectList {
	constructor(
		public readonly projects: Project[],
	) {
	}

	public getByName(name: string) {
		const project = this.projects.find(it => it.name === name)
		if (!project) {
			throw new Error(`Undefined project ${name}`)
		}
		return project
	}

	public getByDir(dir: string) {
		const project = this.projects.find(it => it.dir === dir || join(it.dir, 'src') === dir)
		if (!project) {
			throw new Error(`Undefined project ${dir}`)
		}
		return project
	}
}
interface Project {
	name: string
	dir: string
	tsconfig: {
		references?: { path: string }[]
	}
	packageJson: {
		dependencies?: Record<string, string>
		peerDependencies?: Record<string, string>
		devDependencies?: Record<string, string>
	}
}
;(async () => {
	const glob = new Glob(process.cwd() + '/packages/*')
	const dirs = Array.from(glob.scanSync({ onlyFiles: false }))
		.filter(dir => !dir.endsWith('packages/playground'))
		.filter(it => existsSync(`${it}/package.json`))
		.filter(it => existsSync(join(it, 'src', 'tsconfig.json')))

	const projects = await Promise.all(dirs.map(async (dir): Promise<Project> => {
		try {
			const packageJson = JSON5.parse(await fs.readFile(`${dir}/package.json`, 'utf8'))
			const tsconfigPath = join(dir, 'src', 'tsconfig.json')
			const tsconfig = JSON5.parse(await fs.readFile(tsconfigPath, 'utf8'))
			return {
				dir,
				name: packageJson.name,
				packageJson,
				tsconfig,
			}
		} catch (e) {
			console.log(dir)
			throw e
		}
	}))
	const projectList = new ProjectList(projects)
	const failed = (await Promise.all(dirs.filter(it => !process.argv[2] || it.endsWith(process.argv[2])).map(it => processPackage(it, projectList))))
		.some(it => !it)
	if (failed) {
		process.exit(1)
	}
})().catch(e => {
	console.error(e)
	process.exit(1)
})
