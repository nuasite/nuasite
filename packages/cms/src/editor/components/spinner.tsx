import { cn } from '../lib/cn.ts'

const sizes = {
	xs: 'h-3 w-3',
	sm: 'h-3.5 w-3.5',
	md: 'h-4 w-4',
	lg: 'h-6 w-6',
	xl: 'h-8 w-8',
} as const

export function Spinner({ size = 'md', className }: { size?: keyof typeof sizes; className?: string }) {
	return (
		<span
			class={cn('inline-block animate-spin rounded-full border-2 border-current/30 border-t-current', sizes[size], className)}
		/>
	)
}
