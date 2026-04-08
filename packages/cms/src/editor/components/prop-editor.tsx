import { openMediaLibraryWithCallback } from '../signals'
import type { ComponentProp } from '../types'

export interface PropEditorProps {
	prop: ComponentProp
	value: string
	onChange: (value: string) => void
}

/**
 * Parse a union of string literals like `'left' | 'right' | 'center'` into an array of options.
 * Returns null if the type is not a pure string-literal union.
 */
function parseStringLiteralUnion(type: string): string[] | null {
	const parts = type.split('|').map(s => s.trim())
	const values: string[] = []
	for (const part of parts) {
		const match = part.match(/^['"](.+)['"]$/)
		if (!match) return null
		values.push(match[1])
	}
	return values.length > 0 ? values : null
}

export function PropEditor({ prop, value, onChange }: PropEditorProps) {
	const typeLower = prop.type.toLowerCase()
	const isBoolean = typeLower === 'boolean'
	const isNumber = typeLower === 'number'
	const isImage = typeLower === 'image'
	const isUrl = typeLower === 'url'
	const isColor = typeLower === 'color'
	const isDate = typeLower === 'date'
	const isDateTime = typeLower === 'datetime'
	const isTime = typeLower === 'time'
	const isEmail = typeLower === 'email'
	const isTextarea = typeLower === 'textarea'
	const unionOptions = parseStringLiteralUnion(prop.type)

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
				: unionOptions
					? (
						<select
							value={value}
							onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
							class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
						>
							{!prop.required && <option value="">— None —</option>}
							{unionOptions.map((opt) => (
								<option key={opt} value={opt}>{opt}</option>
							))}
						</select>
					)
					: isImage
						? (
							<div class="flex gap-2">
								<input
									type="text"
									value={value}
									onInput={(e) => onChange((e.target as HTMLInputElement).value)}
									placeholder={prop.defaultValue || 'Select an image...'}
									class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
								/>
								<button
									type="button"
									onClick={() => {
										openMediaLibraryWithCallback((url: string) => {
											onChange(url)
										})
									}}
									class="px-3 py-2.5 bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/15 rounded-cms-md transition-colors shrink-0"
									title="Browse media"
								>
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
									</svg>
								</button>
							</div>
						)
						: isColor
							? (
								<div class="flex gap-2 items-center">
									<input
										type="color"
										value={value || '#000000'}
										onInput={(e) => onChange((e.target as HTMLInputElement).value)}
										class="w-10 h-10 rounded-cms-md border border-white/20 bg-transparent cursor-pointer"
									/>
									<input
										type="text"
										value={value}
										onInput={(e) => onChange((e.target as HTMLInputElement).value)}
										placeholder={prop.defaultValue || '#000000'}
										class="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md font-mono"
									/>
								</div>
							)
							: isTextarea
								? (
									<textarea
										value={value}
										onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
										placeholder={prop.defaultValue || `Enter ${prop.name}...`}
										rows={3}
										class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md resize-y"
									/>
								)
								: (
									<input
										type={isNumber ? 'number' : isUrl ? 'url' : isDate ? 'date' : isDateTime ? 'datetime-local' : isTime ? 'time' : isEmail ? 'email' : 'text'}
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
