/**
 * `@nuasite/cms-studio` — the standalone Nua CMS app.
 *
 * Run it with `bunx @nuasite/cms-studio --root <project>` to get the cms-sidecar
 * `/cms/v1` API and the collections admin UI on one origin. The programmatic
 * `createStudioServer` is exported for embedding/testing; the CLI (`src/cli.ts`,
 * the package `bin`) wires the in-process sidecar and starts `Bun.serve`.
 */
export { createStudioServer, type StudioServer, type StudioServerOptions } from './server'
