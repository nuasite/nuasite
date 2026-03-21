import type { AstroIntegration } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CheckRunner } from './check-runner'
import { resolveChecksOptions } from './config'
import { analyzeHtml } from './html-analyzer'
import { registerAllChecks } from './register'
import { logReport, writeJsonReport } from './report'
import type { CheckResult, ChecksOptions, ExtractedPageData } from './types'

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
	let projectRoot: string | undefined

	return {
		name: '@nuasite/checks',
		hooks: {
			'astro:config:done': ({ config }) => {
				siteUrl = config.site
				projectRoot = fileURLToPath(config.root)
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

				// Run per-page checks in parallel
				const pageResults = await Promise.all(
					pages.map(async (page) => {
						const pagePath = `/${page.pathname}`.replace(/\/+/g, '/')
						const result = await readPageHtml(distDir, page.pathname)
						if (!result) {
							logger.warn(`Skipping ${page.pathname}; no HTML output found.`)
							return null
						}

						const { root, pageData } = analyzeHtml(result.html)
						const results = await runner.runPageChecks({
							pagePath,
							filePath: result.filePath,
							distDir,
							html: result.html,
							root,
							pageData,
						})
						return { pagePath, pageData, results }
					}),
				)

				for (const entry of pageResults) {
					if (!entry) continue
					pagesData.set(entry.pagePath, entry.pageData)
					allResults.push(...entry.results)
				}

				// Run site-level checks
				const siteResults = await runner.runSiteChecks({
					distDir,
					projectRoot: projectRoot ?? process.cwd(),
					pages: pagesData,
					siteUrl,
				})
				allResults.push(...siteResults)

				// Generate and log report
				const report = runner.generateReport(allResults, pagesData.size)
				logReport(report, logger)

				// Write JSON report if configured
				if (resolved.reportJson) {
					const reportPath = await writeJsonReport(report, distDir, resolved.reportJson)
					logger.info(`JSON report written to ${reportPath}`)
				}

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
