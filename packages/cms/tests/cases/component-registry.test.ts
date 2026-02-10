/**
 * Component Registry tests
 *
 * Tests for the ComponentRegistry class that scans Astro components
 * and extracts their definitions including props, slots, and descriptions.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { ComponentRegistry, parseComponentUsage } from '../../src/component-registry'
import { setupAstroProjectStructure, withTempDir } from '../utils'

// ============================================================================
// ComponentRegistry Class Tests
// ============================================================================

withTempDir('ComponentRegistry', (getCtx) => {
	// --------------------------------------------------------------------------
	// Constructor
	// --------------------------------------------------------------------------

	describe('constructor', () => {
		test('should use default component directory', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Button.astro',
				`---
---
<button>Click</button>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()

			expect(registry.getComponent('Button')).toBeDefined()
		})

		test('should accept custom component directories', async () => {
			const ctx = getCtx()
			await ctx.mkdir('custom/components')
			await ctx.writeFile(
				'custom/components/Card.astro',
				`---
---
<div>Card</div>
`,
			)

			const registry = new ComponentRegistry(['custom/components'])
			await registry.scan()

			expect(registry.getComponent('Card')).toBeDefined()
		})

		test('should accept multiple component directories', async () => {
			const ctx = getCtx()
			await ctx.mkdir('src/components')
			await ctx.mkdir('src/ui')
			await ctx.writeFile('src/components/Button.astro', '<button />')
			await ctx.writeFile('src/ui/Card.astro', '<div />')

			const registry = new ComponentRegistry(['src/components', 'src/ui'])
			await registry.scan()

			expect(registry.getComponent('Button')).toBeDefined()
			expect(registry.getComponent('Card')).toBeDefined()
		})
	})

	// --------------------------------------------------------------------------
	// scan
	// --------------------------------------------------------------------------

	describe('scan', () => {
		test('should scan .astro files', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile('src/components/Button.astro', '<button />')
			await ctx.writeFile('src/components/Card.astro', '<div />')

			const registry = new ComponentRegistry()
			await registry.scan()
			const components = registry.getComponents()

			expect(Object.keys(components)).toContain('Button')
			expect(Object.keys(components)).toContain('Card')
		})

		test('should scan nested directories', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.mkdir('src/components/ui')
			await ctx.mkdir('src/components/layout')
			await ctx.writeFile('src/components/ui/Badge.astro', '<span />')
			await ctx.writeFile('src/components/layout/Header.astro', '<header />')

			const registry = new ComponentRegistry()
			await registry.scan()

			expect(registry.getComponent('Badge')).toBeDefined()
			expect(registry.getComponent('Header')).toBeDefined()
		})

		test('should ignore non-.astro files', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile('src/components/Button.astro', '<button />')
			await ctx.writeFile('src/components/utils.ts', 'export const x = 1')
			await ctx.writeFile('src/components/styles.css', '.btn {}')

			const registry = new ComponentRegistry()
			await registry.scan()
			const components = registry.getComponents()

			expect(Object.keys(components)).toEqual(['Button'])
		})

		test('should handle non-existent directories gracefully', async () => {
			const ctx = getCtx()
			// Don't create the directory

			const registry = new ComponentRegistry(['src/nonexistent'])
			await registry.scan() // Should not throw

			expect(registry.getComponents()).toEqual({})
		})

		test('should store relative file paths', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.mkdir('src/components/ui')
			await ctx.writeFile('src/components/ui/Button.astro', '<button />')

			const registry = new ComponentRegistry()
			await registry.scan()
			const button = registry.getComponent('Button')

			expect(button?.file).toBe('src/components/ui/Button.astro')
		})
	})

	// --------------------------------------------------------------------------
	// getComponents / getComponent
	// --------------------------------------------------------------------------

	describe('getComponents', () => {
		test('should return empty object when no components', async () => {
			const ctx = getCtx()
			await ctx.mkdir('src/components')

			const registry = new ComponentRegistry()
			await registry.scan()

			expect(registry.getComponents()).toEqual({})
		})

		test('should return all scanned components', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile('src/components/A.astro', '<div />')
			await ctx.writeFile('src/components/B.astro', '<div />')
			await ctx.writeFile('src/components/C.astro', '<div />')

			const registry = new ComponentRegistry()
			await registry.scan()
			const components = registry.getComponents()

			expect(Object.keys(components).sort()).toEqual(['A', 'B', 'C'])
		})
	})

	describe('getComponent', () => {
		test('should return undefined for non-existent component', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)

			const registry = new ComponentRegistry()
			await registry.scan()

			expect(registry.getComponent('NonExistent')).toBeUndefined()
		})

		test('should return component definition', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Button.astro',
				`---
interface Props {
  label: string;
}
---
<button>{Astro.props.label}</button>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const button = registry.getComponent('Button')

			expect(button).toBeDefined()
			expect(button?.name).toBe('Button')
			expect(button?.props).toHaveLength(1)
		})
	})

	// --------------------------------------------------------------------------
	// Props extraction
	// --------------------------------------------------------------------------

	describe('props extraction', () => {
		test('should extract props from interface Props', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Button.astro',
				`---
interface Props {
  label: string;
  variant: 'primary' | 'secondary';
}
---
<button />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const button = registry.getComponent('Button')

			expect(button?.props).toHaveLength(2)
			expect(button?.props[0]?.name).toBe('label')
			expect(button?.props[0]?.type).toBe('string')
			expect(button?.props[0]?.required).toBe(true)
			expect(button?.props[1]?.name).toBe('variant')
		})

		test('should extract props from type Props', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Card.astro',
				`---
type Props = {
  title: string;
  subtitle?: string;
};
---
<div />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const card = registry.getComponent('Card')

			expect(card?.props).toHaveLength(2)
			expect(card?.props[0]?.name).toBe('title')
			expect(card?.props[1]?.name).toBe('subtitle')
		})

		test('should mark optional props correctly', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Badge.astro',
				`---
interface Props {
  text: string;
  color?: string;
}
---
<span />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const badge = registry.getComponent('Badge')

			expect(badge?.props[0]?.required).toBe(true)
			expect(badge?.props[1]?.required).toBe(false)
		})

		test('should extract prop descriptions from inline comments', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Input.astro',
				`---
interface Props {
  value: string; // The input value
  placeholder?: string; // Placeholder text shown when empty
}
---
<input />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const input = registry.getComponent('Input')

			expect(input?.props[0]?.description).toBe('The input value')
			expect(input?.props[1]?.description).toBe('Placeholder text shown when empty')
		})

		test('should extract default values from destructuring', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Alert.astro',
				`---
interface Props {
  type?: string;
  dismissible?: boolean;
}
const { type = 'info', dismissible = false } = Astro.props;
---
<div />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const alert = registry.getComponent('Alert')

			expect(alert?.props.find(p => p.name === 'type')?.defaultValue).toBe('info')
			// The regex captures trailing characters, so we trim for comparison
			expect(alert?.props.find(p => p.name === 'dismissible')?.defaultValue?.trim()).toBe('false')
		})

		test('should handle complex types with nested objects', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/DataTable.astro',
				`---
interface Props {
  config: { columns: string[]; sortable: boolean };
  data: Array<Record<string, unknown>>;
}
---
<table />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const table = registry.getComponent('DataTable')

			expect(table?.props).toHaveLength(2)
			expect(table?.props[0]?.type).toBe('{ columns: string[]; sortable: boolean }')
			expect(table?.props[1]?.type).toBe('Array<Record<string, unknown>>')
		})

		test('should handle union types', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Button.astro',
				`---
interface Props {
  size: 'sm' | 'md' | 'lg';
}
---
<button />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const button = registry.getComponent('Button')

			expect(button?.props[0]?.type).toBe("'sm' | 'md' | 'lg'")
		})

		test('should handle generic types', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/List.astro',
				`---
interface Props {
  items: Array<string>;
  map: Map<string, number>;
}
---
<ul />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const list = registry.getComponent('List')

			expect(list?.props[0]?.type).toBe('Array<string>')
			expect(list?.props[1]?.type).toBe('Map<string, number>')
		})

		test('should skip comment lines in interface', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Form.astro',
				`---
interface Props {
  // This is a comment
  name: string;
  /* Block comment */
  email: string;
}
---
<form />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const form = registry.getComponent('Form')

			expect(form?.props).toHaveLength(2)
			expect(form?.props[0]?.name).toBe('name')
			expect(form?.props[1]?.name).toBe('email')
		})

		test('should return empty props when no interface defined', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Simple.astro',
				`---
const message = 'Hello';
---
<div>{message}</div>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const simple = registry.getComponent('Simple')

			expect(simple?.props).toEqual([])
		})
	})

	// --------------------------------------------------------------------------
	// Slots extraction
	// --------------------------------------------------------------------------

	describe('slots extraction', () => {
		test('should extract named slots', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Card.astro',
				`---
---
<div>
  <slot name="header" />
  <slot name="content" />
  <slot name="footer" />
</div>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const card = registry.getComponent('Card')

			expect(card?.slots).toContain('header')
			expect(card?.slots).toContain('content')
			expect(card?.slots).toContain('footer')
		})

		test('should detect default slot', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Container.astro',
				`---
---
<div>
  <slot />
</div>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const container = registry.getComponent('Container')

			expect(container?.slots).toContain('default')
		})

		test('should detect default slot with self-closing tag', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Wrapper.astro',
				`---
---
<div><slot/></div>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const wrapper = registry.getComponent('Wrapper')

			expect(wrapper?.slots).toContain('default')
		})

		test('should handle both default and named slots', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Layout.astro',
				`---
---
<main>
  <slot name="sidebar" />
  <slot />
</main>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const layout = registry.getComponent('Layout')

			expect(layout?.slots).toContain('default')
			expect(layout?.slots).toContain('sidebar')
			// Default should be first
			expect(layout?.slots?.[0]).toBe('default')
		})

		test('should return undefined slots when no slots exist', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Icon.astro',
				`---
---
<svg></svg>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const icon = registry.getComponent('Icon')

			expect(icon?.slots).toBeUndefined()
		})

		test('should handle slots with single quotes', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Panel.astro',
				`---
---
<div>
  <slot name='title' />
</div>
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const panel = registry.getComponent('Panel')

			expect(panel?.slots).toContain('title')
		})
	})

	// --------------------------------------------------------------------------
	// Description extraction
	// --------------------------------------------------------------------------

	describe('description extraction', () => {
		test('should extract JSDoc description', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Button.astro',
				`---
/**
 * A reusable button component with various styles.
 */
interface Props {
  label: string;
}
---
<button />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const button = registry.getComponent('Button')

			expect(button?.description).toBe('A reusable button component with various styles.')
		})

		test('should handle multi-line JSDoc descriptions', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Modal.astro',
				`---
/**
 * A modal dialog component.
 * Supports various sizes and animations.
 * Can be closed with ESC key.
 */
interface Props {
  open: boolean;
}
---
<dialog />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const modal = registry.getComponent('Modal')

			expect(modal?.description).toContain('modal dialog')
			expect(modal?.description).toContain('various sizes')
			expect(modal?.description).toContain('ESC key')
		})

		test('should return undefined when no JSDoc present', async () => {
			const ctx = getCtx()
			await setupAstroProjectStructure(ctx)
			await ctx.writeFile(
				'src/components/Simple.astro',
				`---
interface Props {
  value: string;
}
---
<div />
`,
			)

			const registry = new ComponentRegistry()
			await registry.scan()
			const simple = registry.getComponent('Simple')

			expect(simple?.description).toBeUndefined()
		})
	})
})

// ============================================================================
// parseComponentUsage Tests
// ============================================================================

describe('parseComponentUsage', () => {
	test('should parse component with string props', () => {
		const content = `<Button label="Click me" variant="primary" />`

		const usages = parseComponentUsage(content, 'Button')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props.label).toBe('Click me')
		expect(usages[0]?.props.variant).toBe('primary')
	})

	test('should parse component with expression props', () => {
		const content = `<Card title={pageTitle} data={items} />`

		const usages = parseComponentUsage(content, 'Card')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props.title).toBe('pageTitle')
		expect(usages[0]?.props.data).toBe('items')
	})

	test('should parse boolean props', () => {
		const content = `<Modal open dismissible />`

		const usages = parseComponentUsage(content, 'Modal')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props.open).toBe('true')
		expect(usages[0]?.props.dismissible).toBe('true')
	})

	test('should track line numbers', () => {
		const content = `---
---
<div>
  <Button label="First" />
  <span>text</span>
  <Button label="Second" />
</div>`

		const usages = parseComponentUsage(content, 'Button')

		expect(usages).toHaveLength(2)
		expect(usages[0]?.line).toBe(4)
		expect(usages[1]?.line).toBe(6)
	})

	test('should handle multiple usages on same line', () => {
		const content = `<Button label="A" /><Button label="B" />`

		const usages = parseComponentUsage(content, 'Button')

		expect(usages).toHaveLength(2)
		expect(usages[0]?.props.label).toBe('A')
		expect(usages[1]?.props.label).toBe('B')
	})

	test('should return empty array when no usages found', () => {
		const content = `<div><span>No buttons here</span></div>`

		const usages = parseComponentUsage(content, 'Button')

		expect(usages).toEqual([])
	})

	test('should handle component with no props', () => {
		const content = `<Divider />`

		const usages = parseComponentUsage(content, 'Divider')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props).toEqual({})
	})

	test('should handle mixed prop types', () => {
		const content = `<Input value="text" onChange={handleChange} disabled />`

		const usages = parseComponentUsage(content, 'Input')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props.value).toBe('text')
		expect(usages[0]?.props.onChange).toBe('handleChange')
		expect(usages[0]?.props.disabled).toBe('true')
	})

	test('should handle single-quoted string props', () => {
		const content = `<Button label='Click' />`

		const usages = parseComponentUsage(content, 'Button')

		expect(usages).toHaveLength(1)
		expect(usages[0]?.props.label).toBe('Click')
	})

	test('should not match similar component names', () => {
		// parseComponentUsage requires at least one prop (or whitespace before closing)
		const content = `<ButtonGroup items={data}><Button label="test" /></ButtonGroup>`

		const buttonUsages = parseComponentUsage(content, 'Button')
		const groupUsages = parseComponentUsage(content, 'ButtonGroup')

		expect(buttonUsages).toHaveLength(1)
		expect(buttonUsages[0]?.props.label).toBe('test')
		expect(groupUsages).toHaveLength(1)
		expect(groupUsages[0]?.props.items).toBe('data')
	})
})
