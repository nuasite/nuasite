import type { ComponentDefinition } from '../types'

export function getDefaultProps(definition: ComponentDefinition): Record<string, any> {
	const defaultProps: Record<string, any> = {}
	for (const prop of definition.props) {
		if (prop.defaultValue !== undefined) {
			defaultProps[prop.name] = prop.defaultValue
		} else if (prop.required) {
			defaultProps[prop.name] = ''
		}
	}
	return defaultProps
}

export function ComponentCard({ def, onClick }: { def: ComponentDefinition; onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			class="p-4 bg-white/5 border border-white/10 rounded-cms-md cursor-pointer text-left transition-all hover:border-cms-primary/50 hover:bg-white/10 group"
		>
			{def.previewUrl && (
				<div class="mb-3 rounded overflow-hidden bg-white h-30 relative">
					<ComponentPreviewIframe previewUrl={def.previewUrl} previewWidth={def.previewWidth} />
				</div>
			)}
			<div class="font-medium text-white">{def.name}</div>
			{def.description && <div class="text-xs text-white/50 mt-1">{def.description}</div>}
			<div class="text-[11px] text-white/40 mt-2 font-mono">
				{def.props.length} props
				{def.slots && def.slots.length > 0 && ` · ${def.slots.length} slots`}
			</div>
		</button>
	)
}

function ComponentPreviewIframe({ previewUrl, previewWidth }: { previewUrl: string; previewWidth?: number }) {
	const pw = previewWidth ?? 1280
	const scale = 320 / pw
	return (
		<iframe
			src={previewUrl}
			class="border-none pointer-events-none"
			style={{ width: `${pw}px`, height: `${Math.round(120 / scale)}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}
			sandbox="allow-same-origin"
			loading="lazy"
			tabIndex={-1}
		/>
	)
}
