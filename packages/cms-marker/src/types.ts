export interface CmsMarkerOptions {
	attributeName?: string
	includeTags?: string[] | null
	excludeTags?: string[]
	includeEmptyText?: boolean
	generateManifest?: boolean
	manifestFile?: string
	markComponents?: boolean
	componentDirs?: string[]
}

export interface ComponentProp {
	name: string
	type: string
	required: boolean
	defaultValue?: string
	description?: string
}

export interface ComponentDefinition {
	name: string
	file: string
	props: ComponentProp[]
	description?: string
	slots?: string[]
}

export interface ManifestEntry {
	id: string
	file: string
	tag: string
	text: string
	sourcePath?: string
	sourceLine?: number
	sourceSnippet?: string
	sourceType?: 'static' | 'variable' | 'prop' | 'computed'
	variableName?: string
	childCmsIds?: string[]
	parentComponentId?: string
}

export interface ComponentInstance {
	id: string
	componentName: string
	file: string
	sourcePath: string
	sourceLine: number
	props: Record<string, any>
	slots?: Record<string, string>
	parentId?: string
}

export interface CmsManifest {
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	componentDefinitions: Record<string, ComponentDefinition>
}
