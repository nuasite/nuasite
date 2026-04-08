/** @jsxImportSource preact */

interface StaleWarningProps {
	reason?: string
}

/**
 * Small badge shown on suggestion cards whose anchor text no longer
 * appears inside the target element. Phase 5 will add a "re-attach" CTA;
 * for v0.1 we just surface the situation so the agency can act on it.
 */
export function StaleWarning({ reason }: StaleWarningProps) {
	return (
		<div class='notes-stale' title={reason}>
			<span class='notes-stale__icon'>⚠</span>
			<span>Anchor text not found on this page</span>
		</div>
	)
}
