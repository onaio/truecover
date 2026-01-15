import React, { useState } from 'react';
import {
  TacticalButton,
  TacticalCard,
  TacticalHeader,
  TacticalInput,
  TacticalTextarea,
  TacticalSelect,
  TacticalMultiSelect,
  TacticalBadge,
  TacticalLoader,
  TacticalModal,
  TacticalCollapsible,
  TacticalDatePicker,
  TacticalTable,
} from '../tactical-ui';

const TacticalShowcase: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  const [selectValue, setSelectValue] = useState('option1');
  const [multiSelectValue, setMultiSelectValue] = useState<(string | number)[]>(['option1']);
  const [dateValue, setDateValue] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeButton, setActiveButton] = useState<string | null>(null);

  const selectOptions = [
    { value: 'option1', label: 'Option One' },
    { value: 'option2', label: 'Option Two' },
    { value: 'option3', label: 'Option Three' },
  ];

  const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="mb-12">
      <h2 className="text-2xl font-bold text-tactical-text-primary font-mono uppercase tracking-wider mb-6 pb-2 border-b border-tactical-border-medium">
        {title}
      </h2>
      {children}
    </div>
  );

  const ColorSwatch: React.FC<{ color: string; name: string; hex: string }> = ({ color, name, hex }) => (
    <div className="flex flex-col items-center gap-2">
      <div className={`w-24 h-24 ${color} border border-tactical-border-medium`} />
      <div className="text-center">
        <div className="text-xs font-mono text-tactical-text-primary">{name}</div>
        <div className="text-xs font-mono text-tactical-text-dim">{hex}</div>
      </div>
    </div>
  );

  const CodeBlock: React.FC<{ children: string }> = ({ children }) => (
    <pre className="bg-tactical-bg-secondary border border-tactical-border-medium p-4 text-xs font-mono text-tactical-text-secondary overflow-x-auto">
      {children}
    </pre>
  );

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="Tactical UI Showcase"
        subtitle="Component Library Documentation & Examples"
      />

      <div className="max-w-7xl mx-auto p-6">
        {/* Color Palette */}
        <Section title="Color Palette">
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-mono text-tactical-text-secondary uppercase tracking-wider mb-4">
                Backgrounds
              </h3>
              <div className="flex gap-6 flex-wrap">
                <ColorSwatch color="bg-tactical-bg-primary" name="Primary" hex="#000000" />
                <ColorSwatch color="bg-tactical-bg-secondary" name="Secondary" hex="#0a0a0a" />
                <ColorSwatch color="bg-tactical-bg-tertiary" name="Tertiary" hex="#111111" />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-mono text-tactical-text-secondary uppercase tracking-wider mb-4">
                Borders
              </h3>
              <div className="flex gap-6 flex-wrap">
                <ColorSwatch color="bg-tactical-border-light" name="Light" hex="#555555" />
                <ColorSwatch color="bg-tactical-border-medium" name="Medium" hex="#444444" />
                <ColorSwatch color="bg-tactical-border-dark" name="Dark" hex="#333333" />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-mono text-tactical-text-secondary uppercase tracking-wider mb-4">
                Text Colors
              </h3>
              <div className="flex gap-6 flex-wrap">
                <ColorSwatch color="bg-tactical-text-primary" name="Primary" hex="#ffffff" />
                <ColorSwatch color="bg-tactical-text-secondary" name="Secondary" hex="#e5e5e5" />
                <ColorSwatch color="bg-tactical-text-muted" name="Muted" hex="#cccccc" />
                <ColorSwatch color="bg-tactical-text-dim" name="Dim" hex="#aaaaaa" />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-mono text-tactical-text-secondary uppercase tracking-wider mb-4">
                Accent Colors
              </h3>
              <div className="flex gap-6 flex-wrap">
                <ColorSwatch color="bg-tactical-accent-red" name="Red" hex="#ef4444" />
                <ColorSwatch color="bg-tactical-accent-green" name="Green" hex="#10b981" />
                <ColorSwatch color="bg-tactical-accent-blue" name="Blue" hex="#3b82f6" />
                <ColorSwatch color="bg-tactical-accent-orange" name="Orange" hex="#f97316" />
              </div>
            </div>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Variants
              </h3>
              <div className="flex gap-4 flex-wrap items-center mb-4">
                <TacticalButton variant="primary">Primary</TacticalButton>
                <TacticalButton variant="secondary">Secondary</TacticalButton>
                <TacticalButton variant="ghost">Ghost</TacticalButton>
                <TacticalButton variant="danger">Danger</TacticalButton>
                <TacticalButton variant="success">Success</TacticalButton>
              </div>
              <CodeBlock>{`<TacticalButton variant="primary">Primary</TacticalButton>
<TacticalButton variant="secondary">Secondary</TacticalButton>
<TacticalButton variant="ghost">Ghost</TacticalButton>
<TacticalButton variant="danger">Danger</TacticalButton>
<TacticalButton variant="success">Success</TacticalButton>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Sizes
              </h3>
              <div className="flex gap-4 flex-wrap items-center mb-4">
                <TacticalButton size="sm">Small</TacticalButton>
                <TacticalButton size="md">Medium</TacticalButton>
                <TacticalButton size="lg">Large</TacticalButton>
              </div>
              <CodeBlock>{`<TacticalButton size="sm">Small</TacticalButton>
<TacticalButton size="md">Medium</TacticalButton>
<TacticalButton size="lg">Large</TacticalButton>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                States
              </h3>
              <div className="flex gap-4 flex-wrap items-center mb-4">
                <TacticalButton>Normal</TacticalButton>
                <TacticalButton disabled>Disabled</TacticalButton>
                <TacticalButton
                  variant="success"
                  isActive={activeButton === 'toggle'}
                  onClick={() => setActiveButton(activeButton === 'toggle' ? null : 'toggle')}
                >
                  Active Toggle
                </TacticalButton>
              </div>
              <CodeBlock>{`<TacticalButton>Normal</TacticalButton>
<TacticalButton disabled>Disabled</TacticalButton>
<TacticalButton variant="success" isActive={true}>Active</TacticalButton>`}</CodeBlock>
            </div>
          </div>
        </Section>

        {/* Badges */}
        <Section title="Badges">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Variants
              </h3>
              <div className="flex gap-4 flex-wrap items-center mb-4">
                <TacticalBadge variant="default">Default</TacticalBadge>
                <TacticalBadge variant="success">Success</TacticalBadge>
                <TacticalBadge variant="danger">Danger</TacticalBadge>
                <TacticalBadge variant="warning">Warning</TacticalBadge>
                <TacticalBadge variant="info">Info</TacticalBadge>
              </div>
              <CodeBlock>{`<TacticalBadge variant="default">Default</TacticalBadge>
<TacticalBadge variant="success">Success</TacticalBadge>
<TacticalBadge variant="danger">Danger</TacticalBadge>
<TacticalBadge variant="warning">Warning</TacticalBadge>
<TacticalBadge variant="info">Info</TacticalBadge>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Sizes
              </h3>
              <div className="flex gap-4 flex-wrap items-center mb-4">
                <TacticalBadge size="xs" variant="success">Extra Small</TacticalBadge>
                <TacticalBadge size="sm" variant="success">Small</TacticalBadge>
                <TacticalBadge size="md" variant="success">Medium</TacticalBadge>
              </div>
              <CodeBlock>{`<TacticalBadge size="xs">Extra Small</TacticalBadge>
<TacticalBadge size="sm">Small</TacticalBadge>
<TacticalBadge size="md">Medium</TacticalBadge>`}</CodeBlock>
            </div>
          </div>
        </Section>

        {/* Form Components */}
        <Section title="Form Components">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Input
              </h3>
              <div className="max-w-md space-y-4 mb-4">
                <TacticalInput
                  label="Standard Input"
                  value={inputValue}
                  onChange={setInputValue}
                  placeholder="Enter text..."
                />
                <TacticalInput
                  label="Disabled Input"
                  value="Disabled"
                  onChange={() => {}}
                  disabled
                />
              </div>
              <CodeBlock>{`<TacticalInput
  label="Standard Input"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="Enter text..."
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Textarea
              </h3>
              <div className="max-w-md mb-4">
                <TacticalTextarea
                  label="Message"
                  value={textareaValue}
                  onChange={setTextareaValue}
                  placeholder="Enter multi-line text..."
                  rows={4}
                />
              </div>
              <CodeBlock>{`<TacticalTextarea
  label="Message"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  rows={4}
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Select
              </h3>
              <div className="max-w-md mb-4">
                <TacticalSelect
                  label="Choose Option"
                  value={selectValue}
                  onChange={setSelectValue}
                  options={selectOptions}
                />
              </div>
              <CodeBlock>{`<TacticalSelect
  label="Choose Option"
  value={value}
  onChange={setValue}
  options={[
    { value: 'option1', label: 'Option One' },
    { value: 'option2', label: 'Option Two' },
  ]}
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Multi-Select
              </h3>
              <div className="max-w-md mb-4">
                <TacticalMultiSelect
                  label="Choose Multiple"
                  value={multiSelectValue}
                  onChange={setMultiSelectValue}
                  options={selectOptions}
                />
              </div>
              <CodeBlock>{`<TacticalMultiSelect
  label="Choose Multiple"
  value={values}
  onChange={setValues}
  options={options}
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Date Picker
              </h3>
              <div className="max-w-md mb-4">
                <TacticalDatePicker
                  label="Select Date"
                  value={dateValue}
                  onChange={setDateValue}
                />
              </div>
              <CodeBlock>{`<TacticalDatePicker
  label="Select Date"
  value={date}
  onChange={setDate}
/>`}</CodeBlock>
            </div>
          </div>
        </Section>

        {/* Cards */}
        <Section title="Cards">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Padding Sizes
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TacticalCard padding="sm">
                  <p className="text-tactical-text-secondary font-mono text-sm">Small Padding</p>
                </TacticalCard>
                <TacticalCard padding="md">
                  <p className="text-tactical-text-secondary font-mono text-sm">Medium Padding</p>
                </TacticalCard>
                <TacticalCard padding="lg">
                  <p className="text-tactical-text-secondary font-mono text-sm">Large Padding</p>
                </TacticalCard>
              </div>
              <CodeBlock>{`<TacticalCard padding="sm">Content</TacticalCard>
<TacticalCard padding="md">Content</TacticalCard>
<TacticalCard padding="lg">Content</TacticalCard>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                With Content
              </h3>
              <TacticalCard padding="lg">
                <div className="space-y-4">
                  <h3 className="text-xl font-mono text-tactical-text-primary uppercase">Card Title</h3>
                  <p className="text-tactical-text-secondary font-mono text-sm">
                    This is a tactical card component with various content inside. It features the standard tactical styling with dark backgrounds and light borders.
                  </p>
                  <div className="flex gap-2">
                    <TacticalBadge variant="success">Active</TacticalBadge>
                    <TacticalBadge variant="info">Info</TacticalBadge>
                  </div>
                </div>
              </TacticalCard>
            </div>
          </div>
        </Section>

        {/* Collapsible */}
        <Section title="Collapsible">
          <div className="space-y-4">
            <TacticalCard padding="lg">
              <TacticalCollapsible
                title="Collapsible Section"
                defaultCollapsed={false}
                collapsedSummary="(Click to expand)"
              >
                <div className="space-y-4 pt-4">
                  <p className="text-tactical-text-secondary font-mono text-sm">
                    This content is inside a collapsible section. Click the title to toggle visibility.
                  </p>
                  <TacticalButton size="sm">Action Button</TacticalButton>
                </div>
              </TacticalCollapsible>
            </TacticalCard>

            <TacticalCard padding="lg">
              <TacticalCollapsible
                title="With Action Button"
                defaultCollapsed={true}
                collapsedSummary="(5 items)"
                actionButton={
                  <TacticalButton size="sm" variant="primary">
                    Add Item
                  </TacticalButton>
                }
              >
                <div className="space-y-2 pt-4">
                  <p className="text-tactical-text-secondary font-mono text-sm">Item 1</p>
                  <p className="text-tactical-text-secondary font-mono text-sm">Item 2</p>
                  <p className="text-tactical-text-secondary font-mono text-sm">Item 3</p>
                </div>
              </TacticalCollapsible>
            </TacticalCard>

            <CodeBlock>{`<TacticalCollapsible
  title="Collapsible Section"
  defaultCollapsed={false}
  collapsedSummary="(Click to expand)"
  actionButton={<TacticalButton size="sm">Action</TacticalButton>}
>
  Content here...
</TacticalCollapsible>`}</CodeBlock>
          </div>
        </Section>

        {/* Modal */}
        <Section title="Modal">
          <div className="space-y-4">
            <TacticalButton onClick={() => setIsModalOpen(true)}>
              Open Modal
            </TacticalButton>

            <TacticalModal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              title="Example Modal"
            >
              <div className="space-y-4">
                <p className="text-tactical-text-secondary font-mono text-sm">
                  This is a tactical modal component. It features a dark overlay and tactical styling consistent with the rest of the UI.
                </p>
                <TacticalInput
                  label="Input Field"
                  value=""
                  onChange={() => {}}
                  placeholder="Enter something..."
                />
                <div className="flex gap-4 justify-end">
                  <TacticalButton variant="ghost" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </TacticalButton>
                  <TacticalButton variant="primary" onClick={() => setIsModalOpen(false)}>
                    Confirm
                  </TacticalButton>
                </div>
              </div>
            </TacticalModal>

            <CodeBlock>{`<TacticalModal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Modal Title"
>
  Modal content here...
</TacticalModal>`}</CodeBlock>
          </div>
        </Section>

        {/* Loader */}
        <Section title="Loader">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Sizes
              </h3>
              <div className="flex gap-8 items-center mb-4">
                <TacticalLoader size="sm" />
                <TacticalLoader size="md" />
                <TacticalLoader size="lg" />
              </div>
              <CodeBlock>{`<TacticalLoader size="sm" />
<TacticalLoader size="md" />
<TacticalLoader size="lg" />`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                With Text
              </h3>
              <TacticalCard padding="lg" className="w-fit mb-4">
                <div className="flex items-center gap-4">
                  <TacticalLoader size="md" />
                  <span className="text-tactical-text-secondary font-mono text-sm uppercase tracking-wider">
                    Loading Data...
                  </span>
                </div>
              </TacticalCard>
              <CodeBlock>{`<TacticalCard padding="lg">
  <div className="flex items-center gap-4">
    <TacticalLoader size="md" />
    <span>Loading Data...</span>
  </div>
</TacticalCard>`}</CodeBlock>
            </div>
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography">
          <TacticalCard padding="lg">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">XS - 10px</p>
                <p className="text-xs text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">SM - 12px</p>
                <p className="text-sm text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">BASE - 14px</p>
                <p className="text-base text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">LG - 16px</p>
                <p className="text-lg text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">XL - 18px</p>
                <p className="text-xl text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              <div>
                <p className="text-xs text-tactical-text-dim mb-1">2XL - 20px</p>
                <p className="text-2xl text-tactical-text-primary font-mono">
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
            </div>
          </TacticalCard>
        </Section>

        {/* Table */}
        <Section title="Table">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Basic Table with Row Hover
              </h3>
              <div className="mb-4">
                <TacticalTable
                  columns={[
                    { key: 'id', label: 'ID', align: 'left' },
                    { key: 'mission', label: 'Mission', align: 'left' },
                    { key: 'status', label: 'Status', align: 'center' },
                    { key: 'priority', label: 'Priority', align: 'center' },
                  ]}
                  data={[
                    { id: 'M-001', mission: 'Reconnaissance Alpha', status: 'ACTIVE', priority: 'HIGH' },
                    { id: 'M-002', mission: 'Supply Route Beta', status: 'PENDING', priority: 'MEDIUM' },
                    { id: 'M-003', mission: 'Evacuation Gamma', status: 'COMPLETE', priority: 'LOW' },
                    { id: 'M-004', mission: 'Defense Delta', status: 'ACTIVE', priority: 'CRITICAL' },
                  ]}
                  hoverable={true}
                />
              </div>
              <CodeBlock>{`<TacticalTable
  columns={[
    { key: 'id', label: 'ID', align: 'left' },
    { key: 'mission', label: 'Mission', align: 'left' },
    { key: 'status', label: 'Status', align: 'center' },
  ]}
  data={[
    { id: 'M-001', mission: 'Reconnaissance Alpha', status: 'ACTIVE' },
    { id: 'M-002', mission: 'Supply Route Beta', status: 'PENDING' },
  ]}
  hoverable={true}
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Table with Custom Rendering
              </h3>
              <div className="mb-4">
                <TacticalTable
                  columns={[
                    { key: 'id', label: 'ID' },
                    { key: 'name', label: 'Agent' },
                    { key: 'status', label: 'Status', render: (value) => (
                      <TacticalBadge variant={value === 'ACTIVE' ? 'success' : value === 'STANDBY' ? 'warning' : 'default'}>
                        {value}
                      </TacticalBadge>
                    )},
                    { key: 'clearance', label: 'Clearance', align: 'center' },
                  ]}
                  data={[
                    { id: 'A-101', name: 'Agent Smith', status: 'ACTIVE', clearance: 'LEVEL 5' },
                    { id: 'A-102', name: 'Agent Jones', status: 'STANDBY', clearance: 'LEVEL 4' },
                    { id: 'A-103', name: 'Agent Brown', status: 'OFFLINE', clearance: 'LEVEL 3' },
                  ]}
                />
              </div>
              <CodeBlock>{`<TacticalTable
  columns={[
    { key: 'id', label: 'ID' },
    { key: 'status', label: 'Status', render: (value) => (
      <TacticalBadge variant={value === 'ACTIVE' ? 'success' : 'default'}>
        {value}
      </TacticalBadge>
    )},
  ]}
  data={data}
/>`}</CodeBlock>
            </div>

            <div>
              <h3 className="text-sm font-mono text-tactical-text-muted uppercase tracking-wider mb-3">
                Row Highlights on Hover
              </h3>
              <p className="text-sm font-mono text-tactical-text-secondary mb-4">
                Hover over rows to see the highlight effect. The background changes from #000000 to #111111 and borders lighten from #333333 to #444444.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};

export default TacticalShowcase;
