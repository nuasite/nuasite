export { default } from './integration.ts'
export { default as astroFragments } from './integration.ts'
export type { AstroFragmentsOptions } from './integration.ts'
export type { FragmentManifest, FragmentManifestEntry } from './manifest.ts'

// Programmatic API for hosts that implement their own incremental layer
// (e.g. pletivo replaying cached fragment registrations when a page render
// is skipped). Stock Astro users normally don't need to touch this.
export {
	type AstroComponentFactory,
	computeFragmentHash,
	disableRegistry,
	enableRegistry,
	type FragmentEntry,
	FragmentPropsError,
	FragmentRegistrationError,
	getFragments,
	getProjectRoot,
	isRegistryEnabled,
	registerFragment,
	type RegisterParams,
	type RenderPassResult,
	runInRenderPass,
	validateProps,
} from './registry.ts'
