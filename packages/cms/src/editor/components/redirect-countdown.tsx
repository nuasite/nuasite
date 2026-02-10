import { redirectCountdown, stopRedirectCountdown } from '../signals'

export function RedirectCountdown() {
	const state = redirectCountdown.value
	if (!state) return null

	const stopPropagation = (e: Event) => e.stopPropagation()

	return (
		<div
			class="fixed bottom-6 left-1/2 -translate-x-1/2 z-2147483647 flex items-center gap-3 px-5 py-3 bg-cms-dark/95 border border-white/15 rounded-cms-pill shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md"
			data-cms-ui
			onMouseDown={stopPropagation}
			onClick={stopPropagation}
		>
			<div class="flex items-center gap-2 text-white/90 text-sm font-medium">
				<svg
					class="w-4 h-4 text-cms-primary"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13 7l5 5m0 0l-5 5m5-5H6"
					/>
				</svg>
				<span>
					Redirecting to <strong class="text-white">{state.label}</strong> in {state.secondsLeft}s
				</span>
			</div>
			<div class="w-px h-5 bg-white/20" />
			<button
				type="button"
				onClick={stopRedirectCountdown}
				class="px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-cms-pill transition-colors"
				data-cms-ui
			>
				Cancel
			</button>
		</div>
	)
}
