import { parse } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ComponentDefinition, ComponentInstance, ManifestEntry } from './types'
import type { CollectionEntry, PageSeoData } from './types'

type PageData = {
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	collection?: CollectionEntry
	seo?: PageSeoData
}

/**
 * Check if an image element's src or srcset contains the given URL.
 * Handles CDN-transformed URLs by comparing path suffixes.
 */
function imageMatchesSrc(el: ReturnType<typeof parse>, srcValue: string): boolean {
	// Check src attribute
	const src = el.getAttribute('src')
	if (src === srcValue) return true

	// Check if src or srcset URLs contain the original path
	// (handles CDN transformations like /cdn-cgi/image/.../original-path)
	let srcPath: string
	try {
		srcPath = new URL(srcValue).pathname
	} catch {
		srcPath = srcValue.split('?')[0] ?? srcValue
	}
	if (srcPath.length <= 5) return false

	if (src) {
		let elPath: string
		try {
			elPath = new URL(src).pathname
		} catch {
			elPath = src.split('?')[0] ?? src
		}
		if (elPath.endsWith(srcPath) || srcPath.endsWith(elPath)) return true
	}

	// Check srcset URLs
	const srcset = el.getAttribute('srcset')
	if (srcset) {
		const urls = srcset.split(',').map(entry => entry.trim().split(/\s+/)[0]).filter(Boolean)
		for (const url of urls) {
			if (!url) continue
			let urlPath: string
			try {
				urlPath = new URL(url).pathname
			} catch {
				urlPath = url.split('?')[0] ?? url
			}
			if (urlPath.endsWith(srcPath) || srcPath.endsWith(urlPath)) return true
		}
	}

	return false
}

/**
 * Annotate elements in the component HTML with `data-cms-preview-prop` attributes.
 * For each string prop, find the first leaf element whose trimmed text content
 * matches the prop's rendered value, and tag it.
 * Also annotates <img> elements whose src/srcset matches image prop values.
 */
function annotatePreviewProps(
	componentHtml: ReturnType<typeof parse>,
	props: Record<string, any>,
	propDefs: ComponentDefinition['props'],
): void {
	const annotated = new Set<string>()

	for (const def of propDefs) {
		// Only annotate string-type props
		if (def.type !== 'string') continue
		const value = props[def.name]
		if (typeof value !== 'string' || !value.trim()) continue

		const trimmedValue = value.trim()

		// First, check <img> elements for image props (src/srcset matching)
		if (!annotated.has(def.name)) {
			const imgElements = componentHtml.querySelectorAll('img')
			for (const img of imgElements) {
				if (img.getAttribute('data-cms-preview-prop')) continue
				if (imageMatchesSrc(img, trimmedValue)) {
					img.setAttribute('data-cms-preview-prop', def.name)
					img.setAttribute('data-cms-preview-type', 'image')
					annotated.add(def.name)
					break
				}
			}
		}

		if (annotated.has(def.name)) continue

		// Find leaf text nodes whose content matches
		const allElements = componentHtml.querySelectorAll('*')
		for (const el of allElements) {
			// Skip elements that already have an annotation
			if (el.getAttribute('data-cms-preview-prop')) continue

			// Check if this is a leaf element (no child elements, only text)
			if (el.childNodes.length === 0) continue
			const hasChildElements = el.childNodes.some(
				(n) => n.nodeType === 1, // ELEMENT_NODE
			)

			// For leaf elements or elements with only text children
			if (!hasChildElements) {
				const textContent = el.textContent.trim()
				if (textContent === trimmedValue && !annotated.has(def.name)) {
					el.setAttribute('data-cms-preview-prop', def.name)
					annotated.add(def.name)
					break
				}
			}
		}
	}
}

/**
 * Generate a standalone preview HTML page for a component.
 */
function generatePreviewHtml(
	componentOuterHtml: string,
	headStyles: string,
): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headStyles}
<style>
body { margin: 0; padding: 0; }
.cms-preview-container { overflow: hidden; }
</style>
</head>
<body>
<div class="cms-preview-container">${componentOuterHtml}</div>
<script>
// Notify parent that preview is ready
if (window.parent !== window) {
  window.parent.postMessage({ type: 'cms-preview-ready' }, window.location.origin);
}

// Listen for prop updates from the CMS editor
window.addEventListener('message', function(event) {
  // Only accept messages from same origin for security
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== 'cms-preview-update') return;
  var props = event.data.props;
  if (!props) return;

  var elements = document.querySelectorAll('[data-cms-preview-prop]');
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var propName = el.getAttribute('data-cms-preview-prop');
    if (propName && props[propName] !== undefined) {
      if (el.getAttribute('data-cms-preview-type') === 'image') {
        el.setAttribute('src', String(props[propName]));
        el.removeAttribute('srcset');
      } else {
        el.textContent = String(props[propName]);
      }
    }
  }
});
</script>
</body>
</html>`
}

/**
 * Extract <link rel="stylesheet"> and <style> tags from a page's <head>.
 */
function extractHeadStyles(root: ReturnType<typeof parse>): string {
	const head = root.querySelector('head')
	if (!head) return ''

	const parts: string[] = []

	// Extract <link rel="stylesheet"> tags
	for (const link of head.querySelectorAll('link[rel="stylesheet"]')) {
		parts.push(link.outerHTML)
	}

	// Extract <style> tags
	for (const style of head.querySelectorAll('style')) {
		parts.push(style.outerHTML)
	}

	return parts.join('\n')
}

/**
 * Generate standalone preview HTML files for each component that has
 * at least one instance on a built page.
 *
 * Reads the built HTML, extracts the component DOM fragment, annotates
 * text props for live preview updates, and writes a self-contained HTML
 * page to `outDir/_cms-preview/<ComponentName>/index.html`.
 */
export async function generateComponentPreviews(
	outDir: string,
	pageManifests: Map<string, PageData>,
	componentDefinitions: Record<string, ComponentDefinition>,
): Promise<void> {
	// Track which component names we've already processed
	const processed = new Set<string>()

	// Build a list of work: for each page, find components we haven't processed yet
	for (const [pagePath, pageData] of pageManifests) {
		const componentsToProcess: Array<{
			componentName: string
			instance: ComponentInstance
		}> = []

		for (const instance of Object.values(pageData.components)) {
			if (processed.has(instance.componentName)) continue
			if (!componentDefinitions[instance.componentName]) continue
			processed.add(instance.componentName)
			componentsToProcess.push({ componentName: instance.componentName, instance })
		}

		if (componentsToProcess.length === 0) continue

		// Resolve the HTML file path for this page
		let htmlFilePath: string
		if (pagePath === '/' || pagePath === '') {
			htmlFilePath = path.join(outDir, 'index.html')
		} else {
			const cleanPath = pagePath.replace(/^\//, '')
			// Try directory-style first (e.g., about/index.html)
			const dirStyle = path.join(outDir, cleanPath, 'index.html')
			const fileStyle = path.join(outDir, `${cleanPath}.html`)
			try {
				await fs.access(dirStyle)
				htmlFilePath = dirStyle
			} catch {
				htmlFilePath = fileStyle
			}
		}

		let pageHtml: string
		try {
			pageHtml = await fs.readFile(htmlFilePath, 'utf-8')
		} catch {
			// Page HTML not found, skip
			continue
		}

		const root = parse(pageHtml, { lowerCaseTagName: false, comment: true })
		const headStyles = extractHeadStyles(root)

		for (const { componentName, instance } of componentsToProcess) {
			const def = componentDefinitions[componentName]
			if (!def) continue

			// Find the component element in the DOM
			const componentEl = root.querySelector(
				`[data-cms-component-id="${instance.id}"]`,
			)
			if (!componentEl) continue

			// Clone the component HTML for annotation
			const componentFragment = parse(componentEl.outerHTML, {
				lowerCaseTagName: false,
				comment: true,
			})

			// Annotate text props for live preview
			annotatePreviewProps(componentFragment, instance.props, def.props)

			const previewHtml = generatePreviewHtml(
				componentFragment.toString(),
				headStyles,
			)

			// Write preview file
			const previewDir = path.join(outDir, '_cms-preview', componentName)
			await fs.mkdir(previewDir, { recursive: true })
			await fs.writeFile(path.join(previewDir, 'index.html'), previewHtml, 'utf-8')

			// Set the preview URL on the component definition
			def.previewUrl = `/_cms-preview/${componentName}/`
		}
	}
}
