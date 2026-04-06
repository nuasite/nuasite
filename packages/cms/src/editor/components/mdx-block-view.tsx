import { MDX_EXPR_PREFIX } from '../milkdown-mdx-plugin'

const MDX_COMPONENT_ICON_PATH =
	'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5'

export function MdxComponentIcon({ size = 'sm' }: { size?: 'sm' | 'md' }) {
	const iconClass = size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
	const svg = (
		<svg class={`${iconClass} text-cms-primary`} fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d={MDX_COMPONENT_ICON_PATH} />
		</svg>
	)
	if (size === 'md') return svg
	return (
		<div class="w-5 h-5 rounded bg-cms-primary/20 flex items-center justify-center">
			{svg}
		</div>
	)
}

export interface MdxBlockCardProps {
	componentName: string
	props: Record<string, string>
	hasExpressions: boolean
	onEdit: (cursorPos: { x: number; y: number }) => void
	onRemove: () => void
}

export function MdxBlockCard({ componentName, props, hasExpressions, onEdit, onRemove }: MdxBlockCardProps) {
	const propEntries = Object.entries(props).filter(([_, v]) => v !== '')
	const displayProps = propEntries.map(([name, value]) => {
		if (value.startsWith(MDX_EXPR_PREFIX)) {
			return { name, value: value.slice(MDX_EXPR_PREFIX.length), isExpression: true }
		}
		return { name, value, isExpression: false }
	})

	return (
		<div
			class="my-3 mx-0 bg-white/5 border border-white/15 rounded-cms-md overflow-hidden select-none"
			data-cms-ui
		>
			<div class="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/10">
				<div class="flex items-center gap-2">
					<MdxComponentIcon />
					<span class="text-[13px] font-semibold text-white">{componentName}</span>
					{hasExpressions && <span class="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-mono">expr</span>}
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						data-mdx-action="edit"
						onClick={(e: MouseEvent) => {
							const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
							onEdit({ x: rect.left, y: rect.bottom + 4 })
						}}
						class="p-1.5 rounded-cms-sm text-white/50 hover:text-white hover:bg-white/10 transition-colors"
						title="Edit props"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
					</button>
					<button
						type="button"
						data-mdx-action="remove"
						onClick={onRemove}
						class="p-1.5 rounded-cms-sm text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
						title="Remove block"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</button>
				</div>
			</div>

			{displayProps.length > 0 && (
				<div class="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1">
					{displayProps.slice(0, 6).map(({ name, value, isExpression }) => (
						<span key={name} class="text-[11px] text-white/40 font-mono">
							<span class="text-white/60">{name}</span>
							<span class="text-white/30">=</span>
							{isExpression
								? <span class="text-amber-300/60">{`{${value.length > 20 ? value.slice(0, 20) + '...' : value}}`}</span>
								: <span class="text-cms-primary/60">"{value.length > 25 ? value.slice(0, 25) + '...' : value}"</span>}
						</span>
					))}
					{displayProps.length > 6 && <span class="text-[11px] text-white/30">+{displayProps.length - 6} more</span>}
				</div>
			)}
		</div>
	)
}
