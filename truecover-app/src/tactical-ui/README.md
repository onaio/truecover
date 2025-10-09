# Tactical UI

A tactical/terminal-themed UI component library with corner brackets, monospace fonts, and military-inspired aesthetics.

## Features

- 🎯 **Tactical Design** - Military/terminal aesthetic with corner brackets
- 🔤 **Monospace Typography** - JetBrains Mono, Fira Code font stack
- ⚫ **Dark Theme** - Pure black background with high contrast
- 📦 **Portable** - Easy to copy to other projects
- 🎨 **Tailwind CSS** - Built on Tailwind for customization
- 📘 **TypeScript** - Fully typed components

## Installation

This library is currently embedded in the project. To use in other projects:

1. Copy the `tactical-ui` folder to your project's `src` directory
2. Install dependencies:
   ```bash
   npm install tailwindcss autoprefixer postcss
   ```
3. Copy `tailwind.config.js` and `postcss.config.js` to your project root
4. Import the library in your app:
   ```typescript
   import { TacticalCard, TacticalButton } from './tactical-ui';
   ```

## Components

### CornerBrackets

Decorative L-shaped corners for tactical UI elements.

```tsx
import { CornerBrackets } from './tactical-ui';

<div className="relative p-4 border border-tactical-border-medium">
  <CornerBrackets />
  Content here
</div>
```

**Props:**
- `color?: string` - Color class (default: `'text-tactical-border-light'`)
- `size?: number` - Bracket size in pixels (default: `12`)
- `showAll?: boolean` - Show all four corners (default: `true`)
- `corners?: object` - Show specific corners

### TacticalCard

A panel with corner brackets and tactical styling.

```tsx
import { TacticalCard } from './tactical-ui';

<TacticalCard title="Operations" borderStyle="medium">
  <p>Mission details here</p>
</TacticalCard>
```

**Props:**
- `title?: string` - Card title
- `showBrackets?: boolean` - Show corner brackets (default: `true`)
- `borderStyle?: 'light' | 'medium' | 'dark' | 'none'` - Border color (default: `'medium'`)
- `variant?: 'primary' | 'secondary' | 'tertiary'` - Background variant
- `hoverable?: boolean` - Enable hover effect
- `padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl'` - Padding size
- `onClick?: () => void` - Click handler

### TacticalButton

Button with multiple tactical variants.

```tsx
import { TacticalButton } from './tactical-ui';

<TacticalButton variant="primary" size="md" onClick={handleClick}>
  Execute Mission
</TacticalButton>
```

**Props:**
- `variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'` - Button style
- `size?: 'sm' | 'md' | 'lg'` - Button size
- `disabled?: boolean` - Disabled state
- `fullWidth?: boolean` - Full width button
- `type?: 'button' | 'submit' | 'reset'` - Button type

### TacticalInput

Terminal-style text input.

```tsx
import { TacticalInput } from './tactical-ui';

<TacticalInput
  label="Mission Code"
  value={code}
  onChange={setCode}
  placeholder="Enter code..."
  error={hasError}
  helperText="8-character alphanumeric"
/>
```

**Props:**
- `value: string | number` - Input value
- `onChange: (value: string) => void` - Change handler
- `type?: 'text' | 'number' | 'email' | 'password'` - Input type
- `label?: string` - Label text
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disabled state
- `error?: boolean` - Error state
- `helperText?: string` - Helper text

### TacticalSelect

Dropdown select with tactical styling.

```tsx
import { TacticalSelect } from './tactical-ui';

<TacticalSelect
  label="Mission Type"
  value={type}
  onChange={setType}
  options={[
    { value: 'recon', label: 'Reconnaissance' },
    { value: 'assault', label: 'Assault' }
  ]}
/>
```

**Props:**
- `value: string | number` - Selected value
- `onChange: (value: string) => void` - Change handler
- `options: TacticalSelectOption[]` - Options array
- `label?: string` - Label text
- `disabled?: boolean` - Disabled state

### TacticalBadge

Status/label indicators.

```tsx
import { TacticalBadge } from './tactical-ui';

<TacticalBadge variant="success">ACTIVE</TacticalBadge>
<TacticalBadge variant="danger">HIGH RISK</TacticalBadge>
```

**Props:**
- `variant?: 'default' | 'success' | 'danger' | 'warning' | 'info'` - Badge style
- `size?: 'xs' | 'sm' | 'md'` - Badge size

### TacticalTable

Monospace data table.

```tsx
import { TacticalTable } from './tactical-ui';

<TacticalTable
  columns={[
    { key: 'id', label: 'ID', align: 'left' },
    { key: 'name', label: 'NAME', align: 'left' },
    { key: 'status', label: 'STATUS', render: (val) => <TacticalBadge>{val}</TacticalBadge> }
  ]}
  data={missions}
  onRowClick={(row) => console.log(row)}
/>
```

**Props:**
- `columns: TacticalTableColumn[]` - Column configuration
- `data: any[]` - Table data
- `hoverable?: boolean` - Enable row hover (default: `true`)
- `onRowClick?: (row: any, index: number) => void` - Row click handler

### TacticalHeader

Page header with title and actions.

```tsx
import { TacticalHeader, TacticalButton } from './tactical-ui';

<TacticalHeader
  title="Mission Control"
  subtitle="24 active operations"
  actions={
    <>
      <TacticalButton variant="secondary" size="sm">Settings</TacticalButton>
      <TacticalButton variant="primary" size="sm">New Mission</TacticalButton>
    </>
  }
/>
```

**Props:**
- `title: string` - Main title
- `subtitle?: string` - Subtitle or description
- `actions?: React.ReactNode` - Action buttons/elements
- `showBrackets?: boolean` - Show corner brackets (default: `true`)

## Theme

The library includes a theme configuration with colors, typography, and spacing:

```typescript
import { theme } from './tactical-ui';

// Access theme values
const bgColor = theme.colors.background.primary; // '#000000'
const fontFamily = theme.typography.fontFamily.mono;
```

## Tailwind Configuration

The library extends Tailwind CSS with custom utilities:

### Colors

- `tactical-bg-primary` - Pure black (#000000)
- `tactical-bg-secondary` - Near black (#0a0a0a)
- `tactical-bg-tertiary` - Dark gray (#111111)
- `tactical-border-light` - Light gray border (#555555)
- `tactical-border-medium` - Medium gray border (#444444)
- `tactical-border-dark` - Dark gray border (#333333)
- `tactical-text-primary` - White text (#ffffff)
- `tactical-text-secondary` - Light gray text (#e5e5e5)
- `tactical-text-muted` - Muted gray text (#999999)
- `tactical-accent-red` - Red accent (#ef4444)
- `tactical-accent-green` - Green accent (#10b981)
- `tactical-accent-blue` - Blue accent (#3b82f6)

### Typography

- Font family: `font-mono` - JetBrains Mono, Fira Code, Consolas, Monaco
- Sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`

### Custom CSS Classes

- `.tactical-corners` - Corner bracket container
- `.tactical-grid` - Grid pattern background
- `.tactical-scanlines` - Scanline effect
- `.tactical-glow` - Red glow effect
- `.tactical-terminal` - Terminal text styling
- `.tactical-table` - Data table styling
- `.tactical-scrollbar` - Custom scrollbar

## Examples

### Complete Example

```tsx
import {
  TacticalCard,
  TacticalButton,
  TacticalInput,
  TacticalBadge,
  TacticalHeader,
  TacticalTable
} from './tactical-ui';

function App() {
  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="Mission Control"
        subtitle="Status: Operational"
        actions={<TacticalButton variant="primary">Deploy</TacticalButton>}
      />

      <div className="p-6 grid gap-6">
        <TacticalCard title="Active Missions">
          <TacticalTable
            columns={[
              { key: 'code', label: 'CODE' },
              { key: 'name', label: 'MISSION' },
              {
                key: 'status',
                label: 'STATUS',
                render: (val) => (
                  <TacticalBadge variant={val === 'active' ? 'success' : 'default'}>
                    {val}
                  </TacticalBadge>
                )
              }
            ]}
            data={[
              { code: 'ALPHA-001', name: 'Reconnaissance', status: 'active' },
              { code: 'BRAVO-002', name: 'Extraction', status: 'pending' }
            ]}
          />
        </TacticalCard>

        <TacticalCard title="New Mission">
          <TacticalInput
            label="Mission Code"
            value={code}
            onChange={setCode}
            placeholder="Enter code..."
          />
          <TacticalButton variant="primary" fullWidth>
            Create Mission
          </TacticalButton>
        </TacticalCard>
      </div>
    </div>
  );
}
```

## License

MIT - Feel free to use in your projects!
