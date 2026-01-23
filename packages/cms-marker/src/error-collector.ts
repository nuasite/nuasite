/**
 * Collects errors during processing for aggregated reporting.
 * This allows the build to continue while tracking what failed.
 */
export class ErrorCollector {
	private errors: Array<{ context: string; error: Error }> = []
	private warnings: Array<{ context: string; message: string }> = []

	/**
	 * Record an error with context about where it occurred.
	 */
	addError(context: string, error: Error): void {
		this.errors.push({ context, error })
	}

	/**
	 * Record a warning (non-fatal issue).
	 */
	addWarning(context: string, message: string): void {
		this.warnings.push({ context, message })
	}

	/**
	 * Check if any errors were recorded.
	 */
	hasErrors(): boolean {
		return this.errors.length > 0
	}

	/**
	 * Check if any warnings were recorded.
	 */
	hasWarnings(): boolean {
		return this.warnings.length > 0
	}

	/**
	 * Get all recorded errors.
	 */
	getErrors(): ReadonlyArray<{ context: string; error: Error }> {
		return this.errors
	}

	/**
	 * Get all recorded warnings.
	 */
	getWarnings(): ReadonlyArray<{ context: string; message: string }> {
		return this.warnings
	}

	/**
	 * Get a summary of all errors and warnings.
	 */
	getSummary(): string {
		const lines: string[] = []

		if (this.errors.length > 0) {
			lines.push(`${this.errors.length} error(s):`)
			for (const { context, error } of this.errors) {
				lines.push(`  - ${context}: ${error.message}`)
			}
		}

		if (this.warnings.length > 0) {
			lines.push(`${this.warnings.length} warning(s):`)
			for (const { context, message } of this.warnings) {
				lines.push(`  - ${context}: ${message}`)
			}
		}

		return lines.join('\n')
	}

	/**
	 * Clear all recorded errors and warnings.
	 */
	clear(): void {
		this.errors = []
		this.warnings = []
	}
}

/** Singleton error collector for the build process */
let globalErrorCollector: ErrorCollector | null = null

/**
 * Get the global error collector instance.
 * Creates one if it doesn't exist.
 */
export function getErrorCollector(): ErrorCollector {
	if (!globalErrorCollector) {
		globalErrorCollector = new ErrorCollector()
	}
	return globalErrorCollector
}

/**
 * Reset the global error collector (call at start of each build).
 */
export function resetErrorCollector(): void {
	if (globalErrorCollector) {
		globalErrorCollector.clear()
	} else {
		globalErrorCollector = new ErrorCollector()
	}
}
