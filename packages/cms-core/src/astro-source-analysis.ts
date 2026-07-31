import { parse as parseBabel } from '@babel/parser'
import type * as t from '@babel/types'

export type AstroContentAccessor = 'getCollection' | 'getEntry' | 'getEntryBySlug' | 'getEntries'

export interface AstroSourceImport {
	source: string
}

export interface AstroContentCall {
	accessor: AstroContentAccessor
	collectionName: string | null
	inExportedGetStaticPaths: boolean
}

export interface AstroCollectionBinding {
	localName: string
	collectionName: string
	/** Path from an item (array) or value (entry) to the value held by this binding. */
	itemPath: string
}

export interface AstroSourceAnalysis {
	imports: AstroSourceImport[]
	collectionCalls: AstroContentCall[]
	collectionBindings: AstroCollectionBinding[]
}

interface CollectionBinding {
	collectionName: string
	itemPath: string
	shape: 'array' | 'entry'
}

interface AnalyzerContext {
	insideExportedGetStaticPaths: boolean
	shadowed: ReadonlySet<string>
}

const FUNCTION_NODE_TYPES = new Set([
	'ArrowFunctionExpression',
	'FunctionDeclaration',
	'FunctionExpression',
	'ObjectMethod',
	'ClassMethod',
	'ClassPrivateMethod',
])

const SKIPPED_CHILD_KEYS = new Set([
	'loc',
	'start',
	'end',
	'range',
	'leadingComments',
	'trailingComments',
	'innerComments',
	'extra',
	'errors',
])

function isContentAccessor(value: string): value is AstroContentAccessor {
	return value === 'getCollection'
		|| value === 'getEntry'
		|| value === 'getEntryBySlug'
		|| value === 'getEntries'
}

function isNode(value: unknown): value is t.Node {
	return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
}

function childNodes(node: t.Node): t.Node[] {
	const children: t.Node[] = []
	for (const key of Object.keys(node)) {
		if (SKIPPED_CHILD_KEYS.has(key)) continue
		const value: unknown = Reflect.get(node, key)
		if (isNode(value)) {
			children.push(value)
		} else if (Array.isArray(value)) {
			for (const item of value) {
				if (isNode(item)) children.push(item)
			}
		}
	}
	return children
}

/** Extract frontmatter only when the opening fence is the first line, after an optional BOM. */
function extractAstroFrontmatter(source: string): string | null {
	const fenceStart = source.charCodeAt(0) === 0xFEFF ? 1 : 0
	if (source.slice(fenceStart, fenceStart + 3) !== '---') return null

	let codeStart = fenceStart + 3
	if (source.slice(codeStart, codeStart + 2) === '\r\n') {
		codeStart += 2
	} else if (source.charCodeAt(codeStart) === 10) {
		codeStart++
	} else {
		return null
	}

	let lineStart = codeStart
	while (lineStart <= source.length) {
		const newline = source.indexOf('\n', lineStart)
		const rawLineEnd = newline === -1 ? source.length : newline
		const lineEnd = rawLineEnd > lineStart && source.charCodeAt(rawLineEnd - 1) === 13
			? rawLineEnd - 1
			: rawLineEnd
		if (source.slice(lineStart, lineEnd) === '---') {
			let codeEnd = lineStart
			if (codeEnd > codeStart && source.charCodeAt(codeEnd - 1) === 10) {
				codeEnd--
				if (codeEnd > codeStart && source.charCodeAt(codeEnd - 1) === 13) codeEnd--
			}
			return source.slice(codeStart, codeEnd)
		}
		if (newline === -1) return null
		lineStart = newline + 1
	}
	return null
}

function parseScript(source: string): t.File | null {
	try {
		return parseBabel(source, {
			sourceType: 'module',
			plugins: ['typescript', 'jsx'],
			errorRecovery: true,
		})
	} catch {
		return null
	}
}

function importedName(specifier: t.ImportSpecifier): string {
	return specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
}

function importFacts(ast: t.File): AstroSourceImport[] {
	return ast.program.body.flatMap(statement => statement.type === 'ImportDeclaration' ? [{ source: statement.source.value }] : [])
}

function contentImportBindings(ast: t.File): {
	named: Map<string, AstroContentAccessor>
	namespaces: Set<string>
} {
	const named = new Map<string, AstroContentAccessor>()
	const namespaces = new Set<string>()
	for (const statement of ast.program.body) {
		if (
			statement.type !== 'ImportDeclaration'
			|| statement.source.value !== 'astro:content'
			|| statement.importKind === 'type'
			|| statement.importKind === 'typeof'
		) continue
		for (const specifier of statement.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name)
			if (
				specifier.type === 'ImportSpecifier'
				&& specifier.importKind !== 'type'
				&& specifier.importKind !== 'typeof'
			) {
				const name = importedName(specifier)
				if (isContentAccessor(name)) named.set(specifier.local.name, name)
			}
		}
	}
	return { named, namespaces }
}

function addPatternNames(pattern: t.Node | null | undefined, names: Set<string>): void {
	if (!pattern) return
	switch (pattern.type) {
		case 'Identifier':
			names.add(pattern.name)
			return
		case 'ObjectPattern':
			for (const property of pattern.properties) {
				if (property.type === 'RestElement') addPatternNames(property.argument, names)
				else addPatternNames(property.value, names)
			}
			return
		case 'ArrayPattern':
			for (const element of pattern.elements) addPatternNames(element, names)
			return
		case 'AssignmentPattern':
			addPatternNames(pattern.left, names)
			return
		case 'RestElement':
			addPatternNames(pattern.argument, names)
			return
		case 'TSParameterProperty':
			addPatternNames(pattern.parameter, names)
			return
	}
}

function declarationFromStatement(
	statement: t.Statement | t.ModuleDeclaration,
): t.VariableDeclaration | t.FunctionDeclaration | t.ClassDeclaration | null {
	if (statement.type === 'VariableDeclaration' || statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
		return statement
	}
	if (statement.type !== 'ExportNamedDeclaration' && statement.type !== 'ExportDefaultDeclaration') return null
	const declaration = statement.declaration
	return declaration?.type === 'VariableDeclaration'
			|| declaration?.type === 'FunctionDeclaration'
			|| declaration?.type === 'ClassDeclaration'
		? declaration
		: null
}

function addDirectLexicalNames(
	statements: Array<t.Statement | t.ModuleDeclaration>,
	names: Set<string>,
	includeVar: boolean,
): void {
	for (const statement of statements) {
		const declaration = declarationFromStatement(statement)
		if (!declaration) continue
		if (declaration.type === 'VariableDeclaration') {
			if (!includeVar && declaration.kind === 'var') continue
			for (const declarator of declaration.declarations) addPatternNames(declarator.id, names)
		} else if (
			(declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration')
			&& declaration.id
		) {
			names.add(declaration.id.name)
		}
	}
}

function addVarNames(node: t.Node, names: Set<string>, root = true): void {
	if (!root && FUNCTION_NODE_TYPES.has(node.type)) return
	if (node.type === 'VariableDeclaration' && node.kind === 'var') {
		for (const declarator of node.declarations) addPatternNames(declarator.id, names)
	}
	for (const child of childNodes(node)) addVarNames(child, names, false)
}

function functionScopeNames(node: t.Node): Set<string> | null {
	const names = new Set<string>()
	switch (node.type) {
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
		case 'FunctionDeclaration':
		case 'ObjectMethod':
		case 'ClassMethod':
		case 'ClassPrivateMethod':
			for (const parameter of node.params) addPatternNames(parameter, names)
			if ((node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') && node.id) {
				names.add(node.id.name)
			}
			addVarNames(node.body, names)
			return names
		default:
			return null
	}
}

function withNames(base: ReadonlySet<string>, additions: ReadonlySet<string>): ReadonlySet<string> {
	if (additions.size === 0) return base
	return new Set([...base, ...additions])
}

function topLevelShadowedNames(ast: t.File, importedLocals: ReadonlySet<string>): Set<string> {
	const declared = new Set<string>()
	addDirectLexicalNames(ast.program.body, declared, true)
	addVarNames(ast.program, declared)
	for (const imported of importedLocals) declared.delete(imported)
	return declared
}

function exportedName(specifier: t.ExportSpecifier): string {
	return specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value
}

function unwrapExpression(node: t.Node): t.Node {
	let current = node
	while (
		current.type === 'AwaitExpression'
		|| current.type === 'TSAsExpression'
		|| current.type === 'TSTypeAssertion'
		|| current.type === 'TSNonNullExpression'
		|| current.type === 'ParenthesizedExpression'
		|| current.type === 'TypeCastExpression'
	) {
		current = current.type === 'AwaitExpression' ? current.argument : current.expression
	}
	return current
}

function topLevelValueNodes(ast: t.File): Map<string, t.Node> {
	const values = new Map<string, t.Node>()
	for (const statement of ast.program.body) {
		const declaration = declarationFromStatement(statement)
		if (!declaration) continue
		if (declaration.type === 'FunctionDeclaration' && declaration.id) {
			values.set(declaration.id.name, declaration)
		} else if (declaration.type === 'VariableDeclaration') {
			for (const declarator of declaration.declarations) {
				if (declarator.id.type === 'Identifier' && declarator.init) {
					values.set(declarator.id.name, unwrapExpression(declarator.init))
				}
			}
		}
	}
	return values
}

function exportedGetStaticPathsNodes(ast: t.File): Set<t.Node> {
	const exportedLocals = new Set<string>()
	for (const statement of ast.program.body) {
		if (statement.type !== 'ExportNamedDeclaration') continue
		const declaration = statement.declaration
		if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === 'getStaticPaths') {
			exportedLocals.add('getStaticPaths')
		} else if (declaration?.type === 'VariableDeclaration') {
			for (const declarator of declaration.declarations) {
				if (declarator.id.type === 'Identifier' && declarator.id.name === 'getStaticPaths') {
					exportedLocals.add('getStaticPaths')
				}
			}
		}
		if (statement.source) continue
		for (const specifier of statement.specifiers) {
			if (specifier.type === 'ExportSpecifier' && exportedName(specifier) === 'getStaticPaths') {
				exportedLocals.add(specifier.local.name)
			}
		}
	}

	const values = topLevelValueNodes(ast)
	const nodes = new Set<t.Node>()
	for (const local of exportedLocals) {
		const node = values.get(local)
		if (node && FUNCTION_NODE_TYPES.has(node.type)) nodes.add(node)
	}
	return nodes
}

function staticString(node: t.Node | null | undefined): string | null {
	if (!node) return null
	const value = unwrapExpression(node)
	if (value.type === 'StringLiteral') return value.value
	if (value.type === 'TemplateLiteral' && value.expressions.length === 0 && value.quasis.length === 1) {
		return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? null
	}
	return null
}

function memberPropertyName(node: t.MemberExpression | t.OptionalMemberExpression): string | null {
	if (!node.computed && node.property.type === 'Identifier') return node.property.name
	if (node.computed && node.property.type === 'StringLiteral') return node.property.value
	return null
}

function callAccessor(
	node: t.CallExpression | t.OptionalCallExpression,
	named: ReadonlyMap<string, AstroContentAccessor>,
	namespaces: ReadonlySet<string>,
	shadowed: ReadonlySet<string>,
): AstroContentAccessor | null {
	const callee = unwrapExpression(node.callee)
	if (callee.type === 'Identifier') {
		if (shadowed.has(callee.name)) return null
		return named.get(callee.name) ?? null
	}
	if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null
	const object = unwrapExpression(callee.object)
	if (object.type !== 'Identifier' || shadowed.has(object.name) || !namespaces.has(object.name)) return null
	const property = memberPropertyName(callee)
	if (!property || !isContentAccessor(property)) return null
	return property
}

function collectionNameFromCall(node: t.CallExpression | t.OptionalCallExpression): string | null {
	const first = node.arguments[0]
	return first && first.type !== 'SpreadElement' && first.type !== 'ArgumentPlaceholder'
		? staticString(first)
		: null
}

function collectCalls(
	ast: t.File,
	named: ReadonlyMap<string, AstroContentAccessor>,
	namespaces: ReadonlySet<string>,
): AstroContentCall[] {
	const calls: AstroContentCall[] = []
	const staticPathsNodes = exportedGetStaticPathsNodes(ast)
	const importedLocals = new Set([...named.keys(), ...namespaces])
	const rootShadowed = topLevelShadowedNames(ast, importedLocals)

	function visit(node: t.Node, context: AnalyzerContext): void {
		let shadowed = context.shadowed
		const functionNames = functionScopeNames(node)
		if (functionNames) shadowed = withNames(shadowed, functionNames)
		if (node.type === 'BlockStatement') {
			const blockNames = new Set<string>()
			addDirectLexicalNames(node.body, blockNames, false)
			shadowed = withNames(shadowed, blockNames)
		} else if (node.type === 'CatchClause') {
			const catchNames = new Set<string>()
			addPatternNames(node.param, catchNames)
			shadowed = withNames(shadowed, catchNames)
		}

		const insideExportedGetStaticPaths = context.insideExportedGetStaticPaths || staticPathsNodes.has(node)
		if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
			const accessor = callAccessor(node, named, namespaces, shadowed)
			if (accessor) {
				calls.push({
					accessor,
					collectionName: collectionNameFromCall(node),
					inExportedGetStaticPaths: insideExportedGetStaticPaths,
				})
			}
		}

		const childContext = { insideExportedGetStaticPaths, shadowed }
		for (const child of childNodes(node)) visit(child, childContext)
	}

	const context: AnalyzerContext = { insideExportedGetStaticPaths: false, shadowed: rootShadowed }
	for (const statement of ast.program.body) visit(statement, context)
	return calls
}

function expressionAccessor(node: t.Node): { base: string; path: string } | null {
	const value = unwrapExpression(node)
	if (value.type === 'Identifier') return { base: value.name, path: '' }
	if (value.type !== 'MemberExpression' && value.type !== 'OptionalMemberExpression') return null
	const object = expressionAccessor(value.object)
	if (!object) return null
	if (!value.computed && value.property.type === 'Identifier') {
		return { base: object.base, path: `${object.path}.${value.property.name}` }
	}
	if (value.computed && value.property.type === 'NumericLiteral') {
		return { base: object.base, path: `${object.path}[${value.property.value}]` }
	}
	return null
}

function returnedExpression(callback: t.ArrowFunctionExpression | t.FunctionExpression): t.Node | null {
	if (callback.body.type !== 'BlockStatement') return callback.body
	for (const statement of callback.body.body) {
		if (statement.type === 'ReturnStatement' && statement.argument) return statement.argument
	}
	return null
}

function mapBinding(
	node: t.Node,
	bindings: ReadonlyMap<string, CollectionBinding>,
): CollectionBinding | null {
	const value = unwrapExpression(node)
	if (value.type !== 'CallExpression' && value.type !== 'OptionalCallExpression') return null
	const callee = unwrapExpression(value.callee)
	if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null
	if (memberPropertyName(callee) !== 'map') return null
	const source = expressionAccessor(callee.object)
	if (!source || source.path !== '') return null
	const sourceBinding = bindings.get(source.base)
	if (!sourceBinding || sourceBinding.shape !== 'array') return null

	const callback = value.arguments[0]
	if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')) return null
	const parameter = callback.params[0]
	if (!parameter || parameter.type !== 'Identifier') return null
	const returned = returnedExpression(callback)
	if (!returned) return null
	const projection = expressionAccessor(returned)
	if (!projection || projection.base !== parameter.name) return null

	return { ...sourceBinding, itemPath: sourceBinding.itemPath + projection.path }
}

function directCallBinding(
	node: t.Node,
	named: ReadonlyMap<string, AstroContentAccessor>,
	namespaces: ReadonlySet<string>,
	shadowed: ReadonlySet<string>,
): CollectionBinding | null {
	const value = unwrapExpression(node)
	if (value.type !== 'CallExpression' && value.type !== 'OptionalCallExpression') return null
	const matched = callAccessor(value, named, namespaces, shadowed)
	const collectionName = collectionNameFromCall(value)
	if (!matched || matched === 'getEntries' || !collectionName) return null
	return {
		collectionName,
		shape: matched === 'getCollection' ? 'array' : 'entry',
		itemPath: '',
	}
}

function topLevelVariableDeclarations(ast: t.File): t.VariableDeclaration[] {
	const declarations: t.VariableDeclaration[] = []
	for (const statement of ast.program.body) {
		if (statement.type === 'VariableDeclaration') declarations.push(statement)
		else if (statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration') {
			declarations.push(statement.declaration)
		}
	}
	return declarations
}

function collectBindings(
	ast: t.File,
	named: ReadonlyMap<string, AstroContentAccessor>,
	namespaces: ReadonlySet<string>,
): AstroCollectionBinding[] {
	const facts: AstroCollectionBinding[] = []
	const bindings = new Map<string, CollectionBinding>()
	const importedLocals = new Set([...named.keys(), ...namespaces])
	const shadowed = topLevelShadowedNames(ast, importedLocals)

	for (const declaration of topLevelVariableDeclarations(ast)) {
		for (const declarator of declaration.declarations) {
			if (declarator.id.type !== 'Identifier' || !declarator.init) continue
			const name = declarator.id.name
			const direct = directCallBinding(declarator.init, named, namespaces, shadowed)
			const alias = expressionAccessor(declarator.init)
			const aliased = alias?.path === '' ? bindings.get(alias.base) : undefined
			const mapped = mapBinding(declarator.init, bindings)
			const base = direct ?? mapped ?? aliased
			if (!base) continue

			bindings.set(name, base)
			facts.push({ localName: name, collectionName: base.collectionName, itemPath: base.itemPath })
		}
	}
	return facts
}

function analyzeAstroContentAst(ast: t.File): AstroSourceAnalysis {
	const imports = importFacts(ast)
	const { named, namespaces } = contentImportBindings(ast)
	return {
		imports,
		collectionCalls: collectCalls(ast, named, namespaces),
		collectionBindings: collectBindings(ast, named, namespaces),
	}
}

/** Analyze JavaScript or TypeScript source containing Astro content accessors. */
export function analyzeAstroScript(source: string): AstroSourceAnalysis {
	const ast = parseScript(source)
	return ast ? analyzeAstroContentAst(ast) : { imports: [], collectionCalls: [], collectionBindings: [] }
}

/** Analyze the frontmatter of a complete `.astro` source string. */
export function analyzeAstroSource(source: string): AstroSourceAnalysis {
	const frontmatter = extractAstroFrontmatter(source)
	return frontmatter === null
		? { imports: [], collectionCalls: [], collectionBindings: [] }
		: analyzeAstroScript(frontmatter)
}
