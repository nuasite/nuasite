import { describe, expect, test } from 'bun:test'
import { ComponentRegistry } from '../../src/component-registry'

describe('Component Props Extraction with Nested Types', () => {
	test('should extract props with nested object types (interface)', async () => {
		const content = `---
interface Props {
  config: { setting: string; enabled: boolean };
  name: string;
  metadata?: { author: string; date: Date };
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(3)
		expect(props[0]?.name).toBe('config')
		expect(props[0]?.type).toBe('{ setting: string; enabled: boolean }')
		expect(props[0]?.required).toBe(true)

		expect(props[1]?.name).toBe('name')
		expect(props[1]?.type).toBe('string')
		expect(props[1]?.required).toBe(true)

		expect(props[2]?.name).toBe('metadata')
		expect(props[2]?.type).toBe('{ author: string; date: Date }')
		expect(props[2]?.required).toBe(false)
	})

	test('should extract props with nested object types (type)', async () => {
		const content = `---
type Props = {
  config: { setting: string };
  name: string;
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(2)
		expect(props[0]?.name).toBe('config')
		expect(props[0]?.type).toBe('{ setting: string }')

		expect(props[1]?.name).toBe('name')
		expect(props[1]?.type).toBe('string')
	})

	test('should extract props with deeply nested object types', async () => {
		const content = `---
interface Props {
  theme: {
    colors: {
      primary: string;
      secondary: string;
    };
    spacing: { sm: number; lg: number };
  };
  title: string;
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(2)
		expect(props[0]?.name).toBe('theme')
		// The type should include all the nested structure
		expect(props[0]?.type).toContain('colors')
		expect(props[0]?.type).toContain('primary')
		expect(props[0]?.type).toContain('spacing')

		expect(props[1]?.name).toBe('title')
		expect(props[1]?.type).toBe('string')
	})

	test('should extract props with array of objects', async () => {
		const content = `---
interface Props {
  items: Array<{ id: string; name: string }>;
  count: number;
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(2)
		expect(props[0]?.name).toBe('items')
		expect(props[0]?.type).toBe('Array<{ id: string; name: string }>')

		expect(props[1]?.name).toBe('count')
		expect(props[1]?.type).toBe('number')
	})

	test('should extract props with union types containing objects', async () => {
		const content = `---
interface Props {
  variant: 'small' | 'large';
  config: { enabled: boolean } | null;
  title: string;
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(3)
		expect(props[0]?.name).toBe('variant')
		expect(props[0]?.type).toBe("'small' | 'large'")

		expect(props[1]?.name).toBe('config')
		expect(props[1]?.type).toBe('{ enabled: boolean } | null')

		expect(props[2]?.name).toBe('title')
		expect(props[2]?.type).toBe('string')
	})

	test('should handle simple props without nested types (regression)', async () => {
		const content = `---
interface Props {
  name: string;
  age: number;
  active?: boolean;
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(3)
		expect(props[0]?.name).toBe('name')
		expect(props[0]?.type).toBe('string')
		expect(props[0]?.required).toBe(true)

		expect(props[1]?.name).toBe('age')
		expect(props[1]?.type).toBe('number')
		expect(props[1]?.required).toBe(true)

		expect(props[2]?.name).toBe('active')
		expect(props[2]?.type).toBe('boolean')
		expect(props[2]?.required).toBe(false)
	})

	test('should extract props with inline comments', async () => {
		const content = `---
interface Props {
  config: { setting: string }; // Configuration object
  name: string; // Component name
}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(2)
		expect(props[0]?.name).toBe('config')
		expect(props[0]?.type).toBe('{ setting: string }')
		expect(props[0]?.description).toBe('Configuration object')

		expect(props[1]?.name).toBe('name')
		expect(props[1]?.type).toBe('string')
		expect(props[1]?.description).toBe('Component name')
	})

	test('should handle empty Props interface', async () => {
		const content = `---
interface Props {}
---
<div>Component</div>`

		const registry = new ComponentRegistry([])
		// @ts-expect-error - accessing private method for testing
		const props = await registry.extractProps(content)

		expect(props).toHaveLength(0)
	})
})
