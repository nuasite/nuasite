/**
 * Marks a remark/rehype plugin as importable by a host that cannot take the plugin function
 * itself across a process boundary. A host that renders Markdown elsewhere than where the
 * Astro config ran (an isolate in a Worker, for example) reads this reference, imports
 * `module` there and applies its `export` with the options from the config's
 * `[plugin, options]` tuple, which therefore have to be JSON.
 *
 * The key and the value's shape are a contract shared with such hosts: keep them as they are.
 */
export const PORTABLE_MODULE_KEY = Symbol.for('pletivo.portableModule')

export interface PortableModuleReference {
	/** Bare specifier the project can import, e.g. `@nuasite/cms/remark`. */
	readonly module: string
	/** Named export of that module that is this same plugin function. */
	readonly export: string
}

export function withPortableModule<Plugin extends object>(plugin: Plugin, reference: PortableModuleReference): Plugin {
	Object.defineProperty(plugin, PORTABLE_MODULE_KEY, { value: Object.freeze({ ...reference }), enumerable: false })
	return plugin
}
