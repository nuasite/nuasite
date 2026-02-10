import { Component, type ComponentChildren } from 'preact'

interface ErrorBoundaryProps {
	children: ComponentChildren
	fallback?: ComponentChildren
	onError?: (error: Error, errorInfo: { componentStack: string }) => void
	componentName?: string
}

interface ErrorBoundaryState {
	hasError: boolean
	error: Error | null
}

/**
 * Error boundary component to catch and handle errors in CMS UI components.
 * Prevents the entire CMS overlay from crashing when a component fails.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static override getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error }
	}

	override componentDidCatch(error: Error, errorInfo: { componentStack: string }): void {
		console.error('[CMS] Component error:', error)
		console.error('[CMS] Component stack:', errorInfo.componentStack)
		this.props.onError?.(error, errorInfo)
	}

	private handleRetry = (): void => {
		this.setState({ hasError: false, error: null })
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback
			}

			const componentName = this.props.componentName || 'Component'

			return (
				<div
					data-cms-ui
					class="p-4 bg-red-50 border-2 border-red-500 text-red-800 font-sans text-sm"
					style={{
						fontFamily: 'system-ui, -apple-system, sans-serif',
					}}
				>
					<div class="font-bold mb-2 flex items-center gap-2">
						<span class="text-red-600">⚠</span>
						{componentName} Error
					</div>
					<div class="text-xs text-red-600 mb-3 font-mono">
						{this.state.error?.message || 'An unexpected error occurred'}
					</div>
					<button
						onClick={this.handleRetry}
						class="px-3 py-1.5 bg-red-600 text-white border-2 border-red-800 text-xs font-bold cursor-pointer hover:bg-red-700 transition-colors"
					>
						Retry
					</button>
				</div>
			)
		}

		return this.props.children
	}
}

export const SilentErrorFallback = () => null

export const CompactErrorFallback = ({ message }: { message?: string }) => {
	return (
		<div
			data-cms-ui
			class="px-2 py-1 bg-red-100 text-red-700 text-xs font-sans border border-red-300 inline-block"
		>
			⚠ {message || 'Error'}
		</div>
	)
}
