/**
 * CMS run mode — `local` vs `hosted` (cms-headless F7).
 *
 * The marker plugin behaves differently by host:
 *
 * - **`local`** (default for `pletivo dev` on a developer machine): the plugin
 *   lazily spawns an in-process cms-sidecar over the project's `node:fs` and
 *   serves the `@nuasite/collections-admin` SPA at `/_nua/admin`. The inline
 *   widget runs in-page as usual.
 * - **`hosted`** (inside the agent sandbox): the sidecar is a managed sandbox
 *   service (cms-headless F2) and the collections admin is a webmaster tab (F3),
 *   so the plugin must NOT spawn a sidecar and must NOT serve `/_nua/admin`. It
 *   stays a pure marker + CDN-inject plugin (F5).
 *
 * Detection is automatic and zero-config for local dev: the agent runtime sets a
 * sandbox environment variable that the `pletivo dev` process inherits, which
 * flips the mode to `hosted`. An explicit `mode` in the plugin config always
 * wins over auto-detection.
 */

export type CmsMode = 'local' | 'hosted'

/**
 * Environment signals that mean "this `pletivo dev` runs inside the managed
 * agent sandbox" (⇒ `hosted`):
 *
 * - `SANDBOX_ID` — set by the webmaster sandbox deployer when it starts the agent
 *   process (the Contember project id); every service the agent spawns, including
 *   `pletivo dev`, inherits it. It is never set on a developer machine. This is
 *   the canonical "we are in the sandbox" marker used across the agent runtime.
 * - `CMS_SIDECAR_LOCAL_EDVABE` — set (to `'1'`) by the deployer for the local
 *   edvabe sandbox variant; the managed sidecar bundle is bind-mounted there.
 *   Also implies a managed sidecar, hence `hosted`.
 */
const HOSTED_ENV_KEYS: readonly string[] = ['SANDBOX_ID', 'CMS_SIDECAR_LOCAL_EDVABE']

/** Whether any hosted-sandbox env signal is present (and non-empty). */
export function detectHostedFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	return HOSTED_ENV_KEYS.some((key) => {
		const value = env[key]
		return typeof value === 'string' && value.trim() !== ''
	})
}

/**
 * Resolve the effective CMS mode. An explicit `override` (from the plugin config)
 * always wins; otherwise the mode is auto-detected from the environment, defaulting
 * to `local` when no sandbox signal is present.
 */
export function resolveCmsMode(override?: CmsMode, env: NodeJS.ProcessEnv = process.env): CmsMode {
	if (override !== undefined) return override
	return detectHostedFromEnv(env) ? 'hosted' : 'local'
}
