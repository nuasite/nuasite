import type { AstroIntegration } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CheckRunner } from './check-runner'
import { resolveChecksOptions } from './config'
import { analyzeHtml } from './html-analyzer'
import { registerAllChecks } from './register'
import { logReport } from './report'
import type { Check, CheckResult, ChecksOptions, ExtractedPageData } from './types'

/**
 * Try to read an HTML file for a given page pathname in the dist directory.
 * Returns the file content and path, or undefined if not found.
 */
async function readPageHtml(distDir: string, pathname: string): Promise<{ html: string; filePath: string } | undefined> {
	const candidates = [
		path.join(distDir, pathname, 'index.html'),
		path.join(distDir, `${pathname.replace(/\/$/, '')}.html`),
	]
	for (const candidate of candidates) {
		try {
			const html = await fs.readFile(candidate, 'utf8')
			return { html, filePath: candidate }
		} catch {
			// Not found, try next
		}
	}
	return undefined
}

export const checks = (options: ChecksOptions = {}): AstroIntegration => {
	const resolved = resolveChecksOptions(options)
	const isCI = !!process.env.CI
	let siteUrl: string | undefined

	return {
		name: '@nuasite/checks',
		hooks: {
			'astro:config:done': ({ config }) => {
				siteUrl = config.site
			},
			'astro:build:done': async ({ dir, pages, logger }) => {
				const distDir = fileURLToPath(dir)
				const runner = new CheckRunner(resolved, isCI)

				// Register all built-in checks based on config
				registerAllChecks(runner, resolved)

				// Register custom checks
				for (const check of resolved.customChecks) {
					if (check.kind === 'site') {
						runner.registerSiteCheck(check)
					} else {
						runner.registerCheck(check)
					}
				}

				const allResults: CheckResult[] = []
				const pagesData = new Map<string, ExtractedPageData>()

				// Run per-page checks
				for (const page of pages) {
					const pagePath = `/${page.pathname}`.replace(/\/+/g, '/')
					const result = await readPageHtml(distDir, page.pathname)
					if (!result) {
						logger.warn(`Skipping ${page.pathname}; no HTML output found.`)
						continue
					}

					const { root, pageData } = analyzeHtml(result.html)
					pagesData.set(pagePath, pageData)

					allResults.push(...runner.runPageChecks({
						pagePath,
						filePath: result.filePath,
						html: result.html,
						root,
						pageData,
					}))
				}

				// Run site-level checks
				allResults.push(...runner.runSiteChecks({
					distDir,
					pages: pagesData,
					siteUrl,
				}))

				// Generate and log report
				const report = runner.generateReport(allResults, pagesData.size)
				logReport(report, logger)

				// Fail build if configured
				if (resolved.failOnError && report.errors.length > 0) {
					throw new Error(
						`@nuasite/checks: ${report.errors.length} error(s) found. Set failOnError: false to continue.`,
					)
				}
				if (resolved.failOnWarning && (report.errors.length > 0 || report.warnings.length > 0)) {
					throw new Error(
						`@nuasite/checks: ${report.errors.length} error(s) and ${report.warnings.length} warning(s) found.`,
					)
				}
			},
		},
	}
}
