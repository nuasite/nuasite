import type { ComponentProp } from '../types'

export interface PropEditorProps {
	prop: ComponentProp
	value: string
	onChange: (value: string) => void
}

export function PropEditor({ prop, value, onChange }: PropEditorProps) {
	const isBoolean = prop.type === 'boolean'
	const isNumber = prop.type === 'number'

	return (
		<div class="mb-4">
			<label class="block text-[13px] font-medium text-white mb-1.5">
				{prop.name}
				{prop.required && <span class="text-cms-error ml-1">*</span>}
			</label>
			{prop.description && (
				<div class="text-[11px] text-white/50 mb-1.5">
					{prop.description}
				</div>
			)}
			{isBoolean
				? (
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={value === 'true'}
							onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
							class="accent-cms-primary w-5 h-5 rounded"
						/>
						<span class="text-[13px] text-white">
							{value === 'true' ? 'Enabled' : 'Disabled'}
						</span>
					</label>
				)
				: (
					<input
						type={isNumber ? 'number' : 'text'}
						value={value}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						placeholder={prop.defaultValue || `Enter ${prop.name}...`}
						class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
					/>
				)}
			<div class="text-[10px] text-white/40 mt-1.5 font-mono">
				{prop.type}
			</div>
		</div>
	)
}
